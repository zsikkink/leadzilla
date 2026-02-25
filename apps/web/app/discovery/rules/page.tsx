'use client';

import { useMemo, useState } from 'react';
import {
  Shield,
  Weight,
  Ban,
  ChevronRight,
  Gauge,
  Building2,
  UtensilsCrossed,
  Gem,
  Heart,
  Hotel,
  PartyPopper,
  GraduationCap,
  Landmark,
  CheckCircle2,
  XCircle,
  Calculator,
  RotateCcw,
} from 'lucide-react';
import { cn } from '../../../src/lib/utils.js';

/* ------------------------------------------------------------------ */
/*  ICP Segment data                                                   */
/* ------------------------------------------------------------------ */

interface QualificationRule {
  name: string;
  field: string;
  operator: 'eq' | 'in' | 'gte' | 'lte' | 'exists' | 'not_in' | 'contains';
  expected: string;
  weight: number;
  type: 'HARD_FILTER' | 'WEIGHTED' | 'ANTI_FIT';
}

interface ICPProfile {
  id: string;
  segment: string;
  name: string;
  priority: 'P1' | 'P2';
  active: boolean;
  description: string;
  ruleCount: number;
  priorityBoost: number;
  rules: QualificationRule[];
}

const ICP_ICONS: Record<string, typeof Building2> = {
  A: Building2,
  B: UtensilsCrossed,
  C: Gem,
  D: Heart,
  E: Hotel,
  F: PartyPopper,
  G: GraduationCap,
  H: Landmark,
};

