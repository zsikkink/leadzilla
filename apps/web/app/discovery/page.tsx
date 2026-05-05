'use client';

import {
  AlertTriangle,
  DollarSign,
  Gauge,
  Globe,
  Hash,
  Inbox,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Plus,
  RotateCcw,
  Save,
  Settings,
  Shield,
  ShieldCheck,
  Star,
  Target,
  Timer,
  X,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useApiQuery } from '../../src/hooks/use-api-query.js';
import { useAuth } from '../../src/hooks/use-auth.js';
import {
  SupportedCountryPickerOptions,
  buildDiscoveryCountryCities,
  countryName,
  toDiscoveryCountryCode,
  toDiscoveryCountryCodes,
} from '../../src/lib/countries.js';
// NOTE: Global messagingInstructions removed — per-ICP instructions on ICP detail page are the canonical source.
import { buildPipelineSettingsSavePlan } from '../../src/lib/pipeline-settings-save-plan.js';
import { cn } from '../../src/lib/utils.js';

// ── Setting types ──────────────────────────────────────────────────────
interface SliderSetting {
  type: 'slider';
  key: string;
  label: string;
  description: string;
  spectrum: string;
  icon: React.ComponentType<{ className?: string | undefined }>;
  iconColor: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  format?: ((v: number) => string) | undefined;
}

interface NumberSetting {
  type: 'number';
  key: string;
  label: string;
  description: string;
  spectrum: string;
  icon: React.ComponentType<{ className?: string | undefined }>;
  iconColor: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  unit?: string | undefined;
  prefix?: string | undefined;
}

interface TierBandSetting {
  type: 'tier-bands';
  key: string;
  label: string;
  description: string;
  spectrum: string;
  icon: React.ComponentType<{ className?: string | undefined }>;
  iconColor: string;
  defaultValue: { low: number; med: number; high: number };
}

type PipelineSetting = SliderSetting | NumberSetting | TierBandSetting;

// ── Settings definitions ───────────────────────────────────────────────
const PIPELINE_SETTINGS: PipelineSetting[] = [
  {
    type: 'slider',
    key: 'scoreQualificationThreshold',
    label: 'Score Qualification Threshold',
    description:
      'Minimum final score required for qualification. AI score is used when available; deterministic score is the fallback.',
    spectrum: '0 = qualify almost everything, 1.0 = ultra-selective',
    icon: Target,
    iconColor: 'text-zbooni-green',
    min: 0,
    max: 1,
    step: 0.05,
    defaultValue: 0.5,
    format: (v: number) => v.toFixed(2),
  },
  {
    type: 'slider',
    key: 'enrichmentThreshold',
    label: 'Enrichment Threshold',
    description:
      'Minimum pre-score to justify enrichment cost ($0.02/lead). Below this, email only.',
    spectrum: '0 = enrich all, 1.0 = only enrich top-scoring',
    icon: DollarSign,
    iconColor: 'text-yellow-400',
    min: 0,
    max: 1,
    step: 0.05,
    defaultValue: 0.3,
    format: (v: number) => v.toFixed(2),
  },
  {
    type: 'number',
    key: 'min_review_count',
    label: 'Minimum Google Reviews',
    description: 'Businesses with fewer reviews are disqualified during pre-qualification.',
    spectrum: '0 = no filter, 50+ = established businesses only',
    icon: Star,
    iconColor: 'text-yellow-400',
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 15,
  },
  {
    type: 'tier-bands',
    key: 'scoreTierBands',
    label: 'Score Tier Bands',
    description:
      'Visual labels only. Defines LOW / MEDIUM / HIGH badges and does not change qualification.',
    spectrum: 'Qualification is controlled by Score Qualification Threshold above',
    icon: Gauge,
    iconColor: 'text-purple-400',
    defaultValue: { low: 0.34, med: 0.67, high: 0.67 },
  },
  {
    type: 'number',
    key: 'followUpMaxCount',
    label: 'Follow-up Max Count',
    description: 'Total follow-ups per lead before stopping outreach.',
    spectrum: '1 = single attempt, 10 = aggressive persistence',
    icon: RotateCcw,
    iconColor: 'text-blue-400',
    min: 0,
    max: 10,
    step: 1,
    defaultValue: 3,
    unit: 'follow-ups',
  },
  // followUpIntervalHours and coldLeadTimeoutDays removed — cadence is graduated (see read-only display below settings grid)
  {
    type: 'number',
    key: 'whatsappDailyLimit',
    label: 'WhatsApp Daily Limit',
    description: 'Match your Trengo tier limit. Exceeding causes throttling.',
    spectrum: '1 = trickle, 200 = max throughput',
    icon: MessageSquare,
    iconColor: 'text-zbooni-green',
    min: 1,
    max: 200,
    step: 5,
    defaultValue: 50,
    unit: 'messages/day',
  },
  {
    type: 'number',
    key: 'emailDailyLimit',
    label: 'Email Daily Limit',
    description: 'Warm-up schedule. Start low, increase weekly to avoid spam flags.',
    spectrum: '1 = minimum warm-up, 500 = full capacity',
    icon: Mail,
    iconColor: 'text-blue-300',
    min: 1,
    max: 500,
    step: 5,
    defaultValue: 10,
    unit: 'emails/day',
  },
  {
    type: 'slider',
    key: 'modelActivationAuc',
    label: 'Model Activation AUC',
    description:
      'Minimum model accuracy (AUC) before auto-activating the ML model for scoring.',
    spectrum: '0.5 = random (useless), 1.0 = perfect classifier',
    icon: Zap,
    iconColor: 'text-yellow-400',
    min: 0.5,
    max: 1.0,
    step: 0.01,
    defaultValue: 0.6,
    format: (v: number) => v.toFixed(2),
  },
  {
    type: 'number',
    key: 'providerBudgetCeiling',
    label: 'Provider Budget Ceiling',
    description: 'Maximum spend per provider per day. Prevents runaway API costs.',
    spectrum: '$5 = lean testing, $200+ = scaled acquisition',
    icon: Shield,
    iconColor: 'text-red-400',
    min: 1,
    max: 500,
    step: 5,
    defaultValue: 50,
    prefix: '$',
    unit: '/day',
  },
];

