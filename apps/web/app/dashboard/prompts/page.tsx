'use client';

import {
  ChevronDown,
  Loader2,
  Lock,
  RotateCcw,
  Save,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useAuth } from '../../../src/hooks/use-auth.js';
import {
  DEFAULT_MESSAGING_MODEL,
  DEFAULT_MESSAGING_ROLE,
  DEFAULT_MESSAGING_SYSTEM_PROMPT,
  DEFAULT_SCORING_SYSTEM_PROMPT,
} from '../../../src/lib/messaging-defaults.js';
import { buildPipelineSettingsSavePlan } from '../../../src/lib/pipeline-settings-save-plan.js';
import { cn } from '../../../src/lib/utils.js';

const PROMPT_SETTING_LABELS: Record<string, string> = {
  messagingBehaviorPrompt: 'Outreach',
  messagingModel: 'Outreach Model',
  scoringModel: 'Lead Scoring Model',
  scoringSystemPrompt: 'Lead Scoring',
};

const PROMPT_CENTER_SESSION_STORAGE_KEY = 'leadzilla.prompt-center.session-settings.v2';

type PromptCenterEditableSettings = {
  messagingBehaviorPrompt: string;
  messagingModel: string;
  scoringModel: string;
  scoringSystemPrompt: string;
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

function readPromptCenterSessionSettings(): Partial<PromptCenterEditableSettings> {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.sessionStorage.getItem(PROMPT_CENTER_SESSION_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Partial<Record<keyof PromptCenterEditableSettings, unknown>>;

    return {
      ...(typeof parsed.messagingBehaviorPrompt === 'string'
        ? { messagingBehaviorPrompt: parsed.messagingBehaviorPrompt }
        : {}),
      ...(typeof parsed.messagingModel === 'string' ? { messagingModel: parsed.messagingModel } : {}),
      ...(typeof parsed.scoringModel === 'string' ? { scoringModel: parsed.scoringModel } : {}),
      ...(typeof parsed.scoringSystemPrompt === 'string'
        ? { scoringSystemPrompt: parsed.scoringSystemPrompt }
        : {}),
    };
  } catch {
    return {};
  }
}

function writePromptCenterSessionSettings(settings: PromptCenterEditableSettings): void {
  window.sessionStorage.setItem(PROMPT_CENTER_SESSION_STORAGE_KEY, JSON.stringify(settings));
}

function buildConsolidatedBehaviorPrompt(role: string, systemPrompt: string): string {
  return [role.trim(), systemPrompt.trim()].filter(Boolean).join('\n\n---\n\n');
}

const DEFAULT_AI_BEHAVIOR_PROMPT = buildConsolidatedBehaviorPrompt(
  DEFAULT_MESSAGING_ROLE,
  DEFAULT_MESSAGING_SYSTEM_PROMPT,
);

function isLegacyRegionalOutreachPrompt(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes('mena region') ||
    normalized.includes('uae, saudi arabia') ||
    normalized.includes('businesses in the mena region')
  );
}

function resolveOutreachPrompt({
  sessionPrompt,
  behaviorPrompt,
  legacyRole,
  legacySystemPrompt,
}: {
  sessionPrompt: string | undefined;
  behaviorPrompt: string;
  legacyRole: string;
  legacySystemPrompt: string;
}): string {
  const candidates = [
    sessionPrompt,
    behaviorPrompt,
    buildConsolidatedBehaviorPrompt(legacyRole, legacySystemPrompt),
  ];
  const usablePrompt = candidates.find((candidate) => {
    const value = candidate?.trim();
    return value && !isLegacyRegionalOutreachPrompt(value);
  });
  return usablePrompt ?? DEFAULT_AI_BEHAVIOR_PROMPT;
}

type PromptModelOption = {
  value: string;
  label: string;
  disabled?: boolean | undefined;
};

const DEFAULT_PROMPT_MODEL_OPTION: PromptModelOption = {
  value: DEFAULT_MESSAGING_MODEL,
  label: `${DEFAULT_MESSAGING_MODEL} (default)`,
};