const ICP_PROFILES: ICPProfile[] = [
  {
    id: 'A',
    segment: 'A',
    name: 'Enterprise Commerce',
    priority: 'P1',
    active: true,
    description: 'Large e-commerce and retail brands with established digital presence, processing 500+ monthly transactions.',
    ruleCount: 8,
    priorityBoost: 0.15,
    rules: [
      { name: 'Country filter', field: 'country_code', operator: 'in', expected: 'AE, SA, JO, EG', weight: 0, type: 'HARD_FILTER' },
      { name: 'Has email', field: 'has_email', operator: 'eq', expected: 'true', weight: 0, type: 'HARD_FILTER' },
      { name: 'Industry match', field: 'industry', operator: 'in', expected: 'retail, e-commerce, marketplace', weight: 0.25, type: 'WEIGHTED' },
      { name: 'Company size', field: 'employee_count', operator: 'gte', expected: '50', weight: 0.20, type: 'WEIGHTED' },
      { name: 'Review volume', field: 'review_count', operator: 'gte', expected: '100', weight: 0.15, type: 'WEIGHTED' },
      { name: 'Instagram presence', field: 'has_instagram', operator: 'eq', expected: 'true', weight: 0.10, type: 'WEIGHTED' },
      { name: 'Online payments', field: 'accepts_online_payments', operator: 'eq', expected: 'true', weight: 0.15, type: 'WEIGHTED' },
      { name: 'Competitor using', field: 'uses_competitor', operator: 'eq', expected: 'true', weight: -0.10, type: 'ANTI_FIT' },
    ],
  },
  {
    id: 'B',
    segment: 'B',
    name: 'F&B Chains',
    priority: 'P1',
    active: true,
    description: 'Multi-location restaurants, cafes, and dark kitchens with delivery and dine-in ordering needs.',
    ruleCount: 7,
    priorityBoost: 0.15,
    rules: [
      { name: 'Country filter', field: 'country_code', operator: 'in', expected: 'AE, SA', weight: 0, type: 'HARD_FILTER' },
      { name: 'Has email', field: 'has_email', operator: 'eq', expected: 'true', weight: 0, type: 'HARD_FILTER' },
      { name: 'Industry match', field: 'industry', operator: 'in', expected: 'restaurant, cafe, catering, food delivery', weight: 0.30, type: 'WEIGHTED' },
      { name: 'Location count', field: 'location_count', operator: 'gte', expected: '3', weight: 0.20, type: 'WEIGHTED' },
      { name: 'Review score', field: 'avg_rating', operator: 'gte', expected: '4.0', weight: 0.10, type: 'WEIGHTED' },
      { name: 'WhatsApp ready', field: 'has_whatsapp', operator: 'eq', expected: 'true', weight: 0.15, type: 'WEIGHTED' },
      { name: 'Low digital presence', field: 'has_website', operator: 'eq', expected: 'false', weight: -0.15, type: 'ANTI_FIT' },
    ],
  },
  {
    id: 'C',
    segment: 'C',
    name: 'Luxury & Fashion',
    priority: 'P1',
    active: true,
    description: 'Premium fashion, accessories, and lifestyle brands targeting affluent GCC consumers.',
    ruleCount: 7,
    priorityBoost: 0.15,
    rules: [
      { name: 'Country filter', field: 'country_code', operator: 'in', expected: 'AE, SA, KW, BH, QA', weight: 0, type: 'HARD_FILTER' },
      { name: 'Has email', field: 'has_email', operator: 'eq', expected: 'true', weight: 0, type: 'HARD_FILTER' },
      { name: 'Industry match', field: 'industry', operator: 'in', expected: 'fashion, luxury, jewellery, accessories', weight: 0.25, type: 'WEIGHTED' },
      { name: 'Follower count', field: 'follower_count', operator: 'gte', expected: '10000', weight: 0.20, type: 'WEIGHTED' },
      { name: 'Has website', field: 'has_website', operator: 'eq', expected: 'true', weight: 0.10, type: 'WEIGHTED' },
      { name: 'Online payments', field: 'accepts_online_payments', operator: 'eq', expected: 'true', weight: 0.15, type: 'WEIGHTED' },
      { name: 'Low engagement', field: 'recent_activity', operator: 'eq', expected: 'false', weight: -0.10, type: 'ANTI_FIT' },
    ],
  },
  {
    id: 'D',
    segment: 'D',
    name: 'Health & Wellness',
    priority: 'P2',
    active: true,
    description: 'Clinics, gyms, wellness centers, and pharmacies with appointment booking and product sales needs.',
    ruleCount: 6,
    priorityBoost: 0.08,
    rules: [
      { name: 'Country filter', field: 'country_code', operator: 'in', expected: 'AE, SA', weight: 0, type: 'HARD_FILTER' },
      { name: 'Has email', field: 'has_email', operator: 'eq', expected: 'true', weight: 0, type: 'HARD_FILTER' },
      { name: 'Industry match', field: 'industry', operator: 'in', expected: 'health, wellness, fitness, pharmacy, clinic', weight: 0.30, type: 'WEIGHTED' },
      { name: 'Review count', field: 'review_count', operator: 'gte', expected: '50', weight: 0.15, type: 'WEIGHTED' },
      { name: 'High rating', field: 'avg_rating', operator: 'gte', expected: '4.2', weight: 0.10, type: 'WEIGHTED' },
      { name: 'Franchise flag', field: 'is_franchise', operator: 'eq', expected: 'true', weight: -0.05, type: 'ANTI_FIT' },
    ],
  },
  {
    id: 'E',
    segment: 'E',
    name: 'Hospitality',
    priority: 'P2',
    active: true,
    description: 'Hotels, resorts, and tourism operators with guest communication and upsell requirements.',
    ruleCount: 6,
    priorityBoost: 0.08,
    rules: [
      { name: 'Country filter', field: 'country_code', operator: 'in', expected: 'AE, SA, OM, BH', weight: 0, type: 'HARD_FILTER' },
      { name: 'Has email', field: 'has_email', operator: 'eq', expected: 'true', weight: 0, type: 'HARD_FILTER' },
      { name: 'Industry match', field: 'industry', operator: 'in', expected: 'hotel, resort, tourism, travel', weight: 0.30, type: 'WEIGHTED' },
      { name: 'Review count', field: 'review_count', operator: 'gte', expected: '200', weight: 0.15, type: 'WEIGHTED' },
      { name: 'WhatsApp ready', field: 'has_whatsapp', operator: 'eq', expected: 'true', weight: 0.15, type: 'WEIGHTED' },
      { name: 'Budget tier', field: 'price_tier', operator: 'eq', expected: 'budget', weight: -0.10, type: 'ANTI_FIT' },
    ],
  },
  {
    id: 'F',
    segment: 'F',
    name: 'Events & Entertainment',
    priority: 'P2',
    active: false,
    description: 'Event planners, entertainment venues, and ticketing platforms with seasonal demand spikes.',
    ruleCount: 5,
    priorityBoost: 0.08,
    rules: [
      { name: 'Country filter', field: 'country_code', operator: 'in', expected: 'AE, SA', weight: 0, type: 'HARD_FILTER' },
      { name: 'Has email', field: 'has_email', operator: 'eq', expected: 'true', weight: 0, type: 'HARD_FILTER' },
      { name: 'Industry match', field: 'industry', operator: 'in', expected: 'events, entertainment, ticketing', weight: 0.35, type: 'WEIGHTED' },
      { name: 'Social presence', field: 'follower_count', operator: 'gte', expected: '5000', weight: 0.15, type: 'WEIGHTED' },
      { name: 'Seasonal only', field: 'is_seasonal', operator: 'eq', expected: 'true', weight: -0.10, type: 'ANTI_FIT' },
    ],
  },
  {
    id: 'G',
    segment: 'G',
    name: 'Education & Training',
    priority: 'P2',
    active: true,
    description: 'Schools, training institutes, and e-learning platforms with enrollment and communication flows.',
    ruleCount: 5,
    priorityBoost: 0.08,
    rules: [
      { name: 'Country filter', field: 'country_code', operator: 'in', expected: 'AE, SA, JO, EG', weight: 0, type: 'HARD_FILTER' },
      { name: 'Has email', field: 'has_email', operator: 'eq', expected: 'true', weight: 0, type: 'HARD_FILTER' },
      { name: 'Industry match', field: 'industry', operator: 'in', expected: 'education, training, e-learning', weight: 0.30, type: 'WEIGHTED' },
      { name: 'Student volume', field: 'review_count', operator: 'gte', expected: '30', weight: 0.15, type: 'WEIGHTED' },
      { name: 'Government funded', field: 'is_government', operator: 'eq', expected: 'true', weight: -0.05, type: 'ANTI_FIT' },
    ],
  },
  {
    id: 'H',
    segment: 'H',
    name: 'Government & Public',
    priority: 'P2',
    active: false,
    description: 'Government services, municipalities, and public sector organizations with citizen engagement needs.',
    ruleCount: 5,
    priorityBoost: 0.05,
    rules: [
      { name: 'Country filter', field: 'country_code', operator: 'in', expected: 'AE, SA', weight: 0, type: 'HARD_FILTER' },
      { name: 'Has email', field: 'has_email', operator: 'eq', expected: 'true', weight: 0, type: 'HARD_FILTER' },
      { name: 'Sector match', field: 'industry', operator: 'in', expected: 'government, public sector, municipality', weight: 0.35, type: 'WEIGHTED' },
      { name: 'Size threshold', field: 'employee_count', operator: 'gte', expected: '100', weight: 0.15, type: 'WEIGHTED' },
      { name: 'Long procurement', field: 'procurement_cycle', operator: 'eq', expected: 'long', weight: -0.20, type: 'ANTI_FIT' },
    ],
  },
];

