'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Shield,
  Weight,
  Ban,
  ChevronRight,
  Gauge,
  Building2,
  CheckCircle2,
  XCircle,
  Calculator,
  RotateCcw,
  Loader2,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils.js';
import { getWebEnv } from '@/lib/env.js';
import { useAuth } from '@/hooks/use-auth.js';
import { useApiQuery } from '@/hooks/use-api-query.js';
import { KNOWN_SCORING_FIELD_KEYS } from '@/lib/discovery-admin.js';

import type {
  QualificationRuleResponse,
} from '@lead-flood/contracts';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type RuleCategory = 'HARD_FILTER' | 'WEIGHTED' | 'ANTI_FIT';

/* ------------------------------------------------------------------ */
/*  Score Simulation form state                                        */
/* ------------------------------------------------------------------ */

interface SimFormState {
  // Hard filters
  country: string;
  hasEmail: boolean;
  dataAlignmentScore: number;
  // Weighted signals (positive)
  hasWhatsapp: boolean;
  hasInstagram: boolean;
  reviewCount: number;
  customOrderSignals: boolean;
  hasBookingOrContactForm: boolean;
  paymentWidgetCount: number;
  hasPricingTiers: boolean;
  highTicketSignals: boolean;
  decisionMakerCount: number;
  hasExecutiveContact: boolean;
  socialLinkCount: number;
  hasLinkedin: boolean;
  recentActivity: boolean;
  icpSegmentPriority: number;
  // Anti-fit signals (negative)
  pureSelfServeEcom: boolean;
  subscriptionBillingDetected: boolean;
  // Business context
  industry: string;
  companySize: number;
  followerCount: number;
  avgRating: number;
  websiteEmailCount: number;
  websitePhoneCount: number;
  techStackSize: number;
  estimatedEmployees: number;
  certificationCount: number;
  hasWebsite: boolean;
  hasCrm: boolean;
  hasLiveChat: boolean;
  hasAnalytics: boolean;
  instagramBusinessCategory: string;
  acceptsOnlinePayments: boolean;
  // AI / Similarity
  aiSimilarityScore: number;
}

const DEFAULT_SIM: SimFormState = {
  // Hard filters
  country: 'AE',
  hasEmail: true,
  dataAlignmentScore: 0.7,
  // Weighted signals (positive)
  hasWhatsapp: true,
  hasInstagram: true,
  reviewCount: 120,
  customOrderSignals: false,
  hasBookingOrContactForm: true,
  paymentWidgetCount: 1,
  hasPricingTiers: false,
  highTicketSignals: false,
  decisionMakerCount: 2,
  hasExecutiveContact: true,
  socialLinkCount: 4,
  hasLinkedin: true,
  recentActivity: true,
  icpSegmentPriority: 2,
  // Anti-fit signals (negative)
  pureSelfServeEcom: false,
  subscriptionBillingDetected: false,
  // Business context
  industry: 'retail',
  companySize: 80,
  followerCount: 15000,
  avgRating: 4.3,
  websiteEmailCount: 1,
  websitePhoneCount: 1,
  techStackSize: 3,
  estimatedEmployees: 80,
  certificationCount: 1,
  hasWebsite: true,
  hasCrm: false,
  hasLiveChat: false,
  hasAnalytics: true,
  instagramBusinessCategory: '',
  acceptsOnlinePayments: true,
  // AI / Similarity
  aiSimilarityScore: 0.5,
};

const COUNTRY_OPTIONS = ['AE', 'SA', 'JO', 'EG', 'KW', 'BH', 'QA', 'OM', 'Other'];

/* Field key → form field mapping for simulation.
 * MUST cover every fieldKey used in UNIVERSAL_RULES (seed.ts) or evaluateRule() returns false → score=0 */
const FIELD_KEY_MAP: Record<string, (form: SimFormState) => unknown> = {
  // HARD_FILTER keys (3) — country, has_email, data_alignment_score
  country: (f) => f.country,
  country_code: (f) => f.country, // alias
  has_email: (f) => f.hasEmail,
  data_alignment_score: (f) => f.dataAlignmentScore,
  // Core business fields
  industry: (f) => f.industry,
  employee_count: (f) => f.companySize,
  review_count: (f) => f.reviewCount,
  follower_count: (f) => f.followerCount,
  has_instagram: (f) => f.hasInstagram,
  has_whatsapp: (f) => f.hasWhatsapp,
  accepts_online_payments: (f) => f.acceptsOnlinePayments,
  has_website: (f) => f.hasWebsite,
  recent_activity: (f) => f.recentActivity,
  avg_rating: (f) => f.avgRating,
  // V2.1 scraper features
  decision_maker_count: (f) => f.decisionMakerCount,
  has_executive_contact: (f) => f.hasExecutiveContact,
  website_email_count: (f) => f.websiteEmailCount,
  website_phone_count: (f) => f.websitePhoneCount,
  social_link_count: (f) => f.socialLinkCount,
  has_linkedin: (f) => f.hasLinkedin,
  tech_stack_size: (f) => f.techStackSize,
  has_crm: (f) => f.hasCrm,
  has_live_chat: (f) => f.hasLiveChat,
  has_analytics: (f) => f.hasAnalytics,
  estimated_employees: (f) => f.estimatedEmployees,
  certification_count: (f) => f.certificationCount,
  instagram_business_category: (f) => f.instagramBusinessCategory,
  // Business signal fields from UNIVERSAL_RULES
  custom_order_signals: (f) => f.customOrderSignals,
  has_booking_or_contact_form: (f) => f.hasBookingOrContactForm,
  apify_payment_widget_count: (f) => f.paymentWidgetCount,
  apify_has_pricing_tiers: (f) => f.hasPricingTiers,
  pure_self_serve_ecom: (f) => f.pureSelfServeEcom,
  subscription_billing_detected: (f) => f.subscriptionBillingDetected,
  high_ticket_signals: (f) => f.highTicketSignals,
  icp_segment_priority: (f) => f.icpSegmentPriority,
};

/* ------------------------------------------------------------------ */
/*  Category map — mirrors FIELD_KEY_CATEGORY_MAP from deterministic.ts */
/* ------------------------------------------------------------------ */

