'use client';

import {
  AlertTriangle,
  Bot,
  Eye,
  Loader2,
  MessageSquare,
  RotateCcw,
  Save,
  ShieldCheck,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useAuth } from '../../../src/hooks/use-auth.js';
import {
  DEFAULT_MESSAGING_ROLE,
  DEFAULT_MESSAGING_SYSTEM_PROMPT,
} from '../../../src/lib/messaging-defaults.js';
import { buildPipelineSettingsSavePlan } from '../../../src/lib/pipeline-settings-save-plan.js';
import { cn } from '../../../src/lib/utils.js';

const PROMPT_SETTING_LABELS: Record<string, string> = {
  messagingRole: 'Outreach Role',
  messagingSystemPrompt: 'Outreach Instructions',
};

const LOCKED_OUTPUT_FORMAT =
  'Output JSON with a single "message" object containing subject, bodyText, bodyHtml, and ctaText. The bodyText must include the final sign-off "Best,\\nLeadzilla Team".';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }
  return 'unknown error';
}

function buildHookInstruction(hook: string): string {
  const trimmed = hook.trim();
  return trimmed.length > 0
    ? `You MUST incorporate the following sales hook as the core angle of your message. Sales hook: "${trimmed}"`
    : 'No specific sales hook was provided. Derive a concrete, relevant hook from the ICP description and business intelligence.';
}

function PromptTextArea({
  label,
  description,
  value,
  rows,
  monospace,
  placeholder,
  onChange,
  onUseDefault,
  onClearOverride,
}: {
  label: string;
  description: string;
  value: string;
  rows: number;
  monospace?: boolean | undefined;
  placeholder: string;
  onChange: (value: string) => void;
  onUseDefault: () => void;
  onClearOverride: () => void;
}) {
  return (
    <section className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
      <div className="mb-4 flex items-start gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zbooni-teal/10">
          <Bot className="h-4 w-4 text-zbooni-teal" />
        </div>
        <div>
          <h2 className="text-base font-bold tracking-tight">{label}</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground/50">{description}</p>
        </div>
      </div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        placeholder={placeholder}
        className={cn(
          'w-full resize-y rounded-xl border border-border/30 bg-zbooni-dark/40 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/30 focus:border-zbooni-teal/50 focus:outline-none',
          monospace && 'font-mono text-[12px] leading-relaxed',
        )}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onUseDefault}
          className="inline-flex items-center gap-1.5 rounded-lg bg-muted/20 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted/40"
        >
          Use Default Text
        </button>
        <button
          type="button"
          onClick={onClearOverride}
          className="inline-flex items-center gap-1.5 rounded-lg bg-muted/20 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted/40"
        >
          <RotateCcw className="h-3 w-3" />
          Clear Override
        </button>
      </div>
    </section>
  );
}