/* ------------------------------------------------------------------ */
/*  Score Simulation form state                                        */
/* ------------------------------------------------------------------ */

interface SimFormState {
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
};

const COUNTRY_OPTIONS = ['AE', 'SA', 'JO', 'EG', 'KW', 'BH', 'QA', 'OM', 'Other'];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function scoreTier(score: number): { label: string; className: string } {
  if (score >= 0.7) return { label: 'HIGH', className: 'tier high' };
  if (score >= 0.4) return { label: 'MEDIUM', className: 'tier medium' };
  return { label: 'LOW', className: 'tier low' };
}

function ruleTypeLabel(type: QualificationRule['type']): { label: string; border: string; bg: string; icon: typeof Shield } {
  switch (type) {
    case 'HARD_FILTER':
      return { label: 'Hard Filter', border: 'border-red-500/40', bg: 'bg-red-500/8', icon: Shield };
    case 'WEIGHTED':
      return { label: 'Weighted', border: 'border-blue-500/40', bg: 'bg-blue-500/8', icon: Weight };
    case 'ANTI_FIT':
      return { label: 'Anti-fit', border: 'border-orange-500/40', bg: 'bg-orange-500/8', icon: Ban };
  }
}

function simulateScore(profile: ICPProfile, form: SimFormState): { score: number; passedHard: boolean; breakdown: Array<{ rule: string; passed: boolean; contribution: number }> } {
  const breakdown: Array<{ rule: string; passed: boolean; contribution: number }> = [];
  let passedHard = true;
  let weightSum = 0;
  let maxPossibleWeight = 0;

  for (const rule of profile.rules) {
    let passed = false;

    // Evaluate rule against form state
    switch (rule.field) {
      case 'country_code': {
        const allowed = rule.expected.split(',').map((s) => s.trim());
        passed = allowed.includes(form.country);
        break;
      }
      case 'has_email':
        passed = form.hasEmail === (rule.expected === 'true');
        break;
      case 'industry': {
        const industries = rule.expected.split(',').map((s) => s.trim().toLowerCase());
        passed = industries.some((ind) => form.industry.toLowerCase().includes(ind));
        break;
      }
      case 'employee_count':
        passed = rule.operator === 'gte' ? form.companySize >= Number(rule.expected) : form.companySize <= Number(rule.expected);
        break;
      case 'review_count':
        passed = rule.operator === 'gte' ? form.reviewCount >= Number(rule.expected) : form.reviewCount <= Number(rule.expected);
        break;
      case 'follower_count':
        passed = rule.operator === 'gte' ? form.followerCount >= Number(rule.expected) : form.followerCount <= Number(rule.expected);
        break;
      case 'has_instagram':
        passed = form.hasInstagram === (rule.expected === 'true');
        break;
      case 'has_whatsapp':
        passed = form.hasWhatsapp === (rule.expected === 'true');
        break;
      case 'accepts_online_payments':
        passed = form.acceptsOnlinePayments === (rule.expected === 'true');
        break;
      case 'has_website':
        passed = form.hasWebsite === (rule.expected === 'true');
        break;
      case 'recent_activity':
        passed = form.recentActivity === (rule.expected === 'true');
        break;
      case 'avg_rating':
        passed = rule.operator === 'gte' ? form.avgRating >= Number(rule.expected) : form.avgRating <= Number(rule.expected);
        break;
      default:
        // For fields not in the form (uses_competitor, is_franchise, etc.), default to not matching
        passed = rule.type === 'ANTI_FIT' ? false : false;
        break;
    }

    if (rule.type === 'HARD_FILTER') {
      if (!passed) passedHard = false;
      breakdown.push({ rule: rule.name, passed, contribution: 0 });
    } else if (rule.type === 'WEIGHTED') {
      maxPossibleWeight += rule.weight;
      const contribution = passed ? rule.weight : 0;
      weightSum += contribution;
      breakdown.push({ rule: rule.name, passed, contribution });
    } else {
      // ANTI_FIT: negative contribution when matched
      const contribution = passed ? rule.weight : 0;
      weightSum += contribution;
      breakdown.push({ rule: rule.name, passed, contribution });
    }
  }

  if (!passedHard) {
    return { score: 0, passedHard: false, breakdown };
  }

  // Normalize: weightSum / maxPossibleWeight, then add priority boost
  const normalizedScore = maxPossibleWeight > 0 ? weightSum / maxPossibleWeight : 0;
  const finalScore = Math.max(0, Math.min(1, normalizedScore + profile.priorityBoost));

  return { score: finalScore, passedHard: true, breakdown };
}

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