const PROMPT_MODEL_OPTIONS = [
  DEFAULT_PROMPT_MODEL_OPTION,
  { value: 'gpt-5.5', label: 'gpt-5.5', disabled: true },
  { value: 'gpt-5.4', label: 'gpt-5.4', disabled: true },
  { value: 'gpt-5.2', label: 'gpt-5.2', disabled: true },
  { value: 'gpt-5', label: 'gpt-5', disabled: true },
  { value: 'gpt-5.4-mini', label: 'gpt-5.4-mini', disabled: true },
  { value: 'gpt-4.1', label: 'gpt-4.1', disabled: true },
  { value: 'gpt-4.1-mini', label: 'gpt-4.1-mini', disabled: true },
];

const PROMPT_INPUT_ITEMS = [
  ['Company', 'Our product and unique position'],
  ['Business', 'Name, business, industry'],
  ['Evidence', 'Website, Instagram, notes'],
  ['ICP', 'Pain points, sales angle, CTA'],
  ['Sequence', 'First message, follow-up, redraft'],
  ['Output', 'Email or SMS/WhatsApp'],
] as const;

function PromptModelSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const effectiveModel = value.trim() || DEFAULT_MESSAGING_MODEL;
  const modelOptions = useMemo(() => {
    const selectedModel = value.trim();
    if (!selectedModel || PROMPT_MODEL_OPTIONS.some((option) => option.value === selectedModel)) {
      return PROMPT_MODEL_OPTIONS;
    }
    return [
      ...PROMPT_MODEL_OPTIONS,
      { value: selectedModel, label: `${selectedModel} (saved)`, disabled: true },
    ];
  }, [value]);
  const selectedModelLabel = useMemo(() => {
    return (
      modelOptions
        .find((option) => option.value === effectiveModel)?.label ?? effectiveModel
    );
  }, [effectiveModel, modelOptions]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }
      setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={menuRef} className="flex w-full items-center gap-2 sm:w-auto">
      <div className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-foreground">
        Model:
      </div>
      <div className="relative w-full sm:w-56">
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((open) => !open)}
          className={cn(
            'flex h-10 w-full items-center justify-between gap-3 rounded-xl border bg-zbooni-dark/80 px-3 text-left text-sm text-foreground shadow-inner shadow-white/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zbooni-teal/20',
            isOpen
              ? 'border-zbooni-teal/70 bg-zbooni-dark/90'
              : 'border-white/15 hover:border-white/25 hover:bg-zbooni-dark/90',
          )}
        >
          <span className="truncate">{selectedModelLabel}</span>
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-foreground transition-transform',
              isOpen && 'rotate-180',
            )}
          />
        </button>

        {isOpen ? (
          <div className="absolute right-0 z-50 mt-2 max-h-80 w-full overflow-auto rounded-xl border border-white/15 bg-zbooni-dark/95 p-1 shadow-2xl ring-1 ring-zbooni-teal/15">
            <div className="space-y-0.5">
              {modelOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={option.disabled}
                  onClick={() => {
                    onChange(option.value === DEFAULT_PROMPT_MODEL_OPTION.value ? '' : option.value);
                    setIsOpen(false);
                  }}
                  className={cn(
                    'flex h-9 w-full items-center justify-between gap-3 rounded-lg px-3 text-left text-sm transition-colors',
                    option.value === effectiveModel
                      ? 'bg-zbooni-teal/15 text-foreground'
                      : 'text-foreground hover:bg-muted/30',
                    option.disabled && 'cursor-not-allowed text-foreground hover:bg-transparent',
                  )}
                >
                  <span className="truncate">{option.label}</span>
                  {option.disabled ? (
                    <span className="inline-flex shrink-0 items-center text-foreground">
                      <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="sr-only">Locked</span>
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PromptTextArea({
  label,
  description,
  modelValue,
  value,
  rows,
  monospace,
  placeholder,
  resetButtonLabel = 'Reset to default',
  onChange,
  onModelChange,
  onSave,
  onResetDefault,
  saveDisabled,
  isSaving,
}: {
  label: string;
  description?: string | undefined;
  modelValue: string;
  value: string;
  rows: number;
  monospace?: boolean | undefined;
  placeholder: string;
  resetButtonLabel?: string | undefined;
  onChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onSave: () => void;
  onResetDefault: () => void;
  saveDisabled: boolean;
  isSaving: boolean;
}) {
  return (
    <section className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-bold tracking-tight">{label}</h2>
          {description ? (
            <p className="mt-0.5 text-[11px] text-foreground">{description}</p>
          ) : null}
        </div>
        <PromptModelSelect value={modelValue} onChange={onModelChange} />
      </div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        placeholder={placeholder}
        className={cn(
          'h-[32rem] min-h-[32rem] w-full resize-y rounded-xl border border-white/15 bg-zbooni-dark/75 px-4 py-3 text-sm text-foreground shadow-inner shadow-white/5 transition-colors placeholder:text-muted-foreground/30 hover:border-white/25 hover:bg-zbooni-dark/85 focus:border-zbooni-teal/70 focus:bg-zbooni-dark/90 focus:outline-none focus:ring-2 focus:ring-zbooni-teal/15',
          monospace && 'font-mono text-[12px] leading-relaxed',
        )}
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saveDisabled}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors',
            !saveDisabled
              ? 'bg-zbooni-teal/20 text-zbooni-teal hover:bg-zbooni-teal/30'
              : 'cursor-not-allowed bg-muted/20 text-muted-foreground/60',
          )}
        >
          {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          {isSaving ? 'Saving...' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onResetDefault}
          className="inline-flex items-center gap-1.5 rounded-lg bg-muted/20 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted/40"
        >
          <RotateCcw className="h-3 w-3" />
          {resetButtonLabel}
        </button>
      </div>
    </section>
  );
}

export default function PromptCenterPage() {
  const { apiClient, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [messagingModel, setMessagingModel] = useState('');
  const [scoringModel, setScoringModel] = useState('');
  const [aiBehaviorPrompt, setAiBehaviorPrompt] = useState('');
  const [scoringSystemPrompt, setScoringSystemPrompt] = useState('');
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const loadedRef = useRef(false);
  const loadedSettingsRef = useRef<Record<string, unknown> | null>(null);

  const loadSettings = useCallback(async () => {
    setIsLoadingSettings(true);
    setSettingsLoadError(null);

    try {
      const { items } = await apiClient.listPipelineSettings();
      const nextModel = String(items.find((item) => item.key === 'messagingModel')?.value ?? '');
      const nextScoringModel = String(items.find((item) => item.key === 'scoringModel')?.value ?? '');
      const nextBehaviorPrompt = String(items.find((item) => item.key === 'messagingBehaviorPrompt')?.value ?? '');
      const nextRole = String(items.find((item) => item.key === 'messagingRole')?.value ?? '');
      const nextSystemPrompt = String(items.find((item) => item.key === 'messagingSystemPrompt')?.value ?? '');
      const nextScoringSystemPrompt = String(items.find((item) => item.key === 'scoringSystemPrompt')?.value ?? '');
      const sessionSettings = readPromptCenterSessionSettings();
      const nextAiBehaviorPrompt = resolveOutreachPrompt({
        sessionPrompt: sessionSettings.messagingBehaviorPrompt,
        behaviorPrompt: nextBehaviorPrompt,
        legacyRole: nextRole,
        legacySystemPrompt: nextSystemPrompt,
      });
      const nextEditableSettings: PromptCenterEditableSettings = {
        messagingBehaviorPrompt: nextAiBehaviorPrompt,
        messagingModel: sessionSettings.messagingModel ?? nextModel,
        scoringModel: sessionSettings.scoringModel ?? nextScoringModel,
        scoringSystemPrompt: sessionSettings.scoringSystemPrompt ?? nextScoringSystemPrompt,
      };
      const nextVisibleScoringPrompt = nextEditableSettings.scoringSystemPrompt.trim()
        ? nextEditableSettings.scoringSystemPrompt
        : DEFAULT_SCORING_SYSTEM_PROMPT;

      setMessagingModel(nextEditableSettings.messagingModel);
      setScoringModel(nextEditableSettings.scoringModel);
      setAiBehaviorPrompt(nextAiBehaviorPrompt);
      setScoringSystemPrompt(nextVisibleScoringPrompt);
      setHasChanges(false);
      loadedSettingsRef.current = {
        messagingBehaviorPrompt: nextAiBehaviorPrompt,
        messagingModel: nextEditableSettings.messagingModel,
        scoringModel: nextEditableSettings.scoringModel,
        scoringSystemPrompt: nextVisibleScoringPrompt,
      };
    } catch (error: unknown) {
      loadedSettingsRef.current = null;
      setSettingsLoadError(getErrorMessage(error));
    } finally {
      setIsLoadingSettings(false);
    }
  }, [apiClient]);

  useEffect(() => {
    if (loadedRef.current || isAuthLoading || !isAuthenticated) {
      return;
    }

    loadedRef.current = true;
    void loadSettings();
  }, [isAuthLoading, isAuthenticated, loadSettings]);

  const handleSave = useCallback(async () => {
    const currentSettings = loadedSettingsRef.current;
    if (!currentSettings) {
      toast.error('Prompt settings are unavailable. Reload before saving changes.');
      return;
    }

    const nextSettings = {
      messagingBehaviorPrompt: aiBehaviorPrompt.trim(),
      messagingModel: messagingModel.trim(),
      scoringModel: scoringModel.trim(),
      scoringSystemPrompt: scoringSystemPrompt.trim(),
    };

    const saveTargets = buildPipelineSettingsSavePlan({
      currentValues: currentSettings,
      nextValues: nextSettings,
      labels: PROMPT_SETTING_LABELS,
    });

    if (saveTargets.length === 0) {
      setHasChanges(false);
      return;
    }

    setIsSaving(true);

    try {
      writePromptCenterSessionSettings(nextSettings);
      loadedSettingsRef.current = {
        ...currentSettings,
        ...nextSettings,
      };
      toast.success(
        `Saved ${saveTargets.length} prompt setting${saveTargets.length === 1 ? '' : 's'} for this session.`,
      );
      setHasChanges(false);
    } catch (error: unknown) {
      toast.error(`Failed to save prompt settings in this browser session: ${getErrorMessage(error)}`);
      setHasChanges(true);
    } finally {
      setIsSaving(false);
    }
  }, [aiBehaviorPrompt, messagingModel, scoringModel, scoringSystemPrompt]);

  const saveDisabled = !hasChanges || isSaving || isLoadingSettings || settingsLoadError !== null;

  return (
    <div className="space-y-6">
      {settingsLoadError ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <p className="font-semibold text-red-300">Prompt settings failed to load</p>
          <p className="mt-1 text-red-100/80">{settingsLoadError}. Saving is disabled until reload succeeds.</p>
        </div>
      ) : null}

      {isLoadingSettings ? (
        <div className="flex items-center gap-2 rounded-2xl border border-border/50 bg-card p-5 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading prompt settings...
        </div>
      ) : (
        <>
          <section className="rounded-2xl border border-border/50 bg-card px-5 py-4 shadow-sm">
            <div className="mb-3">
              <h2 className="text-lg font-bold tracking-tight">Prompt Inputs</h2>
              <p className="mt-0.5 text-xs text-foreground">
                Campaign data + editable prompts determine what the AI writes.
              </p>
            </div>
            <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {PROMPT_INPUT_ITEMS.map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-xl border border-border/30 bg-zbooni-dark/25 px-3 py-2"
                >
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-foreground">
                    {label}
                  </dt>
                  <dd className="mt-0.5 text-xs leading-snug text-foreground">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <PromptTextArea
            label="Outreach"
            modelValue={messagingModel}
            value={aiBehaviorPrompt}
            rows={18}
            monospace
            placeholder="Leave empty to use the built-in Leadzilla behavior prompt."
            resetButtonLabel="Reset to default"
            onChange={(value) => {
              setAiBehaviorPrompt(value);
              setHasChanges(true);
            }}
            onModelChange={(value) => {
              setMessagingModel(value);
              setHasChanges(true);
            }}
            onSave={handleSave}
            onResetDefault={() => {
              setAiBehaviorPrompt(DEFAULT_AI_BEHAVIOR_PROMPT);
              setHasChanges(true);
            }}
            saveDisabled={saveDisabled}
            isSaving={isSaving}
          />

          <PromptTextArea
            label="Lead Scoring"
            modelValue={scoringModel}
            value={scoringSystemPrompt}
            rows={18}
            monospace
            placeholder="Leave empty to use the built-in Leadzilla scoring prompt."
            resetButtonLabel="Reset to default"
            onChange={(value) => {
              setScoringSystemPrompt(value);
              setHasChanges(true);
            }}
            onModelChange={(value) => {
              setScoringModel(value);
              setHasChanges(true);
            }}
            onSave={handleSave}
            onResetDefault={() => {
              setScoringSystemPrompt(DEFAULT_SCORING_SYSTEM_PROMPT);
              setHasChanges(true);
            }}
            saveDisabled={saveDisabled}
            isSaving={isSaving}
          />

        </>
      )}

    </div>
  );
}
