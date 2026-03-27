'use client';

import { useEffect, useState } from 'react';
import {
  Brain,
  ChevronDown,
  ChevronRight,
  Sigma,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';

import { cn } from '../lib/utils.js';
import { useAuth } from '../hooks/use-auth.js';

interface RuleEval {
  ruleId: string;
  fieldKey: string;
  ruleType: string;
  matched: boolean;
  weightApplied: number;
  contribution: number;
  reasonCode: string;
}

interface FeatureSnapshot {
  id: string;
  featuresJson: Record<string, unknown> | null;
  hardFilterPassed: boolean;
  ruleMatchCount: number;
}

interface DeterministicData {
  deterministicScore: number | null;
  ruleEvaluation: RuleEval[];
  predictionId: string | null;
}

// A5+A6: Category bonus data from score prediction
interface CategoryScoreData {
  matched: number;
  total: number;
  rate: number;
}

interface LatestScoreData {
  deterministicScore: number;
  logisticScore: number;
  blendedScore: number;
  scoreBand: string;
  reasonsJson: {
    usedTrainedModel?: boolean | undefined;
    blendWeights?: { deterministic: number; ai: number } | undefined;
    categoryScores?: Record<string, CategoryScoreData> | undefined;
    qualificationPath?: string | undefined;
  };
}

// Map field keys to their qualification category (mirrors backend FIELD_KEY_CATEGORY_MAP)
const FIELD_KEY_TO_CATEGORY: Record<string, string> = {
  has_whatsapp: 'SALES_MOTION_FIT',
  has_instagram: 'SALES_MOTION_FIT',
  custom_order_signals: 'SALES_MOTION_FIT',
  apollo_has_direct_phone: 'SALES_MOTION_FIT',
  decision_maker_count: 'SALES_MOTION_FIT',
  apify_has_booking_form: 'SALES_MOTION_FIT',
  apify_payment_widget_count: 'PAYMENT_COMPLEXITY',
  apify_has_pricing_tiers: 'PAYMENT_COMPLEXITY',
  high_ticket_signals: 'PAYMENT_COMPLEXITY',
  recent_activity: 'RISK_URGENCY',
  has_booking_or_contact_form: 'RISK_URGENCY',
  website_email_count: 'RISK_URGENCY',
  website_phone_count: 'RISK_URGENCY',
  follower_growth_signal: 'SWITCHING_WILLINGNESS',
  high_engagement_signal: 'SWITCHING_WILLINGNESS',
  social_link_count: 'SWITCHING_WILLINGNESS',
  has_linkedin: 'SWITCHING_WILLINGNESS',
  tech_stack_size: 'SWITCHING_WILLINGNESS',
};

interface ScoringBreakdownProps {
  leadId: string;
  blendedScore?: number | undefined;
  scoreBand?: string | undefined;
}

export function ScoringBreakdown({
  leadId,
  blendedScore,
  scoreBand,
}: ScoringBreakdownProps) {
  const { apiClient } = useAuth();
  const [snapshot, setSnapshot] = useState<FeatureSnapshot | null>(null);
  const [deterministic, setDeterministic] = useState<DeterministicData | null>(null);
  const [latestScore, setLatestScore] = useState<LatestScoreData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllRules, setShowAllRules] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    async function fetchScoring() {
      try {
        const [snapRes, detRes, scoreRes] = await Promise.allSettled([
          apiClient.getLatestLeadFeatureSnapshot(leadId),
          apiClient.getLatestLeadDeterministicScore(leadId),
          apiClient.getLatestLeadScore(leadId),
        ]);

        if (cancelled) return;

        if (snapRes.status === 'fulfilled') {
          const data = snapRes.value as {
            snapshot: {
              id: string;
              featuresJson: unknown;
              hardFilterPassed: boolean;
              ruleMatchCount: number;
            } | null;
          };
          if (data.snapshot) {
            setSnapshot({
              id: data.snapshot.id,
              featuresJson: data.snapshot.featuresJson as Record<string, unknown> | null,
              hardFilterPassed: data.snapshot.hardFilterPassed,
              ruleMatchCount: data.snapshot.ruleMatchCount,
            });
          }
        }

        if (detRes.status === 'fulfilled') {
          const data = detRes.value as {
            deterministicScore: number | null;
            ruleEvaluation: RuleEval[];
            predictionId: string | null;
          };
          setDeterministic({
            deterministicScore: data.deterministicScore,
            ruleEvaluation: Array.isArray(data.ruleEvaluation) ? data.ruleEvaluation : [],
            predictionId: data.predictionId,
          });
        }

        // A5+A6: Extract score prediction with category bonus data
        if (scoreRes.status === 'fulfilled') {
          const data = scoreRes.value as {
            prediction: {
              deterministicScore: number;
              logisticScore: number;
              blendedScore: number;
              scoreBand: string;
              reasonsJson: unknown;
            } | null;
          };
          if (data.prediction) {
            const reasons = (data.prediction.reasonsJson && typeof data.prediction.reasonsJson === 'object'
              ? data.prediction.reasonsJson
              : {}) as Record<string, unknown>;
            const blendWeightsRaw = reasons.blendWeights as Record<string, unknown> | undefined;
            setLatestScore({
              deterministicScore: data.prediction.deterministicScore,
              logisticScore: data.prediction.logisticScore,
              blendedScore: data.prediction.blendedScore,
              scoreBand: data.prediction.scoreBand,
              reasonsJson: {
                usedTrainedModel: reasons.usedTrainedModel as boolean | undefined,
                blendWeights: blendWeightsRaw
                  ? {
                      deterministic: (blendWeightsRaw.deterministic as number) ?? 1,
                      ai: (blendWeightsRaw.ai as number) ?? 0,
                    }
                  : undefined,
                categoryScores: reasons.categoryScores as Record<string, CategoryScoreData> | undefined,
                qualificationPath: typeof reasons.qualificationPath === 'string' ? reasons.qualificationPath : undefined,
              },
            });
          }
        }
      } catch {
        if (!cancelled) setError('Failed to load scoring data');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void fetchScoring();
    return () => { cancelled = true; };
  }, [leadId, apiClient]);

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2 text-sm text-muted-foreground/50">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
          Loading scoring breakdown...
        </div>
      </div>
    );
  }

  if (error || (!snapshot && !deterministic)) return null;

  // Filter out hard filters -- we only show weighted rules in the equation
  const weightedRules = deterministic?.ruleEvaluation
    .filter((r) => r.ruleType !== 'HARD_FILTER')
    .sort((a, b) => b.contribution - a.contribution) ?? [];

  const positiveRules = weightedRules.filter((r) => r.matched && r.contribution > 0);
  const negativeRules = weightedRules.filter((r) => r.matched && r.contribution < 0);
  const missedRules = weightedRules.filter((r) => !r.matched);

  // A5: Count category bonus matches alongside rule matches
  const CATEGORY_PASS_THRESHOLD = 0.5;

  const detScore = deterministic?.deterministicScore ?? latestScore?.deterministicScore ?? null;
  const blendPct = blendedScore != null ? Math.round(blendedScore * 100) : null;
  const detPct = detScore != null ? Math.round(detScore * 100) : null;

  // ML / blend info
  const usedMl = latestScore?.reasonsJson?.usedTrainedModel ?? false;
  const blendWeights = latestScore?.reasonsJson?.blendWeights;
  const mlScore = usedMl ? latestScore?.logisticScore ?? null : null;
  const mlPct = mlScore != null ? Math.round(mlScore * 100) : null;

  // Category bonuses/penalties
  const categoryScores = latestScore?.reasonsJson?.categoryScores;
  const categoryEntries = categoryScores
    ? Object.entries(categoryScores).filter(([, v]) => v.total > 0)
    : [];
  const categoryBonusMatchCount = categoryEntries.filter(
    ([, score]) => score.rate >= CATEGORY_PASS_THRESHOLD && score.matched >= 1,
  ).length;
  const qualificationPath = latestScore?.reasonsJson?.qualificationPath ?? null;

  // Total weight pool (sum of all weights applied)
  const totalWeightPool = weightedRules.reduce((sum, r) => sum + Math.abs(r.weightApplied), 0);

  return (
    <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
      <h2 className="mb-4 flex items-center gap-2 text-base font-bold tracking-tight">
        <Brain className="h-4 w-4 text-zbooni-teal" />
        Scoring Breakdown
      </h2>

      {/* Score summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {blendPct !== null && (
          <div className="rounded-lg border border-border/20 bg-zbooni-dark/30 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
              Final Score
            </p>
            <div className="mt-0.5 flex items-center gap-2">
              <span className="text-lg font-bold tabular-nums">{blendPct}%</span>
              {scoreBand && (
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase',
                    scoreBand === 'HIGH'
                      ? 'bg-zbooni-green/15 text-zbooni-green'
                      : scoreBand === 'MEDIUM'
                        ? 'bg-yellow-500/15 text-yellow-400'
                        : 'bg-red-500/15 text-red-400',
                  )}
                >
                  {scoreBand}
                </span>
              )}
            </div>
          </div>
        )}
        {detPct !== null && (
          <div className="rounded-lg border border-border/20 bg-zbooni-dark/30 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
              {!latestScore?.reasonsJson?.usedTrainedModel
                ? 'Score (100% Rule-Based)'
                : blendWeights
                  ? `Rule-Based (${Math.round(blendWeights.deterministic * 100)}%)`
                  : 'Rule-Based'}
            </p>
            <p className="mt-0.5 text-lg font-bold tabular-nums">{detPct}%</p>
          </div>
        )}
        {usedMl && mlPct !== null && (
          <div className="rounded-lg border border-border/20 bg-zbooni-dark/30 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
              ML Model
            </p>
            <p className="mt-0.5 text-lg font-bold tabular-nums">{mlPct}%</p>
          </div>
        )}
        {snapshot && (
          <div className="rounded-lg border border-border/20 bg-zbooni-dark/30 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
              Rules Matched
            </p>
            <p className="mt-0.5 text-lg font-bold tabular-nums">
              {snapshot.ruleMatchCount + categoryBonusMatchCount}
              <span className="text-sm font-normal text-muted-foreground/40">/{weightedRules.length}</span>
              {categoryBonusMatchCount > 0 && (
                <span className="ml-1 text-[10px] font-semibold text-zbooni-green">
                  (+{categoryBonusMatchCount} category)
                </span>
              )}
            </p>
          </div>
        )}
      </div>

      {/* Blend formula */}
      {usedMl && blendWeights && detPct !== null && mlPct !== null && (
        <div className="mt-4 rounded-lg border border-border/20 bg-zbooni-dark/20 px-4 py-3">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
            <Sigma className="mr-1 inline h-3 w-3" />
            Blend Formula
          </p>
          <p className="font-mono text-sm text-foreground/80">
            <span className="text-muted-foreground/60">Final</span> = {detPct}% <span className="text-muted-foreground/40">x</span>{' '}
            <span className="text-zbooni-teal">{Math.round(blendWeights.deterministic * 100)}%</span>
            {' + '}
            {mlPct}% <span className="text-muted-foreground/40">x</span>{' '}
            <span className="text-purple-400">{Math.round(blendWeights.ai * 100)}%</span>
            {' = '}
            <span className="font-bold text-foreground">{blendPct}%</span>
          </p>
        </div>
      )}

      {/* Category bonuses/penalties */}
      {categoryEntries.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
            Category Match Rates
          </p>
          <div className="flex flex-wrap gap-2">
            {categoryEntries.map(([cat, scores]) => {
              const rate = Math.round(scores.rate * 100);
              const isPositive = rate >= 50;
              return (
                <div
                  key={cat}
                  className={cn(
                    'rounded-lg border px-2.5 py-1.5 text-xs',
                    isPositive
                      ? 'border-zbooni-green/20 bg-zbooni-green/5 text-zbooni-green'
                      : 'border-amber-400/20 bg-amber-400/5 text-amber-400',
                  )}
                >
                  <span className="font-semibold">{formatFieldKey(cat)}</span>
                  <span className="ml-2 font-mono text-[10px]">
                    {scores.matched}/{scores.total} ({rate}%)
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Deterministic equation: positive contributions */}
      {positiveRules.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
            <TrendingUp className="mr-1 inline h-3 w-3" />
            Positive Signals ({positiveRules.length})
          </p>
          <div className="space-y-1.5">
            {positiveRules.map((r, rIdx) => (
              <div
                key={`${r.ruleId}-pos-${rIdx}`}
                className="flex items-center gap-2 rounded-lg border border-zbooni-green/15 bg-zbooni-green/5 px-3 py-2 text-xs"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-zbooni-green" />
                <span className="font-semibold text-zbooni-green">
                  {formatFieldKey(r.fieldKey)}
                </span>
                <span className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground/50">
                  <span className="font-mono">w:{r.weightApplied}/{totalWeightPool}</span>
                  <span className="text-zbooni-green font-bold">
                    +{(r.contribution * 100).toFixed(0)}%
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Negative contributions (penalties) */}
      {negativeRules.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
            <TrendingDown className="mr-1 inline h-3 w-3" />
            Penalties ({negativeRules.length})
          </p>
          <div className="space-y-1.5">
            {negativeRules.map((r, rIdx) => (
              <div
                key={`${r.ruleId}-neg-${rIdx}`}
                className="flex items-center gap-2 rounded-lg border border-red-500/15 bg-red-500/5 px-3 py-2 text-xs"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
                <span className="font-semibold text-red-400">
                  {formatFieldKey(r.fieldKey)}
                </span>
                <span className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground/50">
                  <span className="font-mono">w:{r.weightApplied}/{totalWeightPool}</span>
                  <span className="text-red-400 font-bold">
                    {(r.contribution * 100).toFixed(0)}%
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Missing signals */}
      {missedRules.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
            Not Matched ({missedRules.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {missedRules.slice(0, 8).map((r, rIdx) => (
              <span
                key={`${r.ruleId}-miss-${rIdx}`}
                className="rounded-full border border-border/20 bg-zbooni-dark/30 px-2.5 py-1 text-[10px] font-semibold text-muted-foreground/50"
              >
                {formatFieldKey(r.fieldKey)} <span className="text-muted-foreground/30">w:{r.weightApplied}</span>
              </span>
            ))}
            {missedRules.length > 8 && (
              <span className="rounded-full border border-border/20 bg-zbooni-dark/20 px-2.5 py-1 text-[10px] font-semibold text-muted-foreground/30">
                +{missedRules.length - 8} more
              </span>
            )}
          </div>
        </div>
      )}

      {/* Expandable all rules */}
      {weightedRules.length > 0 && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowAllRules(!showAllRules)}
            className="flex w-full items-center gap-2 rounded-lg border border-border/20 bg-zbooni-dark/20 px-3 py-2 text-xs font-semibold text-muted-foreground/60 transition-colors hover:text-muted-foreground"
          >
            {showAllRules ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            Full Rule Evaluation ({weightedRules.length} rules)
          </button>
          {showAllRules && (
            <div className="mt-2 space-y-1">
              {weightedRules.map((r, rIdx) => (
                <div
                  key={`${r.ruleId}-all-${rIdx}`}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs',
                    r.matched
                      ? 'border-zbooni-green/10 bg-zbooni-green/[0.03]'
                      : 'border-border/15 bg-zbooni-dark/20',
                  )}
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full shrink-0',
                      r.matched ? 'bg-zbooni-green' : 'bg-muted-foreground/30',
                    )}
                  />
                  <span
                    className={cn(
                      'font-semibold',
                      r.matched ? 'text-foreground' : 'text-muted-foreground/50',
                    )}
                  >
                    {formatFieldKey(r.fieldKey)}
                  </span>
                  <span className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground/40">
                    <span className="font-mono">w:{r.weightApplied}</span>
                    {r.matched && r.contribution > 0 && (
                      <span className="text-zbooni-green">
                        +{(r.contribution * 100).toFixed(0)}%
                      </span>
                    )}
                    {r.matched && r.contribution < 0 && (
                      <span className="text-red-400">
                        {(r.contribution * 100).toFixed(0)}%
                      </span>
                    )}
                  </span>
                </div>
              ))}

              {/* A6: Category Bonuses sub-section with per-feature breakdown */}
              {categoryEntries.length > 0 && (
                <div className="mt-3 rounded-lg border border-border/20 bg-zbooni-dark/20 p-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                    Category Bonuses
                    {qualificationPath ? (
                      <span className={cn(
                        'ml-2 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase',
                        qualificationPath === 'PROCEED'
                          ? 'bg-zbooni-green/15 text-zbooni-green'
                          : qualificationPath === 'SELECTIVE'
                            ? 'bg-yellow-500/15 text-yellow-400'
                            : 'bg-red-500/15 text-red-400',
                      )}>
                        {qualificationPath}
                      </span>
                    ) : null}
                  </p>
                  <div className="space-y-2">
                    {categoryEntries.map(([category, score]) => {
                      const passed = score.rate >= CATEGORY_PASS_THRESHOLD && score.matched >= 1;
                      const bonusValue = passed
                        ? (qualificationPath === 'PROCEED' ? '+10%'
                          : qualificationPath === 'SELECTIVE' ? '+5%'
                          : '-5%')
                        : null;
                      // Find individual features belonging to this category from rule evaluations
                      const categoryFeatures = (deterministic?.ruleEvaluation ?? [])
                        .filter((r) => r.ruleType !== 'HARD_FILTER' && FIELD_KEY_TO_CATEGORY[r.fieldKey] === category);
                      return (
                        <div key={category} className="space-y-1">
                          <div
                            className={cn(
                              'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs',
                              passed
                                ? 'border-zbooni-green/10 bg-zbooni-green/[0.03]'
                                : 'border-border/15 bg-zbooni-dark/10',
                            )}
                          >
                            <span
                              className={cn(
                                'h-1.5 w-1.5 rounded-full shrink-0',
                                passed ? 'bg-zbooni-green' : 'bg-muted-foreground/30',
                              )}
                            />
                            <span className={cn(
                              'font-semibold',
                              passed ? 'text-foreground' : 'text-muted-foreground/50',
                            )}>
                              {formatFieldKey(category)}
                            </span>
                            <span className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground/40">
                              <span>{score.matched}/{score.total} ({Math.round(score.rate * 100)}%)</span>
                              {passed && bonusValue ? (
                                <span className={bonusValue.startsWith('+') ? 'text-zbooni-green' : 'text-red-400'}>
                                  {bonusValue}
                                </span>
                              ) : (
                                <span className="text-muted-foreground/30">no bonus</span>
                              )}
                            </span>
                          </div>
                          {/* Per-feature breakdown within this category */}
                          {categoryFeatures.length > 0 && (
                            <div className="ml-4 space-y-0.5">
                              {categoryFeatures.map((feat, fIdx) => (
                                <div
                                  key={`${category}-${feat.fieldKey}-${fIdx}`}
                                  className="flex items-center gap-1.5 text-[11px]"
                                >
                                  <span className={cn(
                                    'shrink-0',
                                    feat.matched ? 'text-zbooni-green' : 'text-muted-foreground/30',
                                  )}>
                                    {feat.matched ? '\u2713' : '\u2717'}
                                  </span>
                                  <span className={cn(
                                    feat.matched ? 'text-foreground/70' : 'text-muted-foreground/40',
                                  )}>
                                    {formatFieldKey(feat.fieldKey)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const FEATURE_KEY_LABELS: Record<string, string> = {
  'found_csuite_decision_maker': 'Found C-Suite Decision Maker',
  'apollo_has_direct_phone': 'Apollo Has Direct Phone',
};

function formatFieldKey(key: string): string {
  const custom = FEATURE_KEY_LABELS[key];
  if (custom) return custom;
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