export default function ICPRulesPage() {
  const [selectedId, setSelectedId] = useState<string>('A');
  const [simForm, setSimForm] = useState<SimFormState>(DEFAULT_SIM);
  const [showSimulation, setShowSimulation] = useState(false);

  // ICP_PROFILES is non-empty and selectedId defaults to 'A', so this is always defined.
  // The `?? ICP_PROFILES[0]!` satisfies the compiler while remaining safe.
  const selectedProfile: ICPProfile = ICP_PROFILES.find((p) => p.id === selectedId) ?? ICP_PROFILES[0]!;

  const simResult = useMemo(
    () => simulateScore(selectedProfile, simForm),
    [selectedProfile, simForm],
  );

  const tier = scoreTier(simResult.score);

  const hardFilterRules = selectedProfile.rules.filter((r) => r.type === 'HARD_FILTER');
  const weightedRules = selectedProfile.rules.filter((r) => r.type === 'WEIGHTED');
  const antiFitRules = selectedProfile.rules.filter((r) => r.type === 'ANTI_FIT');

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
              {ICP_PROFILES.filter((p) => p.active).length} of {ICP_PROFILES.length} segments active. Click to inspect qualification rules.
            </p>
          </div>
        </div>

        <div
          className="mt-4 grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
        >
          {ICP_PROFILES.map((profile) => {
            const Icon = ICP_ICONS[profile.segment] ?? Building2;
            const isSelected = profile.id === selectedId;

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
                  !profile.active && 'opacity-50',
                )}
              >
                {/* Segment letter badge */}
                <div className="flex items-start justify-between">
                  <div
                    className={cn(
                      'flex h-10 w-10 items-center justify-center rounded-lg text-sm font-extrabold',
                      isSelected
                        ? 'bg-zbooni-green/20 text-zbooni-green'
                        : 'bg-zbooni-slate/60 text-muted-foreground group-hover:text-foreground',
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                        profile.priority === 'P1'
                          ? 'bg-zbooni-green/15 text-zbooni-green'
                          : 'bg-zbooni-teal/15 text-zbooni-teal',
                      )}
                    >
                      {profile.priority}
                    </span>
                    <span
                      className={cn(
                        'h-2 w-2 rounded-full',
                        profile.active ? 'bg-emerald-400' : 'bg-slate-600',
                      )}
                      title={profile.active ? 'Active' : 'Inactive'}
                    />
                  </div>
                </div>

                <h3 className="mt-3 text-sm font-bold tracking-tight">
                  <span className="text-muted-foreground">{profile.segment}.</span>{' '}
                  {profile.name}
                </h3>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground leading-relaxed">
                  {profile.description}
                </p>

                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {profile.ruleCount} rules
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
      <div className="split">
        <div className="card">
          <div className="section-header">
            <div>
              <h2 className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-zbooni-teal" />
                Rule Logic: {selectedProfile.segment}. {selectedProfile.name}
              </h2>
              <p className="muted">
                {selectedProfile.rules.length} rules evaluated sequentially. Priority boost: +{selectedProfile.priorityBoost.toFixed(2)}.
              </p>
            </div>
          </div>

          {/* Formula explanation */}
          <div className="mt-4 rounded-lg border border-border/50 bg-zbooni-dark/40 px-4 py-3">
            <p className="font-mono text-xs text-muted-foreground leading-relaxed">
              Pass all <span className="text-red-400 font-semibold">HARD_FILTERs</span>
              {' '}<span className="text-slate-500">&rarr;</span>{' '}
              Sum <span className="text-blue-400 font-semibold">weights</span>
              {' '}<span className="text-slate-500">&rarr;</span>{' '}
              Normalize
              {' '}<span className="text-slate-500">&rarr;</span>{' '}
              Add <span className="text-zbooni-green font-semibold">priority boost</span> (+{selectedProfile.priorityBoost.toFixed(2)})
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
                  const meta = ruleTypeLabel(rule.type);
                  return (
                    <div
                      key={rule.name}
                      className={cn('rounded-lg border px-4 py-3', meta.border, meta.bg)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">{rule.name}</span>
                        <span className="font-mono text-[11px] text-red-400">REQUIRED</span>
                      </div>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">
                        {rule.field} <span className="text-slate-500">{rule.operator}</span> <span className="text-foreground">{rule.expected}</span>
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
                  const meta = ruleTypeLabel(rule.type);
                  return (
                    <div
                      key={rule.name}
                      className={cn('rounded-lg border px-4 py-3', meta.border, meta.bg)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">{rule.name}</span>
                        <span className="font-mono text-[11px] text-blue-400">
                          w={rule.weight > 0 ? '+' : ''}{rule.weight.toFixed(2)}
                        </span>
                      </div>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">
                        {rule.field} <span className="text-slate-500">{rule.operator}</span> <span className="text-foreground">{rule.expected}</span>
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
                  const meta = ruleTypeLabel(rule.type);
                  return (
                    <div
                      key={rule.name}
                      className={cn('rounded-lg border px-4 py-3', meta.border, meta.bg)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">{rule.name}</span>
                        <span className="font-mono text-[11px] text-orange-400">
                          w={rule.weight.toFixed(2)}
                        </span>
                      </div>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">
                        {rule.field} <span className="text-slate-500">{rule.operator}</span> <span className="text-foreground">{rule.expected}</span>
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        {/* ── Section: Score Simulation ──────────────────────────── */}
        <div className="card">
          <div className="section-header">
            <div>
              <h2 className="flex items-center gap-2">
                <Calculator className="h-5 w-5 text-zbooni-green" />
                Score Simulation
              </h2>
              <p className="muted">
                Client-side rule evaluation against {selectedProfile.segment}. {selectedProfile.name}.
              </p>
            </div>
          </div>

          <div className="form-grid mt-4">
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

          <div className="checkbox-row mt-3">
            <label>
              <input
                type="checkbox"
                checked={simForm.hasEmail}
                onChange={(e) => setSimForm((prev) => ({ ...prev, hasEmail: e.target.checked }))}
              />
              Has Email
            </label>
            <label>
              <input
                type="checkbox"
                checked={simForm.hasWhatsapp}
                onChange={(e) => setSimForm((prev) => ({ ...prev, hasWhatsapp: e.target.checked }))}
              />
              Has WhatsApp
            </label>
            <label>
              <input
                type="checkbox"
                checked={simForm.hasInstagram}
                onChange={(e) => setSimForm((prev) => ({ ...prev, hasInstagram: e.target.checked }))}
              />
              Has Instagram
            </label>
            <label>
              <input
                type="checkbox"
                checked={simForm.acceptsOnlinePayments}
                onChange={(e) => setSimForm((prev) => ({ ...prev, acceptsOnlinePayments: e.target.checked }))}
              />
              Online Payments
            </label>
            <label>
              <input
                type="checkbox"
                checked={simForm.hasWebsite}
                onChange={(e) => setSimForm((prev) => ({ ...prev, hasWebsite: e.target.checked }))}
              />
              Has Website
            </label>
            <label>
              <input
                type="checkbox"
                checked={simForm.recentActivity}
                onChange={(e) => setSimForm((prev) => ({ ...prev, recentActivity: e.target.checked }))}
              />
              Recent Activity
            </label>
          </div>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
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
          {showSimulation ? (
            <div className="mt-5">
              {/* Score display */}
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
                  <div className={tier.className}>
                    {simResult.passedHard ? tier.label : 'REJECTED'}
                  </div>
                </div>

                {!simResult.passedHard ? (
                  <p className="mt-2 flex items-center gap-1.5 text-sm text-red-400">
                    <XCircle className="h-4 w-4" />
                    Failed one or more hard filter requirements. Lead would be rejected.
                  </p>
                ) : null}
              </div>

              {/* Breakdown */}
              <div className="mt-4">
                <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Rule-by-rule breakdown
                </h3>
                <div className="space-y-1.5">
                  {simResult.breakdown.map((item) => (
                    <div
                      key={item.rule}
                      className="flex items-center justify-between rounded-lg border border-border/30 bg-zbooni-dark/30 px-3 py-2"
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
      </div>
    </div>
  );
}