export default function PromptCenterPage() {
  const { apiClient, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [messagingRole, setMessagingRole] = useState('');
  const [messagingSystemPrompt, setMessagingSystemPrompt] = useState('');
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [previewBuiltAt, setPreviewBuiltAt] = useState<string | null>(null);
  const [sampleContactType, setSampleContactType] = useState<'DECISION_MAKER' | 'GENERIC_CONTACT'>('DECISION_MAKER');
  const [sampleRecipientName, setSampleRecipientName] = useState('Ann');
  const [sampleCompanyName, setSampleCompanyName] = useState('LAADS');
  const [sampleHook, setSampleHook] = useState('Turn proposal-based WhatsApp conversations into paid, trackable project payments.');
  const [sampleBusinessIntelligence, setSampleBusinessIntelligence] = useState(
    'Company: Interior fit-out and MEP projects. Social: WhatsApp appears to be a primary inquiry channel.',
  );
  const loadedRef = useRef(false);
  const loadedSettingsRef = useRef<Record<string, unknown> | null>(null);

  const effectiveRole = messagingRole.trim() || DEFAULT_MESSAGING_ROLE;
  const effectiveSystemPrompt = messagingSystemPrompt.trim() || DEFAULT_MESSAGING_SYSTEM_PROMPT;

  const loadSettings = useCallback(async () => {
    setIsLoadingSettings(true);
    setSettingsLoadError(null);

    try {
      const { items } = await apiClient.listPipelineSettings();
      const nextRole = String(items.find((item) => item.key === 'messagingRole')?.value ?? '');
      const nextSystemPrompt = String(items.find((item) => item.key === 'messagingSystemPrompt')?.value ?? '');

      setMessagingRole(nextRole);
      setMessagingSystemPrompt(nextSystemPrompt);
      setHasChanges(false);
      loadedSettingsRef.current = {
        messagingRole: nextRole,
        messagingSystemPrompt: nextSystemPrompt,
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
      messagingRole,
      messagingSystemPrompt,
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
    const results: Array<
      | { key: string; value: unknown; success: true }
      | { key: string; success: false; errorMessage: string }
    > = [];

    for (const target of saveTargets) {
      try {
        await apiClient.updatePipelineSetting(target.key, target.value);
        results.push({ key: target.key, value: target.value, success: true });
      } catch (error: unknown) {
        results.push({ key: target.key, success: false, errorMessage: getErrorMessage(error) });
      }
    }

    const failed = results.filter((result): result is { key: string; success: false; errorMessage: string } => !result.success);
    const saved = results.filter((result): result is { key: string; value: unknown; success: true } => result.success);

    if (saved.length > 0) {
      loadedSettingsRef.current = {
        ...currentSettings,
        ...Object.fromEntries(saved.map((result) => [result.key, result.value])),
      };
    }

    if (failed.length > 0) {
      toast.error(`Failed to save: ${failed.map((result) => `${result.key} (${result.errorMessage})`).join('; ')}`);
      setHasChanges(true);
    } else {
      toast.success(`Saved ${saved.length} prompt setting${saved.length === 1 ? '' : 's'}.`);
      setHasChanges(false);
    }

    setIsSaving(false);
  }, [apiClient, messagingRole, messagingSystemPrompt]);

  const preview = useMemo(() => {
    const recipientGuidance = sampleContactType === 'GENERIC_CONTACT'
      ? 'Recipient guidance: write to the company team, not to an individual person.'
      : 'Recipient guidance: write to the named person while keeping the value framed around their team/business.';

    return {
      role: effectiveRole,
      editableInstructions: effectiveSystemPrompt,
      lockedRuntimeLayer: [
        'MANDATORY ICP HOOK INSTRUCTION:',
        buildHookInstruction(sampleHook),
        '',
        'LOCKED OUTPUT FORMAT:',
        LOCKED_OUTPUT_FORMAT,
        '',
        'LOCKED SAFETY VALIDATION:',
        'The worker still validates greeting, sign-off, message length, banned phrases, raw JSON, and re-draft feedback compliance after generation.',
      ].join('\n'),
      userContext: [
        'Channel: EMAIL',
        `Lead: ${sampleRecipientName} (${sampleRecipientName.toLowerCase()}@example.com)`,
        `Contact type: ${sampleContactType}`,
        sampleContactType === 'GENERIC_CONTACT' ? 'Recipient name: none verified' : `Recipient name: ${sampleRecipientName}`,
        `Recipient email kind: ${sampleContactType === 'GENERIC_CONTACT' ? 'GENERIC' : 'PERSONAL'}`,
        recipientGuidance,
        `Company: ${sampleCompanyName}`,
        'Score band: HIGH (0.82)',
        'ICP description: Sample ICP profile description and features to pitch.',
        '',
        'Business Intelligence:',
        sampleBusinessIntelligence,
      ].join('\n'),
    };
  }, [
    effectiveRole,
    effectiveSystemPrompt,
    sampleBusinessIntelligence,
    sampleCompanyName,
    sampleContactType,
    sampleHook,
    sampleRecipientName,
  ]);

  const saveDisabled = !hasChanges || isSaving || isLoadingSettings || settingsLoadError !== null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Prompt Center</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Controlled outreach prompt layers. Scoring, classifier, output format, and validation prompts remain locked in code.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadSettings()}
            disabled={isLoadingSettings}
            className="inline-flex items-center gap-1.5 rounded-lg bg-muted/20 px-3.5 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoadingSettings ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            Reload
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
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {isSaving ? 'Saving...' : 'Save Prompt Settings'}
          </button>
        </div>
      </div>

      {settingsLoadError ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <p className="font-semibold text-red-300">Prompt settings failed to load</p>
          <p className="mt-1 text-red-100/80">{settingsLoadError}. Saving is disabled until reload succeeds.</p>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-zbooni-green/25 bg-zbooni-green/5 p-5">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-zbooni-green" />
            <h2 className="text-sm font-bold">Editable</h2>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Outreach role and outreach instructions used by initial drafts, re-drafts, and follow-ups.
          </p>
        </div>
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-amber-300" />
            <h2 className="text-sm font-bold">Locked</h2>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Output JSON shape, sign-off enforcement, validation retry rules, scoring prompts, and reply classifier prompts.
          </p>
        </div>
        <div className="rounded-2xl border border-border/50 bg-card p-5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-bold">Operator Note</h2>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Empty fields use the runtime defaults. Saving default text pins that text until it is cleared.
          </p>
        </div>
      </div>

      {isLoadingSettings ? (
        <div className="flex items-center gap-2 rounded-2xl border border-border/50 bg-card p-5 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading prompt settings...
        </div>
      ) : (
        <>
          <PromptTextArea
            label="Outreach Role"
            description="Who the AI is and how it should behave when drafting outreach."
            value={messagingRole}
            rows={6}
            placeholder="Leave empty to use the runtime default role."
            onChange={(value) => {
              setMessagingRole(value);
              setHasChanges(true);
            }}
            onUseDefault={() => {
              setMessagingRole(DEFAULT_MESSAGING_ROLE);
              setHasChanges(true);
            }}
            onClearOverride={() => {
              setMessagingRole('');
              setHasChanges(true);
              toast.info('Role override cleared. Save to persist.');
            }}
          />

          <PromptTextArea
            label="Outreach Instructions"
            description="Message structure, tone, contact awareness, proof-point usage, and outreach rules."
            value={messagingSystemPrompt}
            rows={14}
            monospace
            placeholder="Leave empty to use the runtime default outreach instructions."
            onChange={(value) => {
              setMessagingSystemPrompt(value);
              setHasChanges(true);
            }}
            onUseDefault={() => {
              setMessagingSystemPrompt(DEFAULT_MESSAGING_SYSTEM_PROMPT);
              setHasChanges(true);
            }}
            onClearOverride={() => {
              setMessagingSystemPrompt('');
              setHasChanges(true);
              toast.info('Outreach instruction override cleared. Save to persist.');
            }}
          />
        </>
      )}

      <section className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold tracking-tight">
              <Eye className="h-4 w-4 text-zbooni-teal" />
              Prompt Preview
            </h2>
            <p className="mt-1 text-sm text-muted-foreground/60">
              Preview uses the text currently on this page, including unsaved edits. It does not call OpenAI or create a draft.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPreviewBuiltAt(new Date().toLocaleString())}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-zbooni-green/15 px-3.5 py-2 text-xs font-semibold text-zbooni-green transition-colors hover:bg-zbooni-green/25"
          >
            <Eye className="h-3.5 w-3.5" />
            Preview Effective Prompt
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5 text-xs font-semibold text-muted-foreground">
            Contact Type
            <select
              value={sampleContactType}
              onChange={(event) => setSampleContactType(event.target.value as 'DECISION_MAKER' | 'GENERIC_CONTACT')}
              className="h-10 w-full rounded-lg border border-border/30 bg-zbooni-dark/40 px-3 text-sm text-foreground focus:border-zbooni-teal/50 focus:outline-none"
            >
              <option value="DECISION_MAKER">Decision Maker</option>
              <option value="GENERIC_CONTACT">Generic Contact</option>
            </select>
          </label>
          <label className="space-y-1.5 text-xs font-semibold text-muted-foreground">
            Recipient / Company
            <input
              value={sampleContactType === 'GENERIC_CONTACT' ? sampleCompanyName : sampleRecipientName}
              onChange={(event) => {
                if (sampleContactType === 'GENERIC_CONTACT') {
                  setSampleCompanyName(event.target.value);
                } else {
                  setSampleRecipientName(event.target.value);
                }
              }}
              className="h-10 w-full rounded-lg border border-border/30 bg-zbooni-dark/40 px-3 text-sm text-foreground placeholder:text-muted-foreground/30 focus:border-zbooni-teal/50 focus:outline-none"
            />
          </label>
          <label className="space-y-1.5 text-xs font-semibold text-muted-foreground sm:col-span-2">
            Sample ICP Sales Hook
            <input
              value={sampleHook}
              onChange={(event) => setSampleHook(event.target.value)}
              className="h-10 w-full rounded-lg border border-border/30 bg-zbooni-dark/40 px-3 text-sm text-foreground placeholder:text-muted-foreground/30 focus:border-zbooni-teal/50 focus:outline-none"
            />
          </label>
          <label className="space-y-1.5 text-xs font-semibold text-muted-foreground sm:col-span-2">
            Sample Business Intelligence
            <textarea
              value={sampleBusinessIntelligence}
              onChange={(event) => setSampleBusinessIntelligence(event.target.value)}
              rows={3}
              className="w-full resize-y rounded-lg border border-border/30 bg-zbooni-dark/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/30 focus:border-zbooni-teal/50 focus:outline-none"
            />
          </label>
        </div>

        {previewBuiltAt ? (
          <div className="mt-5 space-y-4">
            <p className="text-xs text-muted-foreground/50">Preview built {previewBuiltAt}</p>
            {[
              ['Editable Role Layer', preview.role],
              ['Editable Outreach Instruction Layer', preview.editableInstructions],
              ['Locked Runtime Layer', preview.lockedRuntimeLayer],
              ['Example User Context', preview.userContext],
            ].map(([title, value]) => (
              <div key={title} className="rounded-xl border border-border/30 bg-zbooni-dark/30 p-4">
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground/60">{title}</h3>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground/90">{value}</pre>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
