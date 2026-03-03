'use client';

import { useCallback, useMemo, useState } from 'react';
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
} from 'lucide-react';

import { cn } from '@/lib/utils.js';
import { useAuth } from '@/hooks/use-auth.js';
import { useApiQuery } from '@/hooks/use-api-query.js';

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
  // Core business info
  country: string;
  hasEmail: boolean;
  industry: string;
  companySize: number;
  reviewCount: number;
  followerCount: number;
  hasWhatsapp: boolean;
  hasInstagram: boolean;
  acceptsOnlinePayments: boolean;
  hasWebsite: boolean;
  recentActivity: boolean;
  avgRating: number;
  // V2.1 scraper fields
  decisionMakerCount: number;
  hasExecutiveContact: boolean;
  websiteEmailCount: number;
  websitePhoneCount: number;
  socialLinkCount: number;
  hasLinkedin: boolean;
  techStackSize: number;
  hasCrm: boolean;
  hasLiveChat: boolean;
  hasAnalytics: boolean;
  estimatedEmployees: number;
  certificationCount: number;
  instagramIsVerified: boolean;
  instagramBusinessCategory: string;
  instagramHasBusinessEmail: boolean;
}

const DEFAULT_SIM: SimFormState = {
  country: 'AE',
  hasEmail: true,
  industry: 'retail',
  companySize: 80,
  reviewCount: 120,
  followerCount: 15000,
  hasWhatsapp: true,
  hasInstagram: true,
  acceptsOnlinePayments: true,
  hasWebsite: true,
  recentActivity: true,
  avgRating: 4.3,
  decisionMakerCount: 2,
  hasExecutiveContact: true,
  websiteEmailCount: 1,
  websitePhoneCount: 1,
  socialLinkCount: 4,
  hasLinkedin: true,
  techStackSize: 3,
  hasCrm: false,
  hasLiveChat: false,
  hasAnalytics: true,
  estimatedEmployees: 80,
  certificationCount: 1,
  instagramIsVerified: false,
  instagramBusinessCategory: '',
  instagramHasBusinessEmail: false,
};

const COUNTRY_OPTIONS = ['AE', 'SA', 'JO', 'EG', 'KW', 'BH', 'QA', 'OM', 'Other'];

