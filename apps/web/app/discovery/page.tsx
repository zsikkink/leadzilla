'use client';

import {
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  FileText,
  Gauge,
  Hash,
  Inbox,
  Loader2,
  Mail,
  MessageCircle,
  MessageSquare,
  RotateCcw,
  Save,
  Settings,
  Shield,
  ShieldCheck,
  Sliders,
  Star,
  Target,
  Timer,
  UserCog,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useApiQuery } from '../../src/hooks/use-api-query.js';
import { useAuth } from '../../src/hooks/use-auth.js';
import {
  DEFAULT_MESSAGING_ROLE,
  DEFAULT_MESSAGING_SYSTEM_PROMPT,
} from '../../src/lib/messaging-defaults.js';
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
    key: 'deterministicAiBlend',
    label: 'Deterministic / AI Blend',
    description:
      'How much to trust rules vs ML model. Shift toward AI as model matures with more labeled data.',
    spectrum: '0 = pure rules, 100 = pure ML',
    icon: Sliders,
    iconColor: 'text-zbooni-teal',
    min: 0,
    max: 100,
    step: 5,
    defaultValue: 60,
    format: (v: number) => `${v}% rules / ${100 - v}% AI`,
  },
  {
    type: 'slider',
    key: 'scoreQualificationThreshold',
    label: 'Score Qualification Threshold',
    description:
      'Leads scoring below this threshold are automatically rejected. Higher = fewer but higher-quality leads. Lower = more volume.',
    spectrum: '0 = message everyone, 1.0 = ultra-selective',
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
      'Visual classification only. Defines LOW / MED / HIGH thresholds for the dashboard.',
    spectrum: 'LOW < threshold, threshold <= MED < upper, HIGH >= upper',
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
  deterministicAiBlend: number;
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
    deterministicAiBlend: 60,
    scoreQualificationThreshold: 0.5,
    enrichmentThreshold: 0.3,
    min_review_count: 15,
    scoreTierBands: { low: 0.34, med: 0.67, high: 0.67 },
    followUpMaxCount: 3,
    whatsappDailyLimit: 50,
    emailDailyLimit: 100,
    modelActivationAuc: 0.6,
    providerBudgetCeiling: 50,
  };
}

// Keys that exist in SettingsState (for type-safe lookup)
const NUMERIC_SETTING_KEYS = new Set([
  'deterministicAiBlend',
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
  messagingRole: 'Messaging Role',
  messagingSystemPrompt: 'Messaging System Prompt',
  messagingInstructions: 'Messaging Instructions',
};

function getSettingDisplayLabel(key: string): string {
  return PIPELINE_SETTING_LABELS[key] ?? ADDITIONAL_SETTING_LABELS[key] ?? key;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }
  return 'unknown error';
}

// ── Main page ──────────────────────────────────────────────────────────