const FIELD_KEY_CATEGORY_MAP: Record<string, string> = {
  has_whatsapp: 'SALES_MOTION_FIT',
  has_instagram: 'SALES_MOTION_FIT',
  custom_order_signals: 'SALES_MOTION_FIT',
  apollo_has_direct_phone: 'SALES_MOTION_FIT',
  decision_maker_count: 'SALES_MOTION_FIT',
  apify_has_booking_form: 'SALES_MOTION_FIT',
  has_decision_maker_phone: 'SALES_MOTION_FIT',
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
  instagram_follower_count: 'SWITCHING_WILLINGNESS',
  instagram_engagement_rate: 'SWITCHING_WILLINGNESS',
  instagram_has_bio_link: 'SWITCHING_WILLINGNESS',
  pure_self_serve_ecom: 'GENERAL',
  shopify_detected: 'GENERAL',
  subscription_billing_detected: 'GENERAL',
  industry_match: 'GENERAL',
  geo_match: 'GENERAL',
  icp_segment_priority: 'GENERAL',
  apify_has_shopify: 'GENERAL',
  apify_has_product_catalog: 'GENERAL',
  instagram_is_business_account: 'GENERAL',
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function categorizeRule(rule: QualificationRuleResponse): RuleCategory {
  if (rule.ruleType === 'HARD_FILTER') return 'HARD_FILTER';
  if (rule.weight !== null && rule.weight < 0) return 'ANTI_FIT';
  return 'WEIGHTED';
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return '—';
  if (Array.isArray(val)) return val.join(', ');
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

function scoreTier(score: number): { label: string; className: string } {
  if (score >= 0.7) return { label: 'HIGH', className: 'tier high' };
  if (score >= 0.4) return { label: 'MEDIUM', className: 'tier medium' };
  return { label: 'LOW', className: 'tier low' };
}

function ruleTypeLabel(cat: RuleCategory): { label: string; border: string; bg: string; icon: typeof Shield } {
  switch (cat) {
    case 'HARD_FILTER':
      return { label: 'Hard Filter', border: 'border-red-500/40', bg: 'bg-red-500/8', icon: Shield };
    case 'WEIGHTED':
      return { label: 'Weighted', border: 'border-blue-500/40', bg: 'bg-blue-500/8', icon: Weight };
    case 'ANTI_FIT':
      return { label: 'Anti-fit', border: 'border-orange-500/40', bg: 'bg-orange-500/8', icon: Ban };
  }
}

/**
 * Evaluate a single rule against form state.
 * Returns whether the rule "passed" (matched the condition).
 */
function evaluateRule(rule: QualificationRuleResponse, form: SimFormState): boolean {
  const getter = FIELD_KEY_MAP[rule.fieldKey];
  if (!getter) return false; // unknown field → not matched

  const formValue = getter(form);
  const expected = rule.valueJson;

  switch (rule.operator) {
    case 'EQ':
      return String(formValue) === String(expected);
    case 'NEQ':
      return String(formValue) !== String(expected);
    case 'GTE':
      return Number(formValue) >= Number(expected);
    case 'GT':
      return Number(formValue) > Number(expected);
    case 'LTE':
      return Number(formValue) <= Number(expected);
    case 'LT':
      return Number(formValue) < Number(expected);
    case 'IN': {
      const allowed = Array.isArray(expected)
        ? expected.map((v) => String(v).trim().toLowerCase())
        : String(expected).split(',').map((s) => s.trim().toLowerCase());
      const val = String(formValue).toLowerCase();
      return allowed.some((a) => val.includes(a) || a.includes(val));
    }
    case 'NOT_IN': {
      const blocked = Array.isArray(expected)
        ? expected.map((v) => String(v).trim().toLowerCase())
        : String(expected).split(',').map((s) => s.trim().toLowerCase());
      const val2 = String(formValue).toLowerCase();
      return !blocked.some((b) => val2.includes(b) || b.includes(val2));
    }
    case 'CONTAINS': {
      return String(formValue).toLowerCase().includes(String(expected).toLowerCase());
    }
    default:
      return false;
  }
}

interface SimulationResult {
  score: number;
  deterministicScore: number;
  aiScore: number;
  passedHard: boolean;
  breakdown: Array<{ rule: string; passed: boolean; contribution: number; group: 'hard_filters' | 'positive' | 'negative' }>;
  equation: string;
  qualificationPath: 'PROCEED' | 'SELECTIVE' | 'DISQUALIFY' | 'HARD_FILTERED';
  categoryBonus: number;
}

function simulateScore(
  rules: QualificationRuleResponse[],
  form: SimFormState,
  blendWeights: { deterministic: number; ai: number },
): SimulationResult {
  const breakdown: Array<{ rule: string; passed: boolean; contribution: number; group: 'hard_filters' | 'positive' | 'negative' }> = [];
  let passedHard = true;

  // Accumulators matching the real backend formula
  let weightedPositiveMatched = 0;
  let weightedPositiveTotal = 0;
  let weightedNegativeMatched = 0;
  let weightedNegativeTotal = 0;

  // Track per-rule evaluation for category scoring
  const ruleEvals: Array<{ fieldKey: string; ruleType: string; matched: boolean }> = [];

  for (const rule of rules) {
    if (!rule.isActive) continue;

    const passed = evaluateRule(rule, form);
    const category = categorizeRule(rule);

    if (category === 'HARD_FILTER') {
      if (!passed) passedHard = false;
      breakdown.push({ rule: rule.name, passed, contribution: 0, group: 'hard_filters' });
      ruleEvals.push({ fieldKey: rule.fieldKey, ruleType: 'HARD_FILTER', matched: passed });
    } else if (category === 'WEIGHTED') {
      const w = rule.weight ?? 1;
      weightedPositiveTotal += w;
      if (passed) weightedPositiveMatched += w;
      breakdown.push({ rule: rule.name, passed, contribution: passed ? w : 0, group: 'positive' });
      ruleEvals.push({ fieldKey: rule.fieldKey, ruleType: 'WEIGHTED', matched: passed });
    } else {
      // ANTI_FIT: negative weight
      const w = rule.weight ?? 0;
      const penalty = Math.abs(w);
      weightedNegativeTotal += penalty;
      if (passed) weightedNegativeMatched += penalty;
      breakdown.push({ rule: rule.name, passed, contribution: passed ? w : 0, group: 'negative' });
      ruleEvals.push({ fieldKey: rule.fieldKey, ruleType: 'WEIGHTED', matched: passed });
    }
  }

  if (!passedHard) {
    return {
      score: 0,
      deterministicScore: 0,
      aiScore: form.aiSimilarityScore,
      passedHard: false,
      breakdown,
      equation: 'hard filters failed => score = 0',
      qualificationPath: 'HARD_FILTERED',
      categoryBonus: 0,
    };
  }

  // --- Category-based scoring (mirrors deterministic.ts) ---
  const categoryBuckets = new Map<string, { matched: number; total: number }>();
  for (const evaluation of ruleEvals) {
    if (evaluation.ruleType === 'HARD_FILTER') continue;
    const cat = FIELD_KEY_CATEGORY_MAP[evaluation.fieldKey] ?? 'GENERAL';
    const existing = categoryBuckets.get(cat) ?? { matched: 0, total: 0 };
    existing.total += 1;
    if (evaluation.matched) existing.matched += 1;
    categoryBuckets.set(cat, existing);
  }

  // Count categories that pass (>=50% match rate, at least 1 matched, excluding GENERAL)
  const passedCategories = new Set<string>();
  for (const [cat, bucket] of categoryBuckets) {
    if (cat === 'GENERAL') continue;
    const rate = bucket.total > 0 ? bucket.matched / bucket.total : 0;
    if (rate >= 0.5 && bucket.matched >= 1) {
      passedCategories.add(cat);
    }
  }

  const hasSalesMotion = passedCategories.has('SALES_MOTION_FIT');
  const hasPaymentComplexity = passedCategories.has('PAYMENT_COMPLEXITY');

  let qualificationPath: 'PROCEED' | 'SELECTIVE' | 'DISQUALIFY' | 'HARD_FILTERED';
  let categoryBonus = 0;

  if (hasSalesMotion && hasPaymentComplexity && passedCategories.size >= 3) {
    qualificationPath = 'PROCEED';
    categoryBonus = 0.10;
  } else if (passedCategories.size >= 2) {
    qualificationPath = 'SELECTIVE';
    categoryBonus = 0.05;
  } else {
    qualificationPath = 'DISQUALIFY';
    categoryBonus = -0.05;
  }

  // --- Weighted-average scoring (Option D: BASE_SCORE + matchRatio * penalty * 0.90 + categoryBonus) ---
  const BASE_SCORE = 0.10;
  let deterministicScore: number;

  if (weightedPositiveTotal > 0 || weightedNegativeTotal > 0) {
    const matchRatio = weightedPositiveTotal > 0
      ? (weightedPositiveMatched + 1) / (weightedPositiveTotal + 1)
      : 1;

    const penaltyFactor = weightedNegativeTotal > 0
      ? 1 - (weightedNegativeMatched / weightedNegativeTotal) * 0.8
      : 1;

    const boundedPenaltyFactor = Math.max(0.2, Math.min(1, penaltyFactor));

    deterministicScore = BASE_SCORE + matchRatio * boundedPenaltyFactor * 0.90;
    deterministicScore = Math.max(0, Math.min(1, deterministicScore + categoryBonus));
  } else {
    deterministicScore = 1;
  }

  const aiScore = Math.max(0, Math.min(1, form.aiSimilarityScore));
  const finalScore = Math.max(0, Math.min(1, blendWeights.deterministic * deterministicScore + blendWeights.ai * aiScore));

  const matchRatioDisplay = weightedPositiveTotal > 0
    ? ((weightedPositiveMatched + 1) / (weightedPositiveTotal + 1)).toFixed(3)
    : '1.000';
  const penaltyDisplay = weightedNegativeTotal > 0
    ? Math.max(0.2, Math.min(1, 1 - (weightedNegativeMatched / weightedNegativeTotal) * 0.8)).toFixed(3)
    : '1.000';

  return {
    score: finalScore,
    deterministicScore,
    aiScore,
    passedHard: true,
    breakdown,
    equation: `det = 0.10 + ${matchRatioDisplay} * ${penaltyDisplay} * 0.90 + (${categoryBonus >= 0 ? '+' : ''}${categoryBonus.toFixed(2)}) = ${deterministicScore.toFixed(3)} | final = ${blendWeights.deterministic.toFixed(2)} * ${deterministicScore.toFixed(3)} + ${blendWeights.ai.toFixed(2)} * ${aiScore.toFixed(3)} = ${finalScore.toFixed(3)}`,
    qualificationPath,
    categoryBonus,
  };
}

/* ------------------------------------------------------------------ */
/*  Add Rule types                                                     */
/* ------------------------------------------------------------------ */

const OPERATORS = ['EQ', 'NEQ', 'GT', 'GTE', 'LT', 'LTE', 'IN', 'NOT_IN', 'CONTAINS'] as const;

interface StagedRule {
  name: string;
  fieldKey: string;
  ruleType: 'WEIGHTED' | 'HARD_FILTER';
  operator: string;
  valueJson: unknown;
  weight: number;
}

const EMPTY_RULE: StagedRule = {
  name: '',
  fieldKey: '',
  ruleType: 'WEIGHTED',
  operator: 'EQ',
  valueJson: '',
  weight: 1,
};

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

export default function ICPRulesPage() {
  const { apiClient, token } = useAuth();

  const icpQuery = useApiQuery(
    useCallback(() => apiClient.listIcps({ page: 1, pageSize: 100 }), [apiClient]),
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [simForm, setSimForm] = useState<SimFormState>(DEFAULT_SIM);
  const [showSimulation, setShowSimulation] = useState(false);
  const [blendWeights, setBlendWeights] = useState({ deterministic: 0.6, ai: 0.4 });
  const [qualificationThreshold, setQualificationThreshold] = useState(0.4);

  // Add Rule state
  const [showAddRule, setShowAddRule] = useState(false);
  const [stagedRules, setStagedRules] = useState<StagedRule[]>([]);
  const [currentRule, setCurrentRule] = useState<StagedRule>(EMPTY_RULE);
  const [submittingRules, setSubmittingRules] = useState(false);

  const profiles = icpQuery.data?.items ?? [];

  // Auto-select first profile
  const effectiveSelectedId = selectedId ?? profiles[0]?.id ?? null;
  const selectedProfile = profiles.find((p) => p.id === effectiveSelectedId) ?? null;
  const rules = selectedProfile?.qualificationRules ?? [];

  const hardFilterRules = rules.filter((r) => categorizeRule(r) === 'HARD_FILTER');
  const weightedRules = rules.filter((r) => categorizeRule(r) === 'WEIGHTED');
  const antiFitRules = rules.filter((r) => categorizeRule(r) === 'ANTI_FIT');

  // Field keys available for new rules (exclude already used ones)
  const existingFieldKeys = new Set(rules.map((r) => r.fieldKey));
  const stagedFieldKeys = new Set(stagedRules.map((r) => r.fieldKey));
  const availableFieldKeys = KNOWN_SCORING_FIELD_KEYS.filter(
    (k) => !existingFieldKeys.has(k) && !stagedFieldKeys.has(k),
  );

  const addToStaging = () => {
    if (!currentRule.name.trim() || !currentRule.fieldKey) return;
    setStagedRules((prev) => [...prev, { ...currentRule }]);
    setCurrentRule({ ...EMPTY_RULE, fieldKey: availableFieldKeys[0] ?? '' });
  };

  const removeFromStaging = (idx: number) => {
    setStagedRules((prev) => prev.filter((_, i) => i !== idx));
  };

  const submitStagedRules = async () => {
    if (!effectiveSelectedId || stagedRules.length === 0) return;
    setSubmittingRules(true);
    let successCount = 0;
    for (const rule of stagedRules) {
      try {
        const res = await fetch(`${getWebEnv().NEXT_PUBLIC_API_BASE_URL}/v1/scoring/rules`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            icpProfileId: effectiveSelectedId,
            name: rule.name,
            fieldKey: rule.fieldKey,
            ruleType: rule.ruleType,
            operator: rule.operator,
            valueJson: rule.valueJson,
            weight: rule.weight,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { message?: string }).message ?? `HTTP ${res.status}`);
        }
        successCount++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to create rule';
        toast.error(`Rule "${rule.name}": ${msg}`);
      }
    }
    if (successCount > 0) {
      toast.success(`${successCount} rule${successCount > 1 ? 's' : ''} created`);
      setStagedRules([]);
      setShowAddRule(false);
      icpQuery.refetch();
    }
    setSubmittingRules(false);
  };

  useEffect(() => {
    void apiClient.listPipelineSettings().then((res) => {
      const blend = res.items.find((i) => i.key === 'deterministicAiBlend');
      const threshold = res.items.find((i) => i.key === 'scoreQualificationThreshold');
      const d = typeof blend?.value === 'number' ? blend.value : Number(blend?.value);
      if (Number.isFinite(d) && d >= 0 && d <= 1) {
        setBlendWeights({ deterministic: d, ai: 1 - d });
      }
      const t = typeof threshold?.value === 'number' ? threshold.value : Number(threshold?.value);
      if (Number.isFinite(t) && t >= 0 && t <= 1) {
        setQualificationThreshold(t);
      }
    }).catch(() => undefined);
  }, [apiClient]);

  const simResult = useMemo(
    () => (selectedProfile ? simulateScore(rules, simForm, blendWeights) : null),
    [selectedProfile, rules, simForm, blendWeights],
  );

  const tier = simResult ? scoreTier(simResult.score) : null;

  if (icpQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading ICP profiles...
      </div>
    );
  }

  if (icpQuery.error) {
    return <p className="text-sm text-destructive">{icpQuery.error}</p>;
  }

  if (profiles.length === 0) {
    return (
      <div className="card">
        <div className="flex flex-col items-center py-12 text-center">
          <Gauge className="h-8 w-8 text-muted-foreground/20" />
          <p className="mt-2 text-sm text-muted-foreground/50">No ICP profiles configured</p>
          <p className="mt-1 text-[11px] text-muted-foreground/30">
            Create ICP profiles via the API to define qualification rules for lead scoring.
          </p>
        </div>
      </div>
    );
  }

  const activeCount = profiles.filter((p) => p.isActive).length;

  return (
    <div className="space-y-4">
      {/* ── Section: Active ICP Profiles Grid ─────────────────── */}
      <div className="card">
        <div className="section-header">
          <div>
            <h2 className="flex items-center gap-2">
              <Gauge className="h-5 w-5 text-zbooni-green" />
              Active ICP Profiles
            </h2>
            <p className="muted">
              {activeCount} of {profiles.length} profiles active. Click to inspect qualification rules.
            </p>
          </div>
        </div>

        <div
          className="mt-4 grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
        >
          {profiles.map((profile) => {
            const isSelected = profile.id === effectiveSelectedId;
            const ruleCount = profile.qualificationRules?.length ?? 0;

            return (
              <button
                key={profile.id}
                type="button"
                onClick={() => setSelectedId(profile.id)}
                className={cn(
                  'group relative rounded-xl border p-4 text-left transition-all duration-200',
                  isSelected
                    ? 'border-zbooni-green/50 bg-zbooni-green/8 shadow-[0_0_20px_rgba(123,255,107,0.06)]'
                    : 'border-border/50 bg-card hover:border-zbooni-teal/30 hover:bg-zbooni-navy/40',
                  !profile.isActive && 'opacity-50',
                )}
              >
                <div className="flex items-start justify-between">
                  <div
                    className={cn(
                      'flex h-10 w-10 items-center justify-center rounded-lg text-sm font-extrabold',
                      isSelected
                        ? 'bg-zbooni-green/20 text-zbooni-green'
                        : 'bg-zbooni-slate/60 text-muted-foreground group-hover:text-foreground',
                    )}
                  >
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        'h-2 w-2 rounded-full',
                        profile.isActive ? 'bg-emerald-400' : 'bg-slate-600',
                      )}
                      title={profile.isActive ? 'Active' : 'Inactive'}
                    />
                  </div>
                </div>

                <h3 className="mt-3 text-sm font-bold tracking-tight">
                  {profile.name}
                </h3>

                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {ruleCount} rules
                  </span>
                  {isSelected ? (
                    <ChevronRight className="h-3.5 w-3.5 text-zbooni-green" />
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Section: Rule Logic Viewer ────────────────────────── */}
      {selectedProfile ? (
        <div className="split">
          <div className="card">
            <div className="section-header">
              <div>
                <h2 className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-zbooni-teal" />
                  Rule Logic: {selectedProfile.name}
                </h2>
                <p className="muted">
                  {rules.length} rules evaluated sequentially.
                  {selectedProfile.targetIndustries.length > 0
                    ? ` Industries: ${selectedProfile.targetIndustries.join(', ')}.`
                    : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCurrentRule({ ...EMPTY_RULE, fieldKey: availableFieldKeys[0] ?? '' });
                  setShowAddRule(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-zbooni-green/15 px-3 py-1.5 text-xs font-semibold text-zbooni-green transition-colors hover:bg-zbooni-green/25"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Rule
              </button>
            </div>

            {/* Real equation display */}
            <div className="mt-4 rounded-lg border border-border/50 bg-slate-800 px-4 py-3">
              <p className="font-mono text-xs leading-relaxed">
                <span className="text-muted-foreground/60">score = </span>
                <span className="font-semibold text-emerald-400">0.10</span>
                <span className="text-muted-foreground/60"> + </span>
                <span className="font-semibold text-blue-400">[</span>
                <span className="text-blue-400">(matched+ + 1)</span>
                <span className="text-muted-foreground/60"> / </span>
                <span className="text-blue-400">(total+ + 1)</span>
                <span className="font-semibold text-blue-400">]</span>
                <span className="text-muted-foreground/60"> &times; </span>
                <span className="font-semibold text-orange-400">clamp</span>
                <span className="text-orange-400">(1 - negPenalty, 0.2, 1.0)</span>
                <span className="text-muted-foreground/60"> &times; </span>
                <span className="text-muted-foreground/60">0.90</span>
                <span className="text-muted-foreground/60"> + </span>
                <span className="font-semibold text-purple-400">categoryBonus</span>
              </p>
              <div className="mt-2 flex flex-wrap gap-3 text-[10px]">
                <span className="text-emerald-400/70">BASE = 0.10</span>
                <span className="text-blue-400/70">matchRatio = positive signal coverage</span>
                <span className="text-orange-400/70">penalty = anti-fit dampening (0.2&ndash;1.0)</span>
                <span className="text-purple-400/70">category = +0.10 / +0.05 / -0.05</span>
              </div>
            </div>

            {/* Hard Filter rules */}
            {hardFilterRules.length > 0 ? (
              <div className="mt-5">
                <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-red-400">
                  <Shield className="h-3.5 w-3.5" />
                  Hard Filters (must pass)
                </h3>
                <div className="space-y-2">
                  {hardFilterRules.map((rule) => {
                    const meta = ruleTypeLabel('HARD_FILTER');
                    return (
                      <div
                        key={rule.id}
                        className={cn('rounded-lg border px-4 py-3', meta.border, meta.bg)}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold">{rule.name}</span>
                          <span className="font-mono text-[11px] text-red-400">REQUIRED</span>
                        </div>
                        <p className="mt-1 font-mono text-xs text-muted-foreground">
                          {rule.fieldKey}{' '}
                          <span className="text-slate-500">{rule.operator}</span>{' '}
                          <span className="text-foreground">{formatValue(rule.valueJson)}</span>
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {/* Weighted rules */}
            {weightedRules.length > 0 ? (
              <div className="mt-5">
                <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-blue-400">
                  <Weight className="h-3.5 w-3.5" />
                  Weighted Rules
                </h3>
                <div className="space-y-2">
                  {weightedRules.map((rule) => {
                    const meta = ruleTypeLabel('WEIGHTED');
                    const w = rule.weight ?? 0;
                    return (
                      <div
                        key={rule.id}
                        className={cn('rounded-lg border px-4 py-3', meta.border, meta.bg)}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold">{rule.name}</span>
                          <span className="font-mono text-[11px] text-blue-400">
                            w={w > 0 ? '+' : ''}{w.toFixed(2)}
                          </span>
                        </div>
                        <p className="mt-1 font-mono text-xs text-muted-foreground">
                          {rule.fieldKey}{' '}
                          <span className="text-slate-500">{rule.operator}</span>{' '}
                          <span className="text-foreground">{formatValue(rule.valueJson)}</span>
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {/* Anti-fit rules */}
            {antiFitRules.length > 0 ? (
              <div className="mt-5">
                <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-orange-400">
                  <Ban className="h-3.5 w-3.5" />
                  Anti-fit Rules (negative weight)
                </h3>
                <div className="space-y-2">
                  {antiFitRules.map((rule) => {
                    const meta = ruleTypeLabel('ANTI_FIT');
                    const w = rule.weight ?? 0;
                    return (
                      <div
                        key={rule.id}
                        className={cn('rounded-lg border px-4 py-3', meta.border, meta.bg)}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold">{rule.name}</span>
                          <span className="font-mono text-[11px] text-orange-400">
                            w={w.toFixed(2)}
                          </span>
                        </div>
                        <p className="mt-1 font-mono text-xs text-muted-foreground">
                          {rule.fieldKey}{' '}
                          <span className="text-slate-500">{rule.operator}</span>{' '}
                          <span className="text-foreground">{formatValue(rule.valueJson)}</span>
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {rules.length === 0 ? (
              <div className="mt-5 flex flex-col items-center py-6 text-center">
                <Shield className="h-6 w-6 text-muted-foreground/20" />
                <p className="mt-2 text-sm text-muted-foreground/50">No rules configured for this profile</p>
              </div>
            ) : null}
          </div>

          {/* ── Section: Score Simulation ──────────────────────────── */}
          {rules.length > 0 ? (
            <div className="card">
              <div className="section-header">
                <div>
                  <h2 className="flex items-center gap-2">
                    <Calculator className="h-5 w-5 text-zbooni-green" />
                    Score Simulation
                  </h2>
                  <p className="muted">
                    Client-side rule evaluation against {selectedProfile.name}.
                  </p>
                </div>
              </div>

              {/* Scoring system info */}
              <div className="mt-4 rounded-lg border border-border/30 bg-slate-800/60 px-4 py-3">
                <div className="flex items-center gap-6 text-xs">
                  <div>
                    <span className="text-muted-foreground/60">ML Features:</span>{' '}
                    <span className="font-bold text-foreground">43</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground/60">Blend Ratio:</span>{' '}
                    <span className="font-bold text-zbooni-teal">90/10</span>
                    <span className="text-muted-foreground/40 mx-1">&rarr;</span>
                    <span className="font-bold text-zbooni-green">70/30</span>
                    <span className="text-muted-foreground/40 mx-1">&rarr;</span>
                    <span className="font-bold text-purple-400">50/50</span>
                  </div>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground/40">
                  Deterministic/ML blend shifts as model improves: 90/10 (no model) &rarr; 70/30 (AUC&ge;0.70, 200+ samples) &rarr; 50/50 (AUC&ge;0.80, 500+ samples)
                </p>
              </div>

              {/* ── 1. Hard Filters ── */}
              <p className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-red-400/60">Hard Filters</p>
              <div className="form-grid mt-2">
                <label>
                  Country
                  <select
                    value={simForm.country}
                    onChange={(e) => setSimForm((prev) => ({ ...prev, country: e.target.value }))}
                  >
                    {COUNTRY_OPTIONS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Data Alignment Score
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={simForm.dataAlignmentScore}
                      onChange={(e) => setSimForm((prev) => ({ ...prev, dataAlignmentScore: Number(e.target.value) }))}
                      className="flex-1"
                    />
                    <span className="font-mono text-xs tabular-nums w-8 text-right">{simForm.dataAlignmentScore.toFixed(2)}</span>
                  </div>
                </label>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <label className="inline-flex items-center gap-1.5 text-[13px]">
                  <input type="checkbox" checked={simForm.hasEmail} onChange={(e) => setSimForm((prev) => ({ ...prev, hasEmail: e.target.checked }))} />
                  Has Email
                </label>
                <label className="inline-flex items-center gap-1.5 text-[13px]">
                  <input type="checkbox" checked={simForm.pureSelfServeEcom} onChange={(e) => setSimForm((prev) => ({ ...prev, pureSelfServeEcom: e.target.checked }))} />
                  Pure Self-Serve Ecom
                </label>
                <label className="inline-flex items-center gap-1.5 text-[13px]">
                  <input type="checkbox" checked={simForm.subscriptionBillingDetected} onChange={(e) => setSimForm((prev) => ({ ...prev, subscriptionBillingDetected: e.target.checked }))} />
                  Subscription Billing
                </label>
              </div>

              {/* ── 2. Weighted Signals (Positive) ── */}
              <p className="mt-5 text-[10px] font-semibold uppercase tracking-wider text-blue-400/60">Weighted Signals (Positive)</p>
              <div className="form-grid mt-2">
                <label>
                  Review Count
                  <input type="number" min={0} value={simForm.reviewCount} onChange={(e) => setSimForm((prev) => ({ ...prev, reviewCount: Number(e.target.value) || 0 }))} />
                </label>
                <label>
                  Decision Makers
                  <input type="number" min={0} value={simForm.decisionMakerCount} onChange={(e) => setSimForm((prev) => ({ ...prev, decisionMakerCount: Number(e.target.value) || 0 }))} />
                </label>
                <label>
                  Payment Widgets
                  <input type="number" min={0} value={simForm.paymentWidgetCount} onChange={(e) => setSimForm((prev) => ({ ...prev, paymentWidgetCount: Number(e.target.value) || 0 }))} />
                </label>
                <label>
                  Social Links
                  <input type="number" min={0} value={simForm.socialLinkCount} onChange={(e) => setSimForm((prev) => ({ ...prev, socialLinkCount: Number(e.target.value) || 0 }))} />
                </label>
                <label>
                  ICP Segment Priority
                  <input type="number" min={0} max={5} value={simForm.icpSegmentPriority} onChange={(e) => setSimForm((prev) => ({ ...prev, icpSegmentPriority: Number(e.target.value) || 0 }))} />
                </label>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <label className="inline-flex items-center gap-1.5 text-[13px]">
                  <input type="checkbox" checked={simForm.hasWhatsapp} onChange={(e) => setSimForm((prev) => ({ ...prev, hasWhatsapp: e.target.checked }))} />
                  Has WhatsApp
                </label>
                <label className="inline-flex items-center gap-1.5 text-[13px]">
                  <input type="checkbox" checked={simForm.hasInstagram} onChange={(e) => setSimForm((prev) => ({ ...prev, hasInstagram: e.target.checked }))} />
                  Has Instagram
                </label>
                <label className="inline-flex items-center gap-1.5 text-[13px]">
                  <input type="checkbox" checked={simForm.customOrderSignals} onChange={(e) => setSimForm((prev) => ({ ...prev, customOrderSignals: e.target.checked }))} />
                  Custom Order Signals
                </label>
                <label className="inline-flex items-center gap-1.5 text-[13px]">
                  <input type="checkbox" checked={simForm.hasBookingOrContactForm} onChange={(e) => setSimForm((prev) => ({ ...prev, hasBookingOrContactForm: e.target.checked }))} />
                  Booking/Contact Form
                </label>
                <label className="inline-flex items-center gap-1.5 text-[13px]">
                  <input type="checkbox" checked={simForm.hasPricingTiers} onChange={(e) => setSimForm((prev) => ({ ...prev, hasPricingTiers: e.target.checked }))} />
                  Has Pricing Tiers
                </label>
                <label className="inline-flex items-center gap-1.5 text-[13px]">
                  <input type="checkbox" checked={simForm.highTicketSignals} onChange={(e) => setSimForm((prev) => ({ ...prev, highTicketSignals: e.target.checked }))} />
                  High-Ticket Signals
                </label>
                <label className="inline-flex items-center gap-1.5 text-[13px]">
                  <input type="checkbox" checked={simForm.hasExecutiveContact} onChange={(e) => setSimForm((prev) => ({ ...prev, hasExecutiveContact: e.target.checked }))} />
                  Has Executive Contact
                </label>
                <label className="inline-flex items-center gap-1.5 text-[13px]">
                  <input type="checkbox" checked={simForm.hasLinkedin} onChange={(e) => setSimForm((prev) => ({ ...prev, hasLinkedin: e.target.checked }))} />
                  Has LinkedIn
                </label>
                <label className="inline-flex items-center gap-1.5 text-[13px]">
                  <input type="checkbox" checked={simForm.recentActivity} onChange={(e) => setSimForm((prev) => ({ ...prev, recentActivity: e.target.checked }))} />
                  Recent Activity
                </label>
              </div>

              {/* ── 3. Anti-fit Signals (Negative) ── */}
              <p className="mt-5 text-[10px] font-semibold uppercase tracking-wider text-orange-400/60">Anti-fit Signals (Negative)</p>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <label className="inline-flex items-center gap-1.5 text-[13px]">
                  <input type="checkbox" checked={simForm.pureSelfServeEcom} onChange={(e) => setSimForm((prev) => ({ ...prev, pureSelfServeEcom: e.target.checked }))} />
                  Pure Self-Serve Ecom
                </label>
                <label className="inline-flex items-center gap-1.5 text-[13px]">
                  <input type="checkbox" checked={simForm.subscriptionBillingDetected} onChange={(e) => setSimForm((prev) => ({ ...prev, subscriptionBillingDetected: e.target.checked }))} />
                  Subscription Billing
                </label>
              </div>

              {/* ── 4. Business Context ── */}
              <p className="mt-5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">Business Context</p>
              <div className="form-grid mt-2">
                <label>
                  Industry
                  <input
                    value={simForm.industry}
                    onChange={(e) => setSimForm((prev) => ({ ...prev, industry: e.target.value }))}
                    placeholder="e.g. retail, restaurant"
                  />
                </label>
                <label>
                  Company Size
                  <input
                    type="number"
                    min={0}
                    value={simForm.companySize}
                    onChange={(e) => setSimForm((prev) => ({ ...prev, companySize: Number(e.target.value) || 0 }))}
                  />
                </label>
                <label>
                  Follower Count
                  <input
                    type="number"
                    min={0}
                    value={simForm.followerCount}
                    onChange={(e) => setSimForm((prev) => ({ ...prev, followerCount: Number(e.target.value) || 0 }))}
                  />
                </label>
                <label>
                  Avg Rating
                  <input
                    type="number"
                    min={0}
                    max={5}
                    step={0.1}
                    value={simForm.avgRating}
                    onChange={(e) => setSimForm((prev) => ({ ...prev, avgRating: Number(e.target.value) || 0 }))}
                  />
                </label>
                <label>
                  Website Emails
                  <input type="number" min={0} value={simForm.websiteEmailCount} onChange={(e) => setSimForm((prev) => ({ ...prev, websiteEmailCount: Number(e.target.value) || 0 }))} />
                </label>
                <label>
                  Website Phones
                  <input type="number" min={0} value={simForm.websitePhoneCount} onChange={(e) => setSimForm((prev) => ({ ...prev, websitePhoneCount: Number(e.target.value) || 0 }))} />
                </label>
                <label>
                  Tech Stack Size
                  <input type="number" min={0} value={simForm.techStackSize} onChange={(e) => setSimForm((prev) => ({ ...prev, techStackSize: Number(e.target.value) || 0 }))} />
                </label>
                <label>
                  Est. Employees
                  <input type="number" min={0} value={simForm.estimatedEmployees} onChange={(e) => setSimForm((prev) => ({ ...prev, estimatedEmployees: Number(e.target.value) || 0 }))} />
                </label>
                <label>
                  Certifications
                  <input type="number" min={0} value={simForm.certificationCount} onChange={(e) => setSimForm((prev) => ({ ...prev, certificationCount: Number(e.target.value) || 0 }))} />
                </label>
                <label>
                  IG Business Category
                  <input value={simForm.instagramBusinessCategory} onChange={(e) => setSimForm((prev) => ({ ...prev, instagramBusinessCategory: e.target.value }))} placeholder="e.g. Shopping & Retail" />
                </label>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <label className="inline-flex items-center gap-1.5 text-[13px]">
                  <input type="checkbox" checked={simForm.hasWebsite} onChange={(e) => setSimForm((prev) => ({ ...prev, hasWebsite: e.target.checked }))} />
                  Has Website
                </label>
                <label className="inline-flex items-center gap-1.5 text-[13px]">
                  <input type="checkbox" checked={simForm.hasCrm} onChange={(e) => setSimForm((prev) => ({ ...prev, hasCrm: e.target.checked }))} />
                  Has CRM
                </label>
                <label className="inline-flex items-center gap-1.5 text-[13px]">
                  <input type="checkbox" checked={simForm.hasLiveChat} onChange={(e) => setSimForm((prev) => ({ ...prev, hasLiveChat: e.target.checked }))} />
                  Has Live Chat
                </label>
                <label className="inline-flex items-center gap-1.5 text-[13px]">
                  <input type="checkbox" checked={simForm.hasAnalytics} onChange={(e) => setSimForm((prev) => ({ ...prev, hasAnalytics: e.target.checked }))} />
                  Has Analytics
                </label>
                <label className="inline-flex items-center gap-1.5 text-[13px]">
                  <input type="checkbox" checked={simForm.acceptsOnlinePayments} onChange={(e) => setSimForm((prev) => ({ ...prev, acceptsOnlinePayments: e.target.checked }))} />
                  Online Payments
                </label>
              </div>

              {/* ── 5. AI / Similarity ── */}
              <p className="mt-5 text-[10px] font-semibold uppercase tracking-wider text-purple-400/60">AI / Similarity</p>
              <div className="mt-2">
                <label className="col-span-full text-[13px]">
                  <span className="mb-1 block text-xs text-muted-foreground/70">AI / Similarity Score: {Math.round(simForm.aiSimilarityScore * 100)}%</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(simForm.aiSimilarityScore * 100)}
                    onChange={(e) => setSimForm((prev) => ({ ...prev, aiSimilarityScore: Number(e.target.value) / 100 }))}
                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-zbooni-dark/40 accent-zbooni-teal"
                  />
                </label>
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => setShowSimulation(true)}
                >
                  Simulate Score
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setSimForm(DEFAULT_SIM);
                    setShowSimulation(false);
                  }}
                >
                  <RotateCcw className="mr-1 inline h-3.5 w-3.5" />
                  Reset
                </button>
              </div>

              {/* Simulation result */}
              {showSimulation && simResult ? (
                <div className="mt-5">
                  <div
                    className={cn(
                      'rounded-xl border px-5 py-4',
                      simResult.passedHard
                        ? 'border-zbooni-green/30 bg-zbooni-green/5'
                        : 'border-red-500/30 bg-red-500/5',
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                          Estimated Blended Score
                        </span>
                        <p className="mt-1 text-4xl font-extrabold tabular-nums tracking-tight text-foreground">
                          {simResult.score.toFixed(2)}
                        </p>
                      </div>
                      {tier ? (
                        <div className={tier.className}>
                          {simResult.passedHard ? tier.label : 'REJECTED'}
                        </div>
                      ) : null}
                    </div>

                    {!simResult.passedHard ? (
                      <p className="mt-2 flex items-center gap-1.5 text-sm text-red-400">
                        <XCircle className="h-4 w-4" />
                        Failed one or more hard filter requirements. Lead would be rejected.
                      </p>
                    ) : null}

                    {/* Qualification path badge */}
                    {simResult.passedHard ? (
                      <div className="mt-2 flex items-center gap-2">
                        <span className={cn(
                          'rounded px-2 py-0.5 text-[10px] font-bold uppercase',
                          simResult.qualificationPath === 'PROCEED' && 'bg-emerald-500/15 text-emerald-400',
                          simResult.qualificationPath === 'SELECTIVE' && 'bg-blue-500/15 text-blue-400',
                          simResult.qualificationPath === 'DISQUALIFY' && 'bg-red-500/15 text-red-400',
                        )}>
                          {simResult.qualificationPath}
                        </span>
                        <span className="text-[10px] text-muted-foreground/50">
                          Category bonus: {simResult.categoryBonus >= 0 ? '+' : ''}{simResult.categoryBonus.toFixed(2)}
                        </span>
                      </div>
                    ) : null}

                    <p className="mt-2 text-xs text-muted-foreground/70">
                      {simResult.equation}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground/60">
                      Runtime threshold: {(qualificationThreshold * 100).toFixed(0)}%
                    </p>
                  </div>

                  <div className="mt-4">
                    <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                      Rule-by-rule breakdown
                    </h3>
                    <div className="space-y-1.5">
                      {simResult.breakdown.map((item) => (
                        <div
                          key={item.rule}
                          className="flex items-center justify-between rounded-lg border border-border/30 bg-slate-800 px-3 py-2"
                        >
                          <div className="flex items-center gap-2">
                            {item.passed ? (
                              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                            ) : (
                              <XCircle className="h-4 w-4 shrink-0 text-red-400" />
                            )}
                            <span className="text-sm">{item.rule}</span>
                          </div>
                          <span
                            className={cn(
                              'font-mono text-xs font-bold',
                              item.contribution > 0
                                ? 'text-emerald-400'
                                : item.contribution < 0
                                  ? 'text-red-400'
                                  : 'text-muted-foreground',
                            )}
                          >
                            {item.contribution > 0 ? '+' : ''}{item.contribution.toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── Add Rule Modal ──────────────────────────────────────── */}
      {showAddRule && selectedProfile ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setShowAddRule(false); }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-rule-title"
        >
          <div className="w-full max-w-xl rounded-2xl border border-border/50 bg-card p-6 shadow-xl animate-in fade-in zoom-in-95 duration-200">
            <div className="mb-4 flex items-center justify-between">
              <h2 id="add-rule-title" className="text-lg font-extrabold tracking-tight">
                Add Rules to {selectedProfile.name}
              </h2>
              <button type="button" onClick={() => setShowAddRule(false)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent/50">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* New rule form */}
            <div className="space-y-3 rounded-xl border border-border/30 bg-zbooni-dark/30 p-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs">
                  <span className="mb-1 block font-semibold text-muted-foreground/70">Rule Name</span>
                  <input
                    value={currentRule.name}
                    onChange={(e) => setCurrentRule((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g. Has WhatsApp"
                    className="h-8 w-full rounded-lg border border-border/50 bg-zbooni-dark/60 px-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </label>
                <label className="text-xs">
                  <span className="mb-1 block font-semibold text-muted-foreground/70">Feature Key</span>
                  <select
                    value={currentRule.fieldKey}
                    onChange={(e) => setCurrentRule((prev) => ({ ...prev, fieldKey: e.target.value }))}
                    className="h-8 w-full rounded-lg border border-border/50 bg-zbooni-dark/60 px-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    {availableFieldKeys.length === 0 ? (
                      <option value="">No keys available</option>
                    ) : null}
                    {availableFieldKeys.map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <label className="text-xs">
                  <span className="mb-1 block font-semibold text-muted-foreground/70">Rule Type</span>
                  <select
                    value={currentRule.ruleType}
                    onChange={(e) => setCurrentRule((prev) => ({ ...prev, ruleType: e.target.value as 'WEIGHTED' | 'HARD_FILTER' }))}
                    className="h-8 w-full rounded-lg border border-border/50 bg-zbooni-dark/60 px-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="WEIGHTED">Weighted</option>
                    <option value="HARD_FILTER">Hard Filter</option>
                  </select>
                </label>
                <label className="text-xs">
                  <span className="mb-1 block font-semibold text-muted-foreground/70">Operator</span>
                  <select
                    value={currentRule.operator}
                    onChange={(e) => setCurrentRule((prev) => ({ ...prev, operator: e.target.value }))}
                    className="h-8 w-full rounded-lg border border-border/50 bg-zbooni-dark/60 px-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    {OPERATORS.map((op) => (
                      <option key={op} value={op}>{op}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs">
                  <span className="mb-1 block font-semibold text-muted-foreground/70">Expected Value</span>
                  <input
                    value={typeof currentRule.valueJson === 'string' ? currentRule.valueJson : JSON.stringify(currentRule.valueJson)}
                    onChange={(e) => {
                      const raw = e.target.value;
                      // Try to parse as JSON (number, boolean, array), fall back to string
                      let parsed: unknown = raw;
                      try { parsed = JSON.parse(raw); } catch { /* keep as string */ }
                      setCurrentRule((prev) => ({ ...prev, valueJson: parsed }));
                    }}
                    placeholder='true, 0.5, ["AE","SA"]'
                    className="h-8 w-full rounded-lg border border-border/50 bg-zbooni-dark/60 px-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </label>
              </div>
              {currentRule.ruleType === 'WEIGHTED' ? (
                <label className="text-xs">
                  <span className="mb-1 block font-semibold text-muted-foreground/70">Weight (-10 to 10)</span>
                  <input
                    type="number"
                    min={-10}
                    max={10}
                    step={0.5}
                    value={currentRule.weight}
                    onChange={(e) => setCurrentRule((prev) => ({ ...prev, weight: Number(e.target.value) || 0 }))}
                    className="h-8 w-24 rounded-lg border border-border/50 bg-zbooni-dark/60 px-2.5 text-sm tabular-nums focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </label>
              ) : null}

              <button
                type="button"
                onClick={addToStaging}
                disabled={!currentRule.name.trim() || !currentRule.fieldKey}
                className="inline-flex items-center gap-1.5 rounded-lg bg-zbooni-teal/15 px-3 py-1.5 text-xs font-semibold text-zbooni-teal transition-colors hover:bg-zbooni-teal/25 disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
                Add to Batch
              </button>
            </div>

            {/* Staged rules list */}
            {stagedRules.length > 0 ? (
              <div className="mt-4">
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground/60">
                  Staged Rules ({stagedRules.length})
                </p>
                <div className="space-y-1.5">
                  {stagedRules.map((rule, idx) => (
                    <div key={idx} className="flex items-center justify-between rounded-lg border border-border/30 bg-zbooni-dark/30 px-3 py-2">
                      <div>
                        <span className="text-sm font-semibold">{rule.name}</span>
                        <span className="ml-2 font-mono text-[10px] text-muted-foreground/50">
                          {rule.fieldKey} {rule.operator} {typeof rule.valueJson === 'string' ? rule.valueJson : JSON.stringify(rule.valueJson)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          'rounded px-1.5 py-0.5 text-[10px] font-bold',
                          rule.ruleType === 'HARD_FILTER' ? 'bg-red-500/15 text-red-400' : 'bg-blue-500/15 text-blue-400',
                        )}>
                          {rule.ruleType === 'HARD_FILTER' ? 'HARD' : `w=${rule.weight}`}
                        </span>
                        <button type="button" onClick={() => removeFromStaging(idx)} className="rounded p-1 text-muted-foreground/40 hover:text-red-400">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Submit */}
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowAddRule(false)}
                className="flex-1 rounded-xl border border-input py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitStagedRules}
                disabled={stagedRules.length === 0 || submittingRules}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-zbooni-green px-4 py-2.5 text-sm font-semibold text-black shadow-lg shadow-zbooni-green/20 transition-all hover:bg-zbooni-green/90 disabled:opacity-50"
              >
                {submittingRules ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Save {stagedRules.length} Rule{stagedRules.length !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