/* Field key → form field mapping for simulation (covers 67 feature keys) */
const FIELD_KEY_MAP: Record<string, (form: SimFormState) => unknown> = {
  country_code: (f) => f.country,
  has_email: (f) => f.hasEmail,
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
  instagram_is_verified: (f) => f.instagramIsVerified,
  instagram_business_category: (f) => f.instagramBusinessCategory,
  instagram_has_business_email: (f) => f.instagramHasBusinessEmail,
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

function simulateScore(
  rules: QualificationRuleResponse[],
  form: SimFormState,
): { score: number; passedHard: boolean; breakdown: Array<{ rule: string; passed: boolean; contribution: number }> } {
  const breakdown: Array<{ rule: string; passed: boolean; contribution: number }> = [];
  let passedHard = true;
  let weightSum = 0;
  let maxPossibleWeight = 0;

  for (const rule of rules) {
    if (!rule.isActive) continue;

    const passed = evaluateRule(rule, form);
    const category = categorizeRule(rule);

    if (category === 'HARD_FILTER') {
      if (!passed) passedHard = false;
      breakdown.push({ rule: rule.name, passed, contribution: 0 });
    } else if (category === 'WEIGHTED') {
      const w = rule.weight ?? 0;
      maxPossibleWeight += w;
      const contribution = passed ? w : 0;
      weightSum += contribution;
      breakdown.push({ rule: rule.name, passed, contribution });
    } else {
      // ANTI_FIT: negative weight when matched
      const w = rule.weight ?? 0;
      const contribution = passed ? w : 0;
      weightSum += contribution;
      breakdown.push({ rule: rule.name, passed, contribution });
    }
  }

  if (!passedHard) {
    return { score: 0, passedHard: false, breakdown };
  }

  const normalizedScore = maxPossibleWeight > 0 ? weightSum / maxPossibleWeight : 0;
  const finalScore = Math.max(0, Math.min(1, normalizedScore));

  return { score: finalScore, passedHard: true, breakdown };
}

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

export default function ICPRulesPage() {
  const { apiClient } = useAuth();

  const icpQuery = useApiQuery(
    useCallback(() => apiClient.listIcps({ page: 1, pageSize: 100 }), [apiClient]),
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [simForm, setSimForm] = useState<SimFormState>(DEFAULT_SIM);
  const [showSimulation, setShowSimulation] = useState(false);

  const profiles = icpQuery.data?.items ?? [];

  // Auto-select first profile
  const effectiveSelectedId = selectedId ?? profiles[0]?.id ?? null;
  const selectedProfile = profiles.find((p) => p.id === effectiveSelectedId) ?? null;
  const rules = selectedProfile?.qualificationRules ?? [];

  const hardFilterRules = rules.filter((r) => categorizeRule(r) === 'HARD_FILTER');
  const weightedRules = rules.filter((r) => categorizeRule(r) === 'WEIGHTED');
  const antiFitRules = rules.filter((r) => categorizeRule(r) === 'ANTI_FIT');

  const simResult = useMemo(
    () => (selectedProfile ? simulateScore(rules, simForm) : null),
    [selectedProfile, rules, simForm],
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
                {profile.description ? (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground leading-relaxed">
                    {profile.description}
                  </p>
                ) : null}

                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {ruleCount} rules
                  </span>
                  {profile.targetCountries.length > 0 ? (
                    <span className="text-[10px] font-mono text-muted-foreground/60">
                      {profile.targetCountries.slice(0, 3).join(', ')}
                      {profile.targetCountries.length > 3 ? ` +${profile.targetCountries.length - 3}` : ''}
                    </span>
                  ) : null}
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
            </div>

            {/* Full description */}
            {selectedProfile.description ? (
              <div className="mt-4 rounded-lg border border-border/30 bg-slate-800/60 px-4 py-3">
                <div className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">
                  {selectedProfile.description}
                </div>
                {(selectedProfile.targetCountries.length > 0 || selectedProfile.minCompanySize !== null) ? (
                  <div className="mt-3 flex flex-wrap gap-4 border-t border-border/20 pt-3 text-xs text-slate-400">
                    {selectedProfile.targetCountries.length > 0 ? (
                      <span>Countries: <strong className="text-slate-200">{selectedProfile.targetCountries.join(', ')}</strong></span>
                    ) : null}
                    {selectedProfile.minCompanySize !== null || selectedProfile.maxCompanySize !== null ? (
                      <span>Company Size: <strong className="text-slate-200">
                        {selectedProfile.minCompanySize ?? '—'} – {selectedProfile.maxCompanySize ?? '—'}
                      </strong></span>
                    ) : null}
                    {selectedProfile.excludedDomains.length > 0 ? (
                      <span>Excluded: <strong className="text-slate-200">{selectedProfile.excludedDomains.join(', ')}</strong></span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Formula explanation */}
            <div className="mt-4 rounded-lg border border-border/50 bg-slate-800 px-4 py-3">
              <p className="font-mono text-xs text-muted-foreground leading-relaxed">
                Pass all <span className="text-red-400 font-semibold">HARD_FILTERs</span>
                {' '}<span className="text-slate-500">&rarr;</span>{' '}
                Sum <span className="text-blue-400 font-semibold">weights</span>
                {' '}<span className="text-slate-500">&rarr;</span>{' '}
                Normalize
              </p>
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
                    <span className="text-muted-foreground/60">Total Features:</span>{' '}
                    <span className="font-bold text-foreground">67</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground/60">ML Features:</span>{' '}
                    <span className="font-bold text-foreground">48</span>
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

              {/* Core business fields */}
              <p className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">Core Business Info</p>
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
                  Review Count
                  <input
                    type="number"
                    min={0}
                    value={simForm.reviewCount}
                    onChange={(e) => setSimForm((prev) => ({ ...prev, reviewCount: Number(e.target.value) || 0 }))}
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
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <label className="inline-flex items-center gap-1.5 text-[13px]">
                  <input type="checkbox" checked={simForm.hasEmail} onChange={(e) => setSimForm((prev) => ({ ...prev, hasEmail: e.target.checked }))} />
                  Has Email
                </label>
                <label className="inline-flex items-center gap-1.5 text-[13px]">
                  <input type="checkbox" checked={simForm.hasWhatsapp} onChange={(e) => setSimForm((prev) => ({ ...prev, hasWhatsapp: e.target.checked }))} />
                  Has WhatsApp
                </label>
                <label className="inline-flex items-center gap-1.5 text-[13px]">
                  <input type="checkbox" checked={simForm.hasInstagram} onChange={(e) => setSimForm((prev) => ({ ...prev, hasInstagram: e.target.checked }))} />
                  Has Instagram
                </label>
                <label className="inline-flex items-center gap-1.5 text-[13px]">
                  <input type="checkbox" checked={simForm.acceptsOnlinePayments} onChange={(e) => setSimForm((prev) => ({ ...prev, acceptsOnlinePayments: e.target.checked }))} />
                  Online Payments
                </label>
                <label className="inline-flex items-center gap-1.5 text-[13px]">
                  <input type="checkbox" checked={simForm.hasWebsite} onChange={(e) => setSimForm((prev) => ({ ...prev, hasWebsite: e.target.checked }))} />
                  Has Website
                </label>
                <label className="inline-flex items-center gap-1.5 text-[13px]">
                  <input type="checkbox" checked={simForm.recentActivity} onChange={(e) => setSimForm((prev) => ({ ...prev, recentActivity: e.target.checked }))} />
                  Recent Activity
                </label>
              </div>

              {/* V2.1 scraper intelligence fields */}
              <p className="mt-5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">Website &amp; Social Intelligence (v2.1)</p>
              <div className="form-grid mt-2">
                <label>
                  Decision Makers
                  <input type="number" min={0} value={simForm.decisionMakerCount} onChange={(e) => setSimForm((prev) => ({ ...prev, decisionMakerCount: Number(e.target.value) || 0 }))} />
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
                  Social Links
                  <input type="number" min={0} value={simForm.socialLinkCount} onChange={(e) => setSimForm((prev) => ({ ...prev, socialLinkCount: Number(e.target.value) || 0 }))} />
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
                  <input type="checkbox" checked={simForm.hasExecutiveContact} onChange={(e) => setSimForm((prev) => ({ ...prev, hasExecutiveContact: e.target.checked }))} />
                  Has Executive Contact
                </label>
                <label className="inline-flex items-center gap-1.5 text-[13px]">
                  <input type="checkbox" checked={simForm.hasLinkedin} onChange={(e) => setSimForm((prev) => ({ ...prev, hasLinkedin: e.target.checked }))} />
                  Has LinkedIn
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
                  <input type="checkbox" checked={simForm.instagramIsVerified} onChange={(e) => setSimForm((prev) => ({ ...prev, instagramIsVerified: e.target.checked }))} />
                  IG Verified
                </label>
                <label className="inline-flex items-center gap-1.5 text-[13px]">
                  <input type="checkbox" checked={simForm.instagramHasBusinessEmail} onChange={(e) => setSimForm((prev) => ({ ...prev, instagramHasBusinessEmail: e.target.checked }))} />
                  IG Business Email
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
                          Estimated Deterministic Score
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
    </div>
  );
}