export default function ControlsSettingsPage() {
  const { apiClient } = useAuth();
  const [settings, setSettings] = useState<SettingsState>(getDefaultSettings);
  const [autoApproveEnabled, setAutoApproveEnabled] = useState(false);
  const [autoApproveScoreMin, setAutoApproveScoreMin] = useState(0.5);
  const [autoApproveScoreMax, setAutoApproveScoreMax] = useState(1.0);
  const [messagingRole, setMessagingRole] = useState('');
  const [messagingSystemPrompt, setMessagingSystemPrompt] = useState('');
  const [messagingInstructions, setMessagingInstructions] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const loadedRef = useRef(false);

  // Load all settings from API on mount
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    apiClient
      .listPipelineSettings()
      .then(({ items }) => {
        const newSettings = { ...getDefaultSettings() };
        for (const item of items) {
          if (item.key === 'auto_approve_enabled') {
            setAutoApproveEnabled(item.value === true || item.value === 'true');
          } else if (item.key === 'auto_approve_score_min') {
            const n = Number(item.value);
            if (!Number.isNaN(n)) setAutoApproveScoreMin(n);
          } else if (item.key === 'auto_approve_score_max') {
            const n = Number(item.value);
            if (!Number.isNaN(n)) setAutoApproveScoreMax(n);
          } else if (item.key === 'messagingRole') {
            setMessagingRole(String(item.value ?? ''));
          } else if (item.key === 'messagingSystemPrompt') {
            setMessagingSystemPrompt(String(item.value ?? ''));
          } else if (item.key === 'messagingInstructions') {
            setMessagingInstructions(String(item.value ?? ''));
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
      })
      .catch(() => {
        // Use defaults if API fails
      })
      .finally(() => {
        setIsLoadingSettings(false);
      });
  }, [apiClient]);

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
    setIsSaving(true);
    const saveTargets = [
      ...(Object.entries(settings) as [string, unknown][]).map(([key, value]) => ({
        key,
        value,
        label: getSettingDisplayLabel(key),
      })),
      { key: 'auto_approve_enabled', value: autoApproveEnabled, label: getSettingDisplayLabel('auto_approve_enabled') },
      { key: 'auto_approve_score_min', value: autoApproveScoreMin, label: getSettingDisplayLabel('auto_approve_score_min') },
      { key: 'auto_approve_score_max', value: autoApproveScoreMax, label: getSettingDisplayLabel('auto_approve_score_max') },
      { key: 'messagingRole', value: messagingRole, label: getSettingDisplayLabel('messagingRole') },
      { key: 'messagingSystemPrompt', value: messagingSystemPrompt, label: getSettingDisplayLabel('messagingSystemPrompt') },
      { key: 'messagingInstructions', value: messagingInstructions, label: getSettingDisplayLabel('messagingInstructions') },
    ];

    const results = await Promise.all(
      saveTargets.map(async (target) => {
        try {
          await apiClient.updatePipelineSetting(target.key, target.value);
          return { ...target, success: true as const };
        } catch (error: unknown) {
          return { ...target, success: false as const, errorMessage: getErrorMessage(error) };
        }
      }),
    );

    const failedSaves = results.filter((result) => !result.success);
    const successfulSaveCount = results.length - failedSaves.length;

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
  }, [apiClient, settings, autoApproveEnabled, autoApproveScoreMin, autoApproveScoreMax, messagingRole, messagingSystemPrompt, messagingInstructions]);

  const handleReset = useCallback(() => {
    setSettings(getDefaultSettings());
    setAutoApproveEnabled(false);
    setAutoApproveScoreMin(0.5);
    setAutoApproveScoreMax(1.0);
    setMessagingRole('');
    setMessagingSystemPrompt('');
    setMessagingInstructions('');
    setHasChanges(true);
    toast.info('Settings reset to defaults — click Save to persist');
  }, []);

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
            className="inline-flex items-center gap-1.5 rounded-lg bg-muted/20 px-3.5 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset Defaults
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-all',
              hasChanges && !isSaving
                ? 'bg-zbooni-teal/20 text-zbooni-teal hover:bg-zbooni-teal/30'
                : 'bg-muted/20 text-muted-foreground/60 cursor-not-allowed',
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
          label="Provider Status"
        >
          <div className="space-y-2">
            {[
              { name: 'SerpAPI', configured: true },
              { name: 'Hunter', configured: true },
              { name: 'Apollo', configured: false },
            ].map((provider) => (
              <div key={provider.name} className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-muted-foreground/60">
                  {provider.name}
                </span>
                {provider.configured ? (
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-zbooni-green" />
                    <span className="text-[10px] font-semibold text-zbooni-green">Active</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 text-muted-foreground/40" />
                    <span className="text-[10px] font-semibold text-muted-foreground/40">Not configured</span>
                  </div>
                )}
              </div>
            ))}
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
              <CheckCircle2 className="h-5 w-5 text-zbooni-green" />
              <span className="text-2xl font-extrabold tracking-tight text-zbooni-green">0</span>
            </div>
            <p className="mt-1 text-[10px] font-medium text-muted-foreground/40">
              All queues healthy
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
              Message drafts awaiting review
            </p>
          </div>
        </StatusCard>
      </div>

      {/* ── AI Role / Identity ──────────────────────────────────────── */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/10">
            <UserCog className="h-4 w-4 text-purple-400" />
          </div>
          <div>
            <h2 className="text-base font-bold tracking-tight">AI Role / Identity</h2>
            <p className="text-[11px] text-muted-foreground/50">
              Defines who the AI is, its persona, and behavior when writing messages
            </p>
          </div>
        </div>
        {isLoadingSettings ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground/50">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading...
          </div>
        ) : (
          <div className="space-y-3">
            <textarea
              value={messagingRole}
              onChange={(e) => {
                setMessagingRole(e.target.value);
                setHasChanges(true);
              }}
              rows={6}
              className="w-full resize-y rounded-xl border border-border/30 bg-zbooni-dark/40 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/30 focus:border-zbooni-teal/50 focus:outline-none"
              placeholder="Set a custom role. Leave empty to use the default role."
              aria-label="AI Role"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setMessagingRole(DEFAULT_MESSAGING_ROLE);
                  setHasChanges(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-muted/20 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted/40"
              >
                Use Default Template
              </button>
              <button
                type="button"
                onClick={() => {
                  setMessagingRole('');
                  setHasChanges(true);
                  toast.info('Role reset to default — click Save to persist');
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-muted/20 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted/40"
              >
                <RotateCcw className="h-3 w-3" />
                Clear Custom Role
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── AI System Prompt ──────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zbooni-teal/10">
            <Sliders className="h-4 w-4 text-zbooni-teal" />
          </div>
          <div>
            <h2 className="text-base font-bold tracking-tight">AI System Prompt</h2>
            <p className="text-[11px] text-muted-foreground/50">
              Message structure, templates, ICP features, rules, and tone
            </p>
          </div>
        </div>
        {isLoadingSettings ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground/50">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading...
          </div>
        ) : (
          <div className="space-y-3">
            <textarea
              value={messagingSystemPrompt}
              onChange={(e) => {
                setMessagingSystemPrompt(e.target.value);
                setHasChanges(true);
              }}
              rows={12}
              className="w-full resize-y rounded-xl border border-border/30 bg-zbooni-dark/40 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/30 focus:border-zbooni-teal/50 focus:outline-none font-mono text-[12px] leading-relaxed"
              placeholder="Set a custom system prompt. Leave empty to use the default system prompt."
              aria-label="AI System Prompt"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setMessagingSystemPrompt(DEFAULT_MESSAGING_SYSTEM_PROMPT);
                  setHasChanges(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-muted/20 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted/40"
              >
                Use Default Template
              </button>
              <button
                type="button"
                onClick={() => {
                  setMessagingSystemPrompt('');
                  setHasChanges(true);
                  toast.info('System prompt reset to default — click Save to persist');
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-muted/20 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted/40"
              >
                <RotateCcw className="h-3 w-3" />
                Clear Custom Prompt
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Messaging Instructions ────────────────────────────────────── */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zbooni-green/10">
            <MessageCircle className="h-4 w-4 text-zbooni-green" />
          </div>
          <div>
            <h2 className="text-base font-bold tracking-tight">Messaging Instructions</h2>
            <p className="text-[11px] text-muted-foreground/50">
              Per-campaign tweaks appended after the system prompt (e.g. "Focus on hospitality ICPs this week")
            </p>
          </div>
        </div>
        {isLoadingSettings ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground/50">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading saved instructions...
          </div>
        ) : (
          <textarea
            value={messagingInstructions}
            onChange={(e) => {
              setMessagingInstructions(e.target.value);
              setHasChanges(true);
            }}
            rows={6}
            placeholder="Enter per-campaign instructions appended after the system prompt. Example: 'Always mention our payment link feature this week. Focus on hospitality ICPs. Reference UAE market growth.'"
            className="w-full resize-y rounded-xl border border-border/30 bg-zbooni-dark/40 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/30 focus:border-zbooni-teal/50 focus:outline-none"
            aria-label="Messaging Instructions"
          />
        )}
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
                        Automatically send messages for leads within the score range
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
                        autoApproveEnabled ? 'translate-x-[26px]' : 'translate-x-[2px]',
                      )}
                    />
                  </button>
                </div>
                {autoApproveEnabled ? (
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
                ) : null}
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

      {/* ── Outbox Monitor ──────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zbooni-teal/10">
            <FileText className="h-4 w-4 text-zbooni-teal" />
          </div>
          <div>
            <h2 className="text-base font-bold tracking-tight">Outbox Monitor</h2>
            <p className="text-[11px] text-muted-foreground/50">
              Recent pipeline events and their processing status
            </p>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center py-8 text-center">
          <FileText className="mb-2 h-8 w-8 text-muted-foreground/20" />
          <p className="text-sm font-medium text-muted-foreground/50">No recent events</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground/30">
            Pipeline events will appear here as discovery runs process
          </p>
        </div>
      </div>
    </div>
  );
}