// ── Sub-components ─────────────────────────────────────────────────────

function StatusCard({
  icon: Icon,
  iconColor,
  bgColor,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string | undefined }>;
  iconColor: string;
  bgColor: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${bgColor}`}>
          <Icon className={`h-4 w-4 ${iconColor}`} />
        </div>
        <p className="text-sm font-bold tracking-tight">{label}</p>
      </div>
      {children}
    </div>
  );
}

function SettingSlider({
  setting,
  value,
  onChange,
}: {
  setting: SliderSetting;
  value: number;
  onChange: (v: number) => void;
}) {
  const Icon = setting.icon;
  const pct = ((value - setting.min) / (setting.max - setting.min)) * 100;
  const displayValue = setting.format ? setting.format(value) : String(value);

  return (
    <div className="group rounded-xl border border-border/30 bg-zbooni-dark/40 p-4 transition-colors hover:border-border/50">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.04]`}>
            <Icon className={`h-4 w-4 ${setting.iconColor}`} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold tracking-tight">{setting.label}</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground/50">
              {setting.description}
            </p>
          </div>
        </div>
        <p className="shrink-0 rounded-lg bg-white/[0.04] px-3 py-1.5 font-mono text-sm font-bold tabular-nums tracking-tight">
          {displayValue}
        </p>
      </div>

      <div className="mt-3 pl-11">
        <div className="relative">
          <input
            type="range"
            min={setting.min}
            max={setting.max}
            step={setting.step}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="slider-input w-full cursor-pointer appearance-none bg-transparent focus:outline-none"
            aria-label={setting.label}
            style={
              {
                '--slider-pct': `${pct}%`,
              } as React.CSSProperties
            }
          />
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-[10px] font-medium text-muted-foreground/30">{setting.min}</span>
          <span className="text-[10px] text-muted-foreground/30">{setting.spectrum}</span>
          <span className="text-[10px] font-medium text-muted-foreground/30">{setting.max}</span>
        </div>
      </div>
    </div>
  );
}

function SettingNumber({
  setting,
  value,
  onChange,
}: {
  setting: NumberSetting;
  value: number;
  onChange: (v: number) => void;
}) {
  const Icon = setting.icon;

  return (
    <div className="group rounded-xl border border-border/30 bg-zbooni-dark/40 p-4 transition-colors hover:border-border/50">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.04]">
            <Icon className={`h-4 w-4 ${setting.iconColor}`} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold tracking-tight">{setting.label}</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground/50">
              {setting.description}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 rounded-lg bg-white/[0.04] px-2 py-1">
          {setting.prefix ? (
            <span className="text-xs font-semibold text-muted-foreground/50">
              {setting.prefix}
            </span>
          ) : null}
          <input
            type="number"
            min={setting.min}
            max={setting.max}
            step={setting.step}
            value={value}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isNaN(n) && n >= setting.min && n <= setting.max) {
                onChange(n);
              }
            }}
            className="w-16 bg-transparent text-right font-mono text-sm font-bold tabular-nums tracking-tight text-foreground focus:outline-none"
            aria-label={setting.label}
          />
          {setting.unit ? (
            <span className="text-[10px] font-medium text-muted-foreground/40">
              {setting.unit}
            </span>
          ) : null}
        </div>
      </div>
      <div className="mt-2 pl-11">
        <span className="text-[10px] text-muted-foreground/30">{setting.spectrum}</span>
      </div>
    </div>
  );
}

