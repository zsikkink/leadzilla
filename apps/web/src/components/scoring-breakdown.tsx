'use client';

import { useEffect, useState } from 'react';
import {
  Brain,
  ChevronDown,
  ChevronRight,
  Shield,
  TrendingUp,
  XCircle,
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

interface CategoryBonusData {
  categoryScores: Record<string, CategoryScoreData>;
  qualificationPath: string | null;
}

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
  const [categoryBonus, setCategoryBonus] = useState<CategoryBonusData | null>(null);
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

        // A5+A6: Extract category bonus data from score prediction
        if (scoreRes.status === 'fulfilled') {
          const data = scoreRes.value as {
            prediction: {
              reasonsJson: unknown;
            } | null;
          };
          if (data.prediction?.reasonsJson && typeof data.prediction.reasonsJson === 'object') {
            const reasons = data.prediction.reasonsJson as Record<string, unknown>;
            const catScores = (
              typeof reasons.categoryScores === 'object' && reasons.categoryScores !== null
                ? reasons.categoryScores
                : {}
            ) as Record<string, CategoryScoreData>;
            setCategoryBonus({
              categoryScores: catScores,
              qualificationPath: typeof reasons.qualificationPath === 'string' ? reasons.qualificationPath : null,
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

  const hardFilters = deterministic?.ruleEvaluation.filter(
    (r) => r.ruleType === 'HARD_FILTER',
  ) ?? [];
  const positiveRules = deterministic?.ruleEvaluation
    .filter((r) => r.ruleType !== 'HARD_FILTER' && r.matched && r.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 5) ?? [];
  const failingRules = deterministic?.ruleEvaluation
    .filter((r) => r.ruleType !== 'HARD_FILTER' && !r.matched)
    .sort((a, b) => Math.abs(b.weightApplied) - Math.abs(a.weightApplied))
    .slice(0, 3) ?? [];
  const allRules = deterministic?.ruleEvaluation
    .filter((r) => r.ruleType !== 'HARD_FILTER')
    .sort((a, b) => b.contribution - a.contribution) ?? [];

  // A5: Count category bonus matches alongside rule matches
  const CATEGORY_PASS_THRESHOLD = 0.5;
  const categoryEntries = Object.entries(categoryBonus?.categoryScores ?? {})
    .filter(([key]) => key !== 'general');
  const categoryBonusMatchCount = categoryEntries.filter(
    ([, score]) => score.rate >= CATEGORY_PASS_THRESHOLD && score.matched >= 1,
  ).length;

  const detScore = deterministic?.deterministicScore;
  const blendPct = blendedScore != null ? Math.round(blendedScore * 100) : null;
  const detPct = detScore != null ? Math.round(detScore * 100) : null;

  // Infer AI score from blended and deterministic if both exist
  // blended = det * detWeight + ai * aiWeight, but we don't know weights here
  // Just show what we have

  return (
    <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
      <h2 className="mb-4 flex items-center gap-2 text-base font-bold tracking-tight">
        <Brain className="h-4 w-4 text-zbooni-teal" />
        Scoring Breakdown
      </h2>

      {/* Score summary bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {blendPct !== null && (
          <div className="rounded-lg border border-border/20 bg-zbooni-dark/30 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
              Blended Score
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
              Deterministic
            </p>
            <p className="mt-0.5 text-lg font-bold tabular-nums">{detPct}%</p>
          </div>
        )}
        {snapshot && (
          <div className="rounded-lg border border-border/20 bg-zbooni-dark/30 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
              Rules Matched
            </p>
            <p className="mt-0.5 text-lg font-bold tabular-nums">
              {snapshot.ruleMatchCount + categoryBonusMatchCount}
              {categoryBonusMatchCount > 0 && (
                <span className="ml-1 text-[10px] font-semibold text-zbooni-green">
                  (+{categoryBonusMatchCount} category)
                </span>
              )}
            </p>
          </div>
        )}
      </div>

      {/* Hard filters */}
      {hardFilters.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
            <Shield className="mr-1 inline h-3 w-3" />
            Hard Filters
          </p>
          <div className="space-y-1.5">
            {hardFilters.map((hf) => (
              <div
                key={hf.ruleId}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs',
                  hf.matched
                    ? 'border-zbooni-green/20 bg-zbooni-green/5 text-zbooni-green'
                    : 'border-red-500/20 bg-red-500/5 text-red-400',
                )}
              >
                {hf.matched ? (
                  <Shield className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="font-semibold">{formatFieldKey(hf.fieldKey)}</span>
                <span className="ml-auto text-[10px] opacity-60">
                  {hf.matched ? 'Passed' : 'Failed'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top positive contributions */}
      {positiveRules.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
            <TrendingUp className="mr-1 inline h-3 w-3" />
            Top Positive Signals ({positiveRules.length})
          </p>
          <div className="space-y-1.5">
            {positiveRules.map((r) => (
              <div
                key={r.ruleId}
                className="flex items-center gap-2 rounded-lg border border-zbooni-green/15 bg-zbooni-green/5 px-3 py-2 text-xs"
              >
                <span className="font-semibold text-zbooni-green">
                  {formatFieldKey(r.fieldKey)}
                </span>
                <span className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground/50">
                  <span>weight {r.weightApplied}</span>
                  <span className="text-zbooni-green">
                    +{(r.contribution * 100).toFixed(0)}%
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Failing / missing rules */}
      {failingRules.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
            <XCircle className="mr-1 inline h-3 w-3" />
            Missing Signals ({failingRules.length})
          </p>
          <div className="space-y-1.5">
            {failingRules.map((r) => (
              <div
                key={r.ruleId}
                className="flex items-center gap-2 rounded-lg border border-border/20 bg-zbooni-dark/30 px-3 py-2 text-xs text-muted-foreground/60"
              >
                <span className="font-semibold">
                  {formatFieldKey(r.fieldKey)}
                </span>
                <span className="ml-auto text-[10px] text-muted-foreground/40">
                  weight {r.weightApplied}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expandable all rules */}
      {allRules.length > 0 && (
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
            All Rules ({allRules.length})
          </button>
          {showAllRules && (
            <div className="mt-2 space-y-1">
              {allRules.map((r) => (
                <div
                  key={r.ruleId}
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
                    <span>w:{r.weightApplied}</span>
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

              {/* A6: Category Bonuses sub-section */}
              {categoryEntries.length > 0 && (
                <div className="mt-3 rounded-lg border border-border/20 bg-zbooni-dark/20 p-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                    Category Bonuses
                    {categoryBonus?.qualificationPath ? (
                      <span className={cn(
                        'ml-2 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase',
                        categoryBonus.qualificationPath === 'PROCEED'
                          ? 'bg-zbooni-green/15 text-zbooni-green'
                          : categoryBonus.qualificationPath === 'SELECTIVE'
                            ? 'bg-yellow-500/15 text-yellow-400'
                            : 'bg-red-500/15 text-red-400',
                      )}>
                        {categoryBonus.qualificationPath}
                      </span>
                    ) : null}
                  </p>
                  <div className="space-y-1">
                    {categoryEntries.map(([category, score]) => {
                      const passed = score.rate >= CATEGORY_PASS_THRESHOLD && score.matched >= 1;
                      const bonusValue = passed
                        ? (categoryBonus?.qualificationPath === 'PROCEED' ? '+10%'
                          : categoryBonus?.qualificationPath === 'SELECTIVE' ? '+5%'
                          : '-5%')
                        : null;
                      return (
                        <div
                          key={category}
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

function formatFieldKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