function SettingTierBands({
  setting,
  value,
  onChange,
}: {
  setting: TierBandSetting;
  value: { low: number; med: number; high: number };
  onChange: (v: { low: number; med: number; high: number }) => void;
}) {
  const Icon = setting.icon;
  const validationError = value.high <= value.low ? 'HIGH threshold must be greater than LOW threshold' : null;

  return (
    <div className="group rounded-xl border border-border/30 bg-zbooni-dark/40 p-4 transition-colors hover:border-border/50">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.04]">
          <Icon className={`h-4 w-4 ${setting.iconColor}`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold tracking-tight">{setting.label}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground/50">
            {setting.description}
          </p>
          <div className="mt-3 flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="rounded-md bg-red-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-400">
                LOW
              </span>
              <span className="text-[10px] text-muted-foreground/40">&lt;</span>
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={value.low}
                onChange={(e) => {
                  const low = Number(e.target.value);
                  onChange({ ...value, low, med: low });
                }}
                className="w-20 rounded-md border border-border/30 bg-white/[0.04] px-2 py-1 text-center font-mono text-xs font-bold tabular-nums text-foreground focus:border-zbooni-teal/50 focus:outline-none"
                aria-label="Low tier upper bound"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="rounded-md bg-yellow-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-yellow-400">
                MED
              </span>
              <span className="text-[10px] text-muted-foreground/40">{value.low.toFixed(2)} – {value.high.toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="rounded-md bg-zbooni-green/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zbooni-green">
                HIGH
              </span>
              <span className="text-[10px] text-muted-foreground/40">&ge;</span>
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={value.high}
                onChange={(e) => {
                  const high = Number(e.target.value);
                  onChange({ ...value, high, med: high });
                }}
                className="w-20 rounded-md border border-border/30 bg-white/[0.04] px-2 py-1 text-center font-mono text-xs font-bold tabular-nums text-foreground focus:border-zbooni-teal/50 focus:outline-none"
                aria-label="High tier lower bound"
              />
            </div>
          </div>
          {validationError ? (
            <p className="mt-1.5 text-[10px] font-medium text-red-400">{validationError}</p>
          ) : (
            <p className="mt-2 text-[10px] text-muted-foreground/30">
              LOW &lt; {value.low.toFixed(2)} · MEDIUM {value.low.toFixed(2)}–{value.high.toFixed(2)} · HIGH &ge; {value.high.toFixed(2)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Settings state type ────────────────────────────────────────────────
interface SettingsState {
  scoreQualificationThreshold: number;
  enrichmentThreshold: number;
  min_review_count: number;
  scoreTierBands: { low: number; med: number; high: number };
  followUpMaxCount: number;
  whatsappDailyLimit: number;
  emailDailyLimit: number;
  modelActivationAuc: number;
  providerBudgetCeiling: number;
}

function getDefaultSettings(): SettingsState {
  return {
    scoreQualificationThreshold: 0.5,
    enrichmentThreshold: 0.3,
    min_review_count: 15,
    scoreTierBands: { low: 0.34, med: 0.67, high: 0.67 },
    followUpMaxCount: 3,
    whatsappDailyLimit: 50,
    emailDailyLimit: 10,
    modelActivationAuc: 0.6,
    providerBudgetCeiling: 50,
  };
}

// Keys that exist in SettingsState (for type-safe lookup)
const NUMERIC_SETTING_KEYS = new Set([
  'scoreQualificationThreshold',
  'enrichmentThreshold',
  'min_review_count',
  'followUpMaxCount',
  'whatsappDailyLimit',
  'emailDailyLimit',
  'modelActivationAuc',
  'providerBudgetCeiling',
]);

const PIPELINE_SETTING_LABELS = Object.fromEntries(
  PIPELINE_SETTINGS.map((setting) => [setting.key, setting.label]),
) as Record<string, string>;

const ADDITIONAL_SETTING_LABELS: Record<string, string> = {
  auto_approve_enabled: 'Auto-Approve Messages',
  auto_approve_score_min: 'Auto-Approve Min Score',
  auto_approve_score_max: 'Auto-Approve Max Score',
  messaging_manual_approval_only: 'Manual Approval Only',
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }
  return 'unknown error';
}

// ── Countries & Cities Manager (A7) ─────────────────────────────────────

interface CountryCityData {
  [country: string]: string[];
}

function normalizeCountrySearchInput(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function CountriesCitiesManager({
  apiClient,
}: {
  apiClient: {
    listPipelineSettings: () => Promise<{ items: Array<{ key: string; value: unknown }> }>;
    updatePipelineSetting: (key: string, value: unknown) => Promise<{ value: unknown }>;
    listIcps: (query?: { page: number; pageSize: number; q?: string | undefined; isActive?: boolean | undefined }) => Promise<{ items: Array<{ targetCountries: string[] }> }>;
  };
}) {
  const [countryCities, setCountryCities] = useState<CountryCityData>({});
  const [loading, setLoading] = useState(true);
  const [expandedCountry, setExpandedCountry] = useState<string | null>(null);
  const [newCountry, setNewCountry] = useState('');
  const [showCountryInput, setShowCountryInput] = useState(false);
  const [countryInputError, setCountryInputError] = useState<string | null>(null);
  const [newCityInputs, setNewCityInputs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadAndMerge() {
      try {
        const [settingsRes, icpsRes] = await Promise.all([
          apiClient.listPipelineSettings(),
          apiClient.listIcps({ page: 1, pageSize: 100 }),
        ]);

        if (cancelled) return;

        const setting = settingsRes.items.find((i) => i.key === 'countryCities');
        const existing = buildDiscoveryCountryCities(setting?.value, {
          includeCuratedDefaults: true,
        });
        const merged: CountryCityData = { ...existing };
        const icpCountries = new Set(
          toDiscoveryCountryCodes(icpsRes.items.flatMap((icp) => icp.targetCountries)),
        );

        for (const country of icpCountries) {
          if (country && !(country in merged)) {
            merged[country] = [];
          }
        }

        setCountryCities(merged);

        // Persist the merged result so curated defaults + ICP countries stay canonical.
        const existingJson = JSON.stringify(existing);
        const mergedJson = JSON.stringify(merged);
        if (existingJson !== mergedJson) {
          await apiClient.updatePipelineSetting('countryCities', merged);
        }
      } catch {
        // ignore — settings may not exist yet
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadAndMerge();
    return () => { cancelled = true; };
  }, [apiClient]);

  const save = async (data: CountryCityData) => {
    setSaving(true);
    try {
      const saved = await apiClient.updatePipelineSetting('countryCities', data);
      setCountryCities(buildDiscoveryCountryCities(saved.value));
      toast.success('Countries & cities saved');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const matchingCountryOptions = useMemo(() => {
    const query = normalizeCountrySearchInput(newCountry);
    const existingCountries = new Set(Object.keys(countryCities));

    return SupportedCountryPickerOptions.filter((option) => {
      if (existingCountries.has(option.code)) {
        return false;
      }

      if (query.length === 0) {
        return true;
      }

      return option.searchText.includes(query);
    }).slice(0, 8);
  }, [countryCities, newCountry]);

  const addCountry = (countryCode?: string) => {
    const resolvedCode = countryCode ?? toDiscoveryCountryCode(newCountry);
    if (!resolvedCode) {
      setCountryInputError('Country not recognized. Please select a valid country from the list.');
      return;
    }
    if (resolvedCode in countryCities) {
      setCountryInputError('Country already added.');
      return;
    }
    const updated = { ...countryCities, [resolvedCode]: [] };
    setNewCountry('');
    setShowCountryInput(false);
    setCountryInputError(null);
    setExpandedCountry(resolvedCode);
    void save(updated);
  };

  const removeCountry = (country: string) => {
    const updated = { ...countryCities };
    delete updated[country];
    if (expandedCountry === country) setExpandedCountry(null);
    void save(updated);
  };

  const addCity = (country: string) => {
    const city = (newCityInputs[country] ?? '').trim();
    if (!city || countryCities[country]?.includes(city)) return;
    const updated = { ...countryCities, [country]: [...(countryCities[country] ?? []), city] };
    setNewCityInputs((prev) => ({ ...prev, [country]: '' }));
    void save(updated);
  };

  const removeCity = (country: string, city: string) => {
    const updated = {
      ...countryCities,
      [country]: (countryCities[country] ?? []).filter((c) => c !== city),
    };
    void save(updated);
  };

  const countries = Object.keys(countryCities).sort((left, right) =>
    countryName(left).localeCompare(countryName(right)),
  );

  return (
    <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zbooni-teal/10">
          <Globe className="h-4 w-4 text-zbooni-teal" />
        </div>
        <div>
          <h2 className="text-base font-bold tracking-tight">Countries & Cities</h2>
          <p className="text-[11px] text-muted-foreground/50">
            Manage target countries and cities. Used in ICP selectors and discovery search filters.
          </p>
        </div>
        {saving ? <Loader2 className="ml-auto h-4 w-4 animate-spin text-muted-foreground" /> : null}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground/50">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[65fr_35fr] gap-4">
          {/* LEFT PANEL — Country pills in scrollable bordered container */}
          <div className="rounded-xl border border-border/40 bg-card/50 p-4 flex flex-col">
            <div className="max-h-[350px] overflow-y-auto mb-3">
            {countries.length > 0 ? (
              <div className="grid grid-cols-3 gap-2">
                {countries.map((country) => {
                  const isSelected = expandedCountry === country;
                  const cities = countryCities[country] ?? [];

                  return (
                    <div key={country} className="group relative">
                      <button
                        type="button"
                        onClick={() => setExpandedCountry(isSelected ? null : country)}
                        className={cn(
                          'flex items-center justify-center w-full rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors text-center',
                          isSelected
                            ? 'border-zbooni-teal/40 bg-zbooni-teal/[0.06] text-zbooni-teal'
                            : 'border-border/30 bg-zbooni-dark/30 text-muted-foreground hover:border-border/50 hover:text-foreground',
                        )}
                      >
                        <Globe className="h-3 w-3 mr-1.5 shrink-0" />
                        <span className="truncate">{countryName(country)}</span>
                        <span className="ml-1.5 shrink-0 font-mono text-[10px] text-muted-foreground/50">({cities.length})</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => removeCountry(country)}
                        className="absolute -right-1 -top-1 rounded-full bg-card p-0.5 text-muted-foreground/20 opacity-0 transition-all group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-400"
                        title="Remove country"
                      >
                        <X className="h-3 w-3" />
                      </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="py-4 text-center text-sm text-muted-foreground/40 italic">No countries configured</p>
              )}
            </div>

            {/* Add country — pinned below scrollable grid */}
            <div className="flex items-center gap-2">
              {showCountryInput ? (
                <div className="relative flex-1">
                  <div className="flex items-center gap-1.5">
                    <input
                      value={newCountry}
                      onChange={(e) => {
                        setNewCountry(e.target.value);
                        setCountryInputError(null);
                      }}
                      placeholder="Search countries..."
                      className="h-8 w-48 rounded-full border border-border/50 bg-zbooni-dark/60 px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addCountry(matchingCountryOptions[0]?.code);
                        }
                        if (e.key === 'Escape') {
                          setShowCountryInput(false);
                          setNewCountry('');
                          setCountryInputError(null);
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => addCountry(matchingCountryOptions[0]?.code)}
                      disabled={!newCountry.trim()}
                      className="rounded-full bg-zbooni-teal/15 p-1.5 text-zbooni-teal transition-colors hover:bg-zbooni-teal/25 disabled:opacity-40"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowCountryInput(false);
                        setNewCountry('');
                        setCountryInputError(null);
                      }}
                      className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent/50"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {countryInputError ? (
                    <p className="mt-1 text-[10px] text-red-400">{countryInputError}</p>
                  ) : null}
                  {matchingCountryOptions.length > 0 ? (
                    <div className="absolute left-0 top-full z-20 mt-1 max-h-56 w-64 overflow-y-auto rounded-xl border border-border/50 bg-card p-1 shadow-xl shadow-black/20">
                      {matchingCountryOptions.map((option) => (
                        <button
                          key={option.code}
                          type="button"
                          onClick={() => addCountry(option.code)}
                          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-accent/50"
                        >
                          <span>{option.label}</span>
                          <span className="text-[10px] font-mono text-muted-foreground/50">{option.code}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setShowCountryInput(true);
                    setCountryInputError(null);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full bg-zbooni-teal/10 px-3 py-1.5 text-xs font-medium text-zbooni-teal transition-colors hover:bg-zbooni-teal/20"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Country
                </button>
              )}
            </div>
          </div>

          {/* RIGHT PANEL — Selected country's cities */}
          <div className="sticky top-0 self-start">
            {expandedCountry ? (
              <div className="space-y-3 rounded-xl border border-border/30 bg-zbooni-dark/20 p-4">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-zbooni-teal" />
                  <h3 className="text-sm font-semibold text-foreground">{countryName(expandedCountry)}</h3>
                  <span className="font-mono text-[10px] text-muted-foreground/50">
                    {(countryCities[expandedCountry] ?? []).length} cities
                  </span>
                </div>

                {(countryCities[expandedCountry] ?? []).length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {(countryCities[expandedCountry] ?? []).map((city) => (
                      <span
                        key={city}
                        className="inline-flex items-center gap-1 rounded-full bg-zbooni-dark/60 px-2.5 py-1 text-xs text-muted-foreground"
                      >
                        <MapPin className="h-2.5 w-2.5" />
                        {city}
                        <button
                          type="button"
                          onClick={() => removeCity(expandedCountry, city)}
                          className="ml-0.5 rounded-full transition-colors hover:text-red-400"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground/40 italic">No cities added yet</p>
                )}

                <div className="flex items-center gap-1.5">
                  <input
                    value={newCityInputs[expandedCountry] ?? ''}
                    onChange={(e) => setNewCityInputs((prev) => ({ ...prev, [expandedCountry]: e.target.value }))}
                    placeholder="Add city..."
                    className="h-7 w-40 rounded-full border border-border/50 bg-zbooni-dark/60 px-3 text-xs focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addCity(expandedCountry);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => addCity(expandedCountry)}
                    className="rounded-full p-1 text-zbooni-teal transition-colors hover:bg-zbooni-teal/10"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-border/30 bg-zbooni-dark/10">
                <p className="text-sm text-muted-foreground/40 italic">Select a country to manage its cities</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────

export default function ControlsSettingsPage() {
  const { apiClient, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [settings, setSettings] = useState<SettingsState>(getDefaultSettings);
  const [manualApprovalOnly, setManualApprovalOnly] = useState(false);
  const [autoApproveEnabled, setAutoApproveEnabled] = useState(false);
  const [autoApproveScoreMin, setAutoApproveScoreMin] = useState(0.5);
  const [autoApproveScoreMax, setAutoApproveScoreMax] = useState(1.0);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(null);
  const loadedRef = useRef(false);
  const loadedSettingsRef = useRef<Record<string, unknown> | null>(null);

  const loadSettings = useCallback(async () => {
    setIsLoadingSettings(true);
    setSettingsLoadError(null);

    try {
      const { items } = await apiClient.listPipelineSettings();
      const newSettings = { ...getDefaultSettings() };
      let nextManualApprovalOnly = false;
      let nextAutoApproveEnabled = false;
      let nextAutoApproveScoreMin = 0.5;
      let nextAutoApproveScoreMax = 1.0;

      for (const item of items) {
        if (item.key === 'messaging_manual_approval_only') {
          nextManualApprovalOnly = item.value === true || item.value === 'true';
        } else if (item.key === 'auto_approve_enabled') {
          nextAutoApproveEnabled = item.value === true || item.value === 'true';
        } else if (item.key === 'auto_approve_score_min') {
          const value = Number(item.value);
          if (!Number.isNaN(value)) {
            nextAutoApproveScoreMin = value;
          }
        } else if (item.key === 'auto_approve_score_max') {
          const value = Number(item.value);
          if (!Number.isNaN(value)) {
            nextAutoApproveScoreMax = value;
          }
        } else if (item.key === 'scoreTierBands') {
          const val = item.value as {
            low?: number | undefined;
            med?: number | undefined;
            high?: number | undefined;
          } | null;
          if (val && typeof val === 'object') {
            newSettings.scoreTierBands = {
              low: val.low ?? 0.34,
              med: val.med ?? 0.67,
              high: val.high ?? 0.67,
            };
          }
        } else if (NUMERIC_SETTING_KEYS.has(item.key)) {
          const num = Number(item.value);
          if (!Number.isNaN(num)) {
            (newSettings as Record<string, unknown>)[item.key] = num;
          }
        }
      }

      setSettings(newSettings);
      setManualApprovalOnly(nextManualApprovalOnly);
      setAutoApproveEnabled(nextAutoApproveEnabled);
      setAutoApproveScoreMin(nextAutoApproveScoreMin);
      setAutoApproveScoreMax(nextAutoApproveScoreMax);
      setHasChanges(false);
      loadedSettingsRef.current = {
        ...newSettings,
        messaging_manual_approval_only: nextManualApprovalOnly,
        auto_approve_enabled: nextAutoApproveEnabled,
        auto_approve_score_min: nextAutoApproveScoreMin,
        auto_approve_score_max: nextAutoApproveScoreMax,
      };
    } catch (error: unknown) {
      loadedSettingsRef.current = null;
      setSettingsLoadError(getErrorMessage(error));
    } finally {
      setIsLoadingSettings(false);
    }
  }, [apiClient]);

  // Load all settings from API on mount once auth is ready
  useEffect(() => {
    if (loadedRef.current || isAuthLoading || !isAuthenticated) {
      return;
    }

    loadedRef.current = true;
    void loadSettings();
  }, [isAuthLoading, isAuthenticated, loadSettings]);

  // Real data queries for status cards
  const stats = useApiQuery(
    useCallback(() => apiClient.getPipelineStats(), [apiClient]),
  );
  const pendingDrafts = useApiQuery(
    useCallback(
      () => apiClient.listDrafts({ approvalStatus: 'PENDING' as never, page: 1, pageSize: 1 }),
      [apiClient],
    ),
  );

  const updateSetting = useCallback(
    <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
      setHasChanges(true);
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (autoApproveScoreMin > autoApproveScoreMax) {
      toast.error('Auto-approve min score must be less than or equal to the max score.');
      return;
    }

    const currentSettings = loadedSettingsRef.current;
    if (!currentSettings) {
      toast.error('Saved settings are unavailable. Retry loading before saving changes.');
      return;
    }

    const nextSettings = {
      ...settings,
      messaging_manual_approval_only: manualApprovalOnly,
      auto_approve_enabled: autoApproveEnabled,
      auto_approve_score_min: autoApproveScoreMin,
      auto_approve_score_max: autoApproveScoreMax,
    };

    const saveTargets = buildPipelineSettingsSavePlan({
      currentValues: currentSettings,
      nextValues: nextSettings,
      labels: {
        ...PIPELINE_SETTING_LABELS,
        ...ADDITIONAL_SETTING_LABELS,
      },
    });

    if (saveTargets.length === 0) {
      setHasChanges(false);
      return;
    }

    setIsSaving(true);
    const results: Array<
      | { key: string; value: unknown; label: string; success: true }
      | { key: string; value: unknown; label: string; success: false; errorMessage: string }
    > = [];

    for (const target of saveTargets) {
      try {
        await apiClient.updatePipelineSetting(target.key, target.value);
        results.push({ ...target, success: true });
      } catch (error: unknown) {
        results.push({
          ...target,
          success: false,
          errorMessage: getErrorMessage(error),
        });
      }
    }

    const successfulTargets = results.filter(
      (result): result is { key: string; value: unknown; label: string; success: true } =>
        result.success,
    );
    if (successfulTargets.length > 0) {
      loadedSettingsRef.current = {
        ...currentSettings,
        ...Object.fromEntries(successfulTargets.map((result) => [result.key, result.value])),
      };
    }

    const failedSaves = results.filter(
      (result): result is {
        key: string;
        value: unknown;
        label: string;
        success: false;
        errorMessage: string;
      } => !result.success,
    );
    const successfulSaveCount = successfulTargets.length;

    if (failedSaves.length === 0) {
      toast.success(`Saved ${successfulSaveCount} settings.`);
      setHasChanges(false);
      setIsSaving(false);
      return;
    }

    const failedSummary = failedSaves
      .map((result) => `${result.label} (${result.errorMessage})`)
      .join('; ');

    if (successfulSaveCount > 0) {
      toast.error(`Saved ${successfulSaveCount} settings. Failed to save: ${failedSummary}`);
    } else {
      toast.error(`Failed to save settings: ${failedSummary}`);
    }
    setHasChanges(true);
    setIsSaving(false);
  }, [
    apiClient,
    autoApproveEnabled,
    autoApproveScoreMax,
    autoApproveScoreMin,
    manualApprovalOnly,
    settings,
  ]);

  const handleReset = useCallback(() => {
    setSettings(getDefaultSettings());
    setManualApprovalOnly(false);
    setAutoApproveEnabled(false);
    setAutoApproveScoreMin(0.5);
    setAutoApproveScoreMax(1.0);
    setHasChanges(true);
    toast.info('Settings reset to defaults — click Save to persist');
  }, []);

  const saveDisabled =
    !hasChanges || isSaving || isLoadingSettings || settingsLoadError !== null;
  const resetDisabled = isLoadingSettings || settingsLoadError !== null;

  return (
    <div className="space-y-6">
      {/* ── Page header ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Controls & Settings</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Pipeline configuration, system health, and outbox monitor
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleReset}
            disabled={resetDisabled}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors',
              resetDisabled
                ? 'cursor-not-allowed bg-muted/10 text-muted-foreground/40'
                : 'bg-muted/20 text-muted-foreground hover:bg-muted/40',
            )}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset Defaults
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saveDisabled}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-all',
              !saveDisabled
                ? 'bg-zbooni-teal/20 text-zbooni-teal hover:bg-zbooni-teal/30'
                : 'cursor-not-allowed bg-muted/20 text-muted-foreground/60',
            )}
          >
            {isSaving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {isSaving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>

      {settingsLoadError ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold text-red-300">Saved settings failed to load</p>
              <p className="mt-1 text-red-100/80">
                {settingsLoadError}. The values on this page may be defaults, so saving is disabled until a retry succeeds.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadSettings()}
              disabled={isLoadingSettings}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-100 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoadingSettings ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
              Retry Load
            </button>
          </div>
        </div>
      ) : null}

      {/* ── System Status Cards (4-col grid) ────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* Lead Status Distribution */}
        <StatusCard
          icon={Hash}
          iconColor="text-zbooni-teal"
          bgColor="bg-zbooni-teal/10"
          label="Lead Distribution"
        >
          {stats.isLoading ? (
            <p className="text-xs text-muted-foreground/50">Loading...</p>
          ) : stats.data ? (
            <div className="space-y-2">
              {Object.entries(stats.data.leadDistribution).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between">
                  <span className="text-[11px] font-medium capitalize text-muted-foreground/60">
                    {status}
                  </span>
                  <span className="font-mono text-xs font-bold tabular-nums">{count}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground/40">No data</p>
          )}
        </StatusCard>

        {/* Provider Status */}
        <StatusCard
          icon={Zap}
          iconColor="text-zbooni-green"
          bgColor="bg-zbooni-green/10"
          label="Provider Capabilities"
        >
          <div className="space-y-2">
            {[
              { name: 'Google Places', desc: 'Business discovery', color: 'text-zbooni-teal' },
              { name: 'Hunter', desc: 'Email lookup', color: 'text-yellow-400' },
              { name: 'Apollo', desc: 'Contact enrichment', color: 'text-purple-400' },
              { name: 'Brave Search', desc: 'Web search / DM lookup', color: 'text-blue-400' },
            ].map((provider) => (
              <div key={provider.name} className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${provider.color} bg-current`} />
                  <span className="text-[11px] font-medium text-muted-foreground/60">
                    {provider.name}
                  </span>
                </div>
                <span className="text-[10px] text-muted-foreground/40">{provider.desc}</span>
              </div>
            ))}
            <p className="pt-1 text-[10px] leading-relaxed text-muted-foreground/40">
              Capability list only. Live provider health is not wired on this screen.
            </p>
          </div>
        </StatusCard>

        {/* DLQ Depth */}
        <StatusCard
          icon={AlertTriangle}
          iconColor="text-yellow-400"
          bgColor="bg-yellow-500/10"
          label="DLQ Depth"
        >
          <div className="flex flex-col items-center py-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-muted-foreground/40" />
              <span className="text-2xl font-extrabold tracking-tight text-muted-foreground/60">--</span>
            </div>
            <p className="mt-1 text-[10px] font-medium text-muted-foreground/40">
              Not wired on this screen yet
            </p>
          </div>
        </StatusCard>

        {/* Pending Approvals */}
        <StatusCard
          icon={Inbox}
          iconColor="text-purple-400"
          bgColor="bg-purple-500/10"
          label="Pending Approvals"
        >
          <div className="flex flex-col items-center py-2">
            <span className="text-2xl font-extrabold tracking-tight text-yellow-400">
              {stats.data?.pendingApprovals ?? pendingDrafts.data?.total ?? 0}
            </span>
            <p className="mt-1 text-[10px] font-medium text-muted-foreground/40">
              Operator-generated drafts awaiting approval
            </p>
          </div>
        </StatusCard>
      </div>

      <div className="rounded-2xl border border-border/50 bg-card/60 px-4 py-3 text-xs text-muted-foreground/70 shadow-sm">
        Qualified leads do not auto-enter messaging. Operators generate drafts from Leads, and sending then depends on approval or auto-approval settings.
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-zbooni-teal/25 bg-zbooni-teal/5 px-4 py-3 text-sm shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold text-foreground">Outreach prompt controls moved to Prompt Center</p>
          <p className="mt-0.5 text-xs text-muted-foreground/60">
            Edit global outreach role and instructions there. This page now keeps operational pipeline settings only.
          </p>
        </div>
        <Link
          href="/dashboard/prompts"
          className="inline-flex items-center justify-center rounded-lg bg-zbooni-teal/15 px-3 py-2 text-xs font-semibold text-zbooni-teal transition-colors hover:bg-zbooni-teal/25"
        >
          Open Prompt Center
        </Link>
      </div>

      {/* ── Pipeline Settings ───────────────────────────────────────── */}
      <div id="pipeline-settings" className="relative scroll-mt-20">
        <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-zbooni-teal/[0.02] via-transparent to-zbooni-green/[0.02]" />
        <div className="relative space-y-4 rounded-3xl border border-border/30 p-6">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zbooni-teal/10">
              <Settings className="h-4 w-4 text-zbooni-teal" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight">Pipeline Settings</h2>
              <p className="text-[11px] text-muted-foreground/50">
                Tune scoring, messaging, and automation parameters
              </p>
            </div>
            {hasChanges ? (
              <span className="ml-auto rounded-full bg-yellow-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-yellow-400">
                Unsaved
              </span>
            ) : null}
          </div>

          {isLoadingSettings ? (
            <div className="flex items-center gap-2 py-8 justify-center text-sm text-muted-foreground/50">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading pipeline settings...
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {PIPELINE_SETTINGS.map((setting) => {
                if (setting.type === 'slider') {
                  return (
                    <SettingSlider
                      key={setting.key}
                      setting={setting}
                      value={settings[setting.key as keyof SettingsState] as number}
                      onChange={(v) => updateSetting(setting.key as keyof SettingsState, v as never)}
                    />
                  );
                }
                if (setting.type === 'number') {
                  return (
                    <SettingNumber
                      key={setting.key}
                      setting={setting}
                      value={settings[setting.key as keyof SettingsState] as number}
                      onChange={(v) => updateSetting(setting.key as keyof SettingsState, v as never)}
                    />
                  );
                }
                if (setting.type === 'tier-bands') {
                  return (
                    <SettingTierBands
                      key={setting.key}
                      setting={setting}
                      value={settings.scoreTierBands}
                      onChange={(v) => updateSetting('scoreTierBands', v)}
                    />
                  );
                }
                return null;
              })}

              {/* Auto-Approve Messages */}
              <div className="rounded-xl border border-border/30 bg-zbooni-dark/40 p-4 transition-colors hover:border-border/50">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.04]">
                      <ShieldCheck className="h-4 w-4 text-zbooni-green" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold tracking-tight">Auto-Approve Messages</p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground/50">
                        Automatically approve and send messages for leads scoring within the range below
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={autoApproveEnabled}
                    onClick={() => {
                      setAutoApproveEnabled(!autoApproveEnabled);
                      setHasChanges(true);
                    }}
                    className={cn(
                      'relative inline-flex h-6 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors',
                      autoApproveEnabled ? 'bg-zbooni-green' : 'bg-muted/40',
                    )}
                  >
                    <span
                      className={cn(
                        'pointer-events-none absolute h-5 w-5 rounded-full bg-white shadow-lg transition-transform',
                        autoApproveEnabled ? 'translate-x-[26px]' : 'translate-x-0',
                      )}
                    />
                  </button>
                </div>
                <div className="mt-3 space-y-2 pl-11">
                  <p className="text-[10px] font-medium text-muted-foreground/40">Score range for auto-approve:</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      value={autoApproveScoreMin}
                      onChange={(e) => {
                        setAutoApproveScoreMin(Number(e.target.value));
                        setHasChanges(true);
                      }}
                      className="w-20 rounded-md border border-border/30 bg-white/[0.04] px-2 py-1 text-center font-mono text-xs font-bold tabular-nums text-foreground focus:border-zbooni-teal/50 focus:outline-none"
                      aria-label="Min auto-approve score"
                    />
                    <span className="text-[10px] text-muted-foreground/40">&le; score &le;</span>
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      value={autoApproveScoreMax}
                      onChange={(e) => {
                        setAutoApproveScoreMax(Number(e.target.value));
                        setHasChanges(true);
                      }}
                      className="w-20 rounded-md border border-border/30 bg-white/[0.04] px-2 py-1 text-center font-mono text-xs font-bold tabular-nums text-foreground focus:border-zbooni-teal/50 focus:outline-none"
                      aria-label="Max auto-approve score"
                    />
                  </div>
                  {autoApproveScoreMin > autoApproveScoreMax ? (
                    <p className="text-[10px] font-medium text-red-400">Min must be ≤ Max</p>
                  ) : null}
                </div>
              </div>

              {/* Manual Approval Only */}
              <div className="rounded-xl border border-border/30 bg-zbooni-dark/40 p-4 transition-colors hover:border-border/50">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.04]">
                      <Shield className="h-4 w-4 text-yellow-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold tracking-tight">Manual Approval Only</p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground/50">
                        Require operator approval before generated drafts can be sent. Overrides auto-approve when enabled.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={manualApprovalOnly}
                    onClick={() => {
                      setManualApprovalOnly(!manualApprovalOnly);
                      setHasChanges(true);
                    }}
                    className={cn(
                      'relative inline-flex h-6 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors',
                      manualApprovalOnly ? 'bg-yellow-500' : 'bg-muted/40',
                    )}
                  >
                    <span
                      className={cn(
                        'pointer-events-none absolute h-5 w-5 rounded-full bg-white shadow-lg transition-transform',
                        manualApprovalOnly ? 'translate-x-[26px]' : 'translate-x-0',
                      )}
                    />
                  </button>
                </div>
              </div>

              {/* Read-only follow-up cadence display */}
              <div className="rounded-xl border border-border/30 bg-zbooni-dark/40 p-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.04]">
                    <Timer className="h-4 w-4 text-zbooni-teal" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold tracking-tight">Follow-up Cadence</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground/50">
                      Graduated intervals with random jitter to avoid pattern detection
                    </p>
                    <div className="mt-3 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-zbooni-teal/10 text-[10px] font-bold text-zbooni-teal">1</span>
                        <span className="text-xs font-medium">3 days</span>
                        <span className="text-[10px] text-muted-foreground/40">(72h + 1-3h jitter)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-zbooni-teal/10 text-[10px] font-bold text-zbooni-teal">2</span>
                        <span className="text-xs font-medium">7 days</span>
                        <span className="text-[10px] text-muted-foreground/40">(168h + 1-3h jitter)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-zbooni-teal/10 text-[10px] font-bold text-zbooni-teal">3</span>
                        <span className="text-xs font-medium">7 days</span>
                        <span className="text-[10px] text-muted-foreground/40">(168h + 1-3h jitter)</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Countries & Cities Management (A7) ─────────────────────── */}
      <CountriesCitiesManager apiClient={apiClient} />
    </div>
  );
}
