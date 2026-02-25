'use client';

import type { DiscoveryProvider, IcpProfileResponse, PipelineRunStatus } from '@lead-flood/contracts';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Play,
  Rocket,
  Search,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useApiQuery } from '../../../src/hooks/use-api-query.js';
import { useAuth } from '../../../src/hooks/use-auth.js';
import { cn } from '../../../src/lib/utils.js';

// ── Provider options ──────────────────────────────────────
const PROVIDER_OPTIONS: { value: string; label: string; description: string }[] = [
  { value: '', label: 'Auto', description: 'Best match per ICP' },
  { value: 'APOLLO', label: 'Apollo', description: 'B2B contacts' },
  { value: 'BRAVE_SEARCH', label: 'Brave Search', description: 'Web results' },
  { value: 'GOOGLE_PLACES', label: 'Google Places', description: 'Local businesses' },
  { value: 'LINKEDIN_SCRAPE', label: 'LinkedIn', description: 'Professional profiles' },
  { value: 'COMPANY_SEARCH_FREE', label: 'Company Search', description: 'Free company data' },
];

const LIMIT_OPTIONS = [
  { value: '5', label: '5' },
  { value: '10', label: '10' },
  { value: '25', label: '25' },
  { value: '50', label: '50' },
  { value: '100', label: '100' },
  { value: '250', label: '250' },
  { value: '500', label: '500' },
  { value: '1000', label: '1000' },
];

// Static recommended source mapping per ICP keyword pattern
const RECOMMENDED_SOURCE_MAP: Record<string, { provider: string; reason: string }> = {
  luxury: { provider: 'APOLLO', reason: 'Best for luxury B2B contacts' },
  enterprise: { provider: 'APOLLO', reason: 'Deep B2B enrichment data' },
  events: { provider: 'GOOGLE_PLACES', reason: 'Local event venues' },
  restaurant: { provider: 'GOOGLE_PLACES', reason: 'Local business listings' },
  retail: { provider: 'GOOGLE_PLACES', reason: 'Storefront discovery' },
  saas: { provider: 'APOLLO', reason: 'Tech company contacts' },
  ecommerce: { provider: 'BRAVE_SEARCH', reason: 'Web presence scanning' },
  'e-commerce': { provider: 'BRAVE_SEARCH', reason: 'Web presence scanning' },
  fintech: { provider: 'APOLLO', reason: 'Financial sector contacts' },
  linkedin: { provider: 'LINKEDIN_SCRAPE', reason: 'Professional network' },
  startup: { provider: 'LINKEDIN_SCRAPE', reason: 'Founder/exec profiles' },
  local: { provider: 'GOOGLE_PLACES', reason: 'Local business focus' },
};

function getRecommendedSource(icp: IcpProfileResponse): { provider: string; reason: string } | null {
  const searchText = `${icp.name} ${icp.description ?? ''} ${icp.targetIndustries.join(' ')}`.toLowerCase();
  for (const [keyword, rec] of Object.entries(RECOMMENDED_SOURCE_MAP)) {
    if (searchText.includes(keyword)) {
      return rec;
    }
  }
  return null;
}

function getProviderLabel(providerValue: string): string {
  return PROVIDER_OPTIONS.find((p) => p.value === providerValue)?.label ?? providerValue;
}

// ── Sub-components ──────────────────────────────────────

interface RunState {
  runId: string;
  status: PipelineRunStatus;
  totalItems: number;
  processedItems: number;
  failedItems: number;
  startedAt: string | null;
  endedAt: string | null;
  errorMessage: string | null;
}

function StatusIcon({ status }: { status: PipelineRunStatus }) {
  switch (status) {
    case 'QUEUED':
      return <Loader2 className="h-5 w-5 animate-spin text-yellow-400" />;
    case 'RUNNING':
      return <Loader2 className="h-5 w-5 animate-spin text-zbooni-teal" />;
    case 'SUCCEEDED':
      return <CheckCircle2 className="h-5 w-5 text-zbooni-green" />;
    case 'FAILED':
      return <AlertCircle className="h-5 w-5 text-red-400" />;
    case 'PARTIAL':
      return <AlertCircle className="h-5 w-5 text-yellow-400" />;
  }
}

function ProgressBar({ processed, total }: { processed: number; total: number }) {
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
  return (
    <div className="w-full">
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="font-medium text-muted-foreground">
          {processed} / {total} processed
        </span>
        <span className="font-bold text-foreground">{pct}%</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-zbooni-dark/60">
        <div
          className="h-full rounded-full bg-gradient-to-r from-zbooni-green to-zbooni-teal transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function IcpPreviewCard({ icp }: { icp: IcpProfileResponse }) {
  const recommendation = getRecommendedSource(icp);

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zbooni-teal/10">
          <Target className="h-5 w-5 text-zbooni-teal" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-bold">{icp.name}</p>
            {recommendation ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-zbooni-teal/10 px-2 py-0.5 text-[10px] font-semibold text-zbooni-teal">
                <Sparkles className="h-3 w-3" />
                Best: {getProviderLabel(recommendation.provider)}
              </span>
            ) : null}
          </div>
          {icp.description ? (
            <p className="mt-0.5 text-sm text-muted-foreground line-clamp-2">{icp.description}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Industries</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {icp.targetIndustries.length > 0 ? (
              icp.targetIndustries.map((i) => (
                <span key={i} className="rounded-full bg-zbooni-dark/60 px-2 py-0.5 text-xs text-muted-foreground">{i}</span>
              ))
            ) : (
              <span className="text-xs text-muted-foreground/40">Any</span>
            )}
          </div>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Countries</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {icp.targetCountries.length > 0 ? (
              icp.targetCountries.map((c) => (
                <span key={c} className="rounded-full bg-zbooni-teal/10 px-2 py-0.5 text-xs text-zbooni-teal">{c}</span>
              ))
            ) : (
              <span className="text-xs text-muted-foreground/40">Any</span>
            )}
          </div>
        </div>
        {icp.minCompanySize !== null || icp.maxCompanySize !== null ? (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Company Size</p>
            <p className="mt-1 text-xs font-medium">
              {icp.minCompanySize ?? 0} - {icp.maxCompanySize ?? '10,000+'}
            </p>
          </div>
        ) : null}
        {icp.requiredTechnologies.length > 0 ? (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Technologies</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {icp.requiredTechnologies.map((t) => (
                <span key={t} className="rounded-full bg-purple-500/10 px-2 py-0.5 text-xs text-purple-400">{t}</span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Pill selector components ──────────────────────────────

function PillOption({
  selected,
  onClick,
  children,
  className,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string | undefined;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-all duration-150',
        selected
          ? 'border-zbooni-teal/40 bg-zbooni-teal/10 text-zbooni-teal shadow-sm'
          : 'border-border/40 bg-zbooni-dark/30 text-muted-foreground hover:border-border/60 hover:bg-zbooni-dark/50 hover:text-foreground',
        className,
      )}
    >
      {children}
    </button>
  );
}

function IcpCheckbox({
  icp,
  selected,
  onToggle,
}: {
  icp: IcpProfileResponse;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  const recommendation = getRecommendedSource(icp);

  return (
    <button
      type="button"
      onClick={() => onToggle(icp.id)}
      className={cn(
        'flex items-start gap-3 rounded-xl border p-3 text-left transition-all duration-150',
        selected
          ? 'border-zbooni-teal/40 bg-zbooni-teal/5 shadow-sm'
          : 'border-border/30 bg-zbooni-dark/20 hover:border-border/50 hover:bg-zbooni-dark/40',
      )}
    >
      {/* Checkbox indicator */}
      <div
        className={cn(
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors duration-150',
          selected
            ? 'border-zbooni-teal bg-zbooni-teal text-zbooni-dark'
            : 'border-border/50 bg-transparent',
        )}
      >
        {selected ? (
          <svg className="h-3 w-3" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2.5}>
            <path d="M2 6l3 3 5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn('text-sm font-semibold', selected ? 'text-foreground' : 'text-muted-foreground')}>
            {icp.name}
          </span>
          {recommendation ? (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-zbooni-teal/10 px-1.5 py-0.5 text-[10px] font-semibold text-zbooni-teal">
              <Sparkles className="h-2.5 w-2.5" />
              {getProviderLabel(recommendation.provider)}
            </span>
          ) : null}
        </div>
        {icp.description ? (
          <p className="mt-0.5 text-xs text-muted-foreground/70 line-clamp-1">{icp.description}</p>
        ) : null}
        {icp.targetIndustries.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {icp.targetIndustries.slice(0, 3).map((ind) => (
              <span key={ind} className="rounded bg-zbooni-dark/60 px-1.5 py-0.5 text-[10px] text-muted-foreground/60">
                {ind}
              </span>
            ))}
            {icp.targetIndustries.length > 3 ? (
              <span className="text-[10px] text-muted-foreground/40">+{icp.targetIndustries.length - 3}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </button>
  );
}

// ── Main page ──────────────────────────────────────

export default function DiscoverPage() {
  const { apiClient, user } = useAuth();

  // Form state: multi-ICP selection
  const [selectedIcpIds, setSelectedIcpIds] = useState<Set<string>>(new Set());
  const [provider, setProvider] = useState('');
  const [limit, setLimit] = useState('25');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Run tracking
  const [activeRun, setActiveRun] = useState<RunState | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load ICPs
  const icps = useApiQuery(
    useCallback(() => apiClient.listIcps({ page: 1, pageSize: 50, isActive: true }), [apiClient]),
  );

  // For the preview: show first selected ICP
  const firstSelectedIcpId = selectedIcpIds.size > 0 ? Array.from(selectedIcpIds)[0] : null;
  const selectedIcp = firstSelectedIcpId
    ? (icps.data?.items.find((i) => i.id === firstSelectedIcpId) ?? null)
    : null;

  const toggleIcp = (id: string) => {
    setSelectedIcpIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Recent discovery records — filter by first selected ICP
  const records = useApiQuery(
    useCallback(
      () =>
        apiClient.listDiscoveryRecords({
          page: 1,
          pageSize: 10,
          includeQualityMetrics: true,
          ...(firstSelectedIcpId ? { icpProfileId: firstSelectedIcpId } : {}),
        }),
      [apiClient, firstSelectedIcpId],
    ),
    [firstSelectedIcpId],
  );

  // Poll for run status
  useEffect(() => {
    if (!activeRun || activeRun.status === 'SUCCEEDED' || activeRun.status === 'FAILED') {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    pollRef.current = setInterval(async () => {
      try {
        const status = await apiClient.getDiscoveryRunStatus(activeRun.runId);
        setActiveRun({
          runId: status.runId,
          status: status.status,
          totalItems: status.totalItems,
          processedItems: status.processedItems,
          failedItems: status.failedItems,
          startedAt: status.startedAt,
          endedAt: status.endedAt,
          errorMessage: status.errorMessage,
        });

        if (status.status === 'SUCCEEDED' || status.status === 'FAILED' || status.status === 'PARTIAL') {
          records.refetch();
        }
      } catch {
        // silently retry
      }
    }, 3000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [activeRun, apiClient, records]);

  const handleStartDiscovery = async () => {
    if (selectedIcpIds.size === 0) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      // Launch a discovery run for each selected ICP
      // For now, start the first one and track it; multi-ICP runs
      // would be queued server-side
      const icpId = Array.from(selectedIcpIds)[0]!;
      const result = await apiClient.createDiscoveryRun({
        icpProfileId: icpId,
        ...(provider ? { provider: provider as DiscoveryProvider } : {}),
        limit: parseInt(limit, 10),
        ...(user?.id ? { requestedByUserId: user.id } : {}),
      });

      setActiveRun({
        runId: result.runId,
        status: result.status,
        totalItems: 0,
        processedItems: 0,
        failedItems: 0,
        startedAt: null,
        endedAt: null,
        errorMessage: null,
      });

      // If multiple ICPs selected, fire off remaining runs (non-blocking)
      const remainingIds = Array.from(selectedIcpIds).slice(1);
      for (const id of remainingIds) {
        void apiClient.createDiscoveryRun({
          icpProfileId: id,
          ...(provider ? { provider: provider as DiscoveryProvider } : {}),
          limit: parseInt(limit, 10),
          ...(user?.id ? { requestedByUserId: user.id } : {}),
        });
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to start discovery');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isRunning = activeRun && (activeRun.status === 'QUEUED' || activeRun.status === 'RUNNING');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-zbooni-green to-zbooni-teal">
            <Rocket className="h-5 w-5 text-zbooni-dark" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Discover Leads</h1>
            <p className="text-sm text-muted-foreground">
              Find new prospects matching your Ideal Customer Profiles
            </p>
          </div>
        </div>
      </div>

      {/* Configuration Form */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <h2 className="mb-5 flex items-center gap-2 text-base font-bold tracking-tight">
          <Search className="h-4 w-4 text-zbooni-teal" />
          Configure Search
        </h2>

        <div className="space-y-6">
          {/* Step 1: Select ICPs (multi-select with checkboxes) */}
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-zbooni-teal/10 text-xs font-bold text-zbooni-teal">
                1
              </span>
              <label className="text-sm font-semibold">Select ICP Profiles</label>
              {selectedIcpIds.size > 0 ? (
                <span className="rounded-full bg-zbooni-teal/10 px-2 py-0.5 text-[11px] font-semibold text-zbooni-teal">
                  {selectedIcpIds.size} selected
                </span>
              ) : null}
            </div>

            {icps.isLoading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
                Loading profiles...
              </div>
            ) : null}

            {!icps.isLoading && icps.error ? (
              <div className="flex items-center gap-3 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span className="flex-1">Failed to load ICP profiles: {icps.error}</span>
                <button
                  type="button"
                  onClick={icps.refetch}
                  className="shrink-0 rounded-md bg-red-500/20 px-2.5 py-1 text-xs font-semibold text-red-300 transition-colors hover:bg-red-500/30"
                >
                  Retry
                </button>
              </div>
            ) : null}

            {icps.data && icps.data.items.length > 0 ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {icps.data.items.map((icp) => (
                  <IcpCheckbox
                    key={icp.id}
                    icp={icp}
                    selected={selectedIcpIds.has(icp.id)}
                    onToggle={toggleIcp}
                  />
                ))}
              </div>
            ) : null}

            {icps.data && icps.data.items.length === 0 ? (
              <p className="text-sm text-muted-foreground/60">No active ICP profiles found. Create one first.</p>
            ) : null}
          </div>

          {/* ICP Preview */}
          {selectedIcp ? <IcpPreviewCard icp={selectedIcp} /> : null}

          {/* Step 2: Provider — expanded inline pill selector */}
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-zbooni-teal/10 text-xs font-bold text-zbooni-teal">
                2
              </span>
              <label className="text-sm font-semibold">Data Source</label>
              <span className="text-xs text-muted-foreground">(optional)</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {PROVIDER_OPTIONS.map((opt) => (
                <PillOption
                  key={opt.value}
                  selected={provider === opt.value}
                  onClick={() => setProvider(opt.value)}
                >
                  <span>{opt.label}</span>
                  <span className="hidden text-[10px] font-normal text-muted-foreground/70 sm:inline">
                    {opt.description}
                  </span>
                </PillOption>
              ))}
            </div>
          </div>

          {/* Step 3: Limit — expanded inline pill selector */}
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-zbooni-teal/10 text-xs font-bold text-zbooni-teal">
                3
              </span>
              <label className="text-sm font-semibold">Number of Leads</label>
            </div>
            <div className="flex flex-wrap gap-2">
              {LIMIT_OPTIONS.map((opt) => (
                <PillOption
                  key={opt.value}
                  selected={limit === opt.value}
                  onClick={() => setLimit(opt.value)}
                  className="min-w-[56px] justify-center"
                >
                  {opt.label}
                </PillOption>
              ))}
            </div>
          </div>

          {/* Error */}
          {submitError ? (
            <div className="flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {submitError}
            </div>
          ) : null}

          {/* Launch button */}
          <button
            type="button"
            onClick={handleStartDiscovery}
            disabled={selectedIcpIds.size === 0 || isSubmitting || !!isRunning}
            className="inline-flex w-full items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-zbooni-green to-zbooni-teal px-6 py-3 text-sm font-bold text-zbooni-dark shadow-lg shadow-zbooni-green/20 transition-all hover:shadow-xl hover:shadow-zbooni-green/30 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {isSubmitting
              ? 'Starting...'
              : isRunning
                ? 'Discovery Running...'
                : selectedIcpIds.size > 1
                  ? `Start Discovery (${selectedIcpIds.size} ICPs)`
                  : 'Start Discovery'}
          </button>
        </div>
      </div>

      {/* Active Run Status */}
      {activeRun ? (
        <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-bold tracking-tight">
              <Zap className="h-4 w-4 text-zbooni-green" />
              Discovery Run
            </h2>
            <div className="flex items-center gap-2">
              <StatusIcon status={activeRun.status} />
              <span
                className={`text-sm font-semibold ${
                  activeRun.status === 'SUCCEEDED'
                    ? 'text-zbooni-green'
                    : activeRun.status === 'FAILED'
                      ? 'text-red-400'
                      : 'text-zbooni-teal'
                }`}
              >
                {activeRun.status}
              </span>
            </div>
          </div>

          {/* Progress */}
          {activeRun.totalItems > 0 || activeRun.status === 'RUNNING' ? (
            <ProgressBar processed={activeRun.processedItems} total={activeRun.totalItems || parseInt(limit, 10)} />
          ) : null}

          {/* Stats */}
          <div className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Total</p>
              <p className="mt-0.5 text-lg font-bold">{activeRun.totalItems}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Processed</p>
              <p className="mt-0.5 text-lg font-bold text-zbooni-green">{activeRun.processedItems}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Failed</p>
              <p className="mt-0.5 text-lg font-bold text-red-400">{activeRun.failedItems}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Duration</p>
              <p className="mt-0.5 text-lg font-bold">
                {activeRun.startedAt
                  ? activeRun.endedAt
                    ? `${Math.round((new Date(activeRun.endedAt).getTime() - new Date(activeRun.startedAt).getTime()) / 1000)}s`
                    : 'Running...'
                  : 'Queued'}
              </p>
            </div>
          </div>

          {/* Error message */}
          {activeRun.errorMessage ? (
            <div className="mt-4 flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {activeRun.errorMessage}
            </div>
          ) : null}

          {/* Success message */}
          {activeRun.status === 'SUCCEEDED' ? (
            <div className="mt-4 flex items-center gap-2 rounded-lg bg-zbooni-green/10 px-3 py-2 text-sm text-zbooni-green">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Discovery complete! {activeRun.processedItems} leads found. Check the Leads page to review them.
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Recent Discovery Records */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-bold tracking-tight">
            <Users className="h-4 w-4 text-zbooni-teal" />
            Recent Discoveries
          </h2>
          {records.data?.qualityMetrics ? (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>
                Emails: <strong className="text-foreground">{records.data.qualityMetrics.validEmailCount}</strong>
              </span>
              <span>
                Industry match:{' '}
                <strong className="text-foreground">
                  {Math.round(records.data.qualityMetrics.industryMatchRate * 100)}%
                </strong>
              </span>
              <span>
                Geo match:{' '}
                <strong className="text-foreground">
                  {Math.round(records.data.qualityMetrics.geoMatchRate * 100)}%
                </strong>
              </span>
            </div>
          ) : null}
        </div>

        {records.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
            Loading records...
          </div>
        ) : null}

        {!records.isLoading && records.data?.items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-zbooni-dark/60">
              <Search className="h-7 w-7 text-muted-foreground/40" />
            </div>
            <p className="font-medium text-muted-foreground/60">No discoveries yet</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground/40">
              Select an ICP profile above and start discovering leads matching your criteria.
            </p>
          </div>
        ) : null}

        {records.data && records.data.items.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-border/30">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/30 bg-zbooni-dark/30">
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Provider</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Lead</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Discovered</th>
                </tr>
              </thead>
              <tbody>
                {records.data.items.map((record) => (
                  <tr key={record.id} className="border-b border-border/20 last:border-0 transition-colors hover:bg-accent/30">
                    <td className="px-4 py-2.5">
                      <span className="rounded-full bg-zbooni-teal/10 px-2 py-0.5 text-xs font-medium text-zbooni-teal">
                        {record.provider.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          record.status === 'DISCOVERED'
                            ? 'bg-zbooni-green/15 text-zbooni-green'
                            : record.status === 'DUPLICATE'
                              ? 'bg-yellow-500/15 text-yellow-400'
                              : record.status === 'ERROR'
                                ? 'bg-red-500/15 text-red-400'
                                : 'bg-gray-500/15 text-gray-400'
                        }`}
                      >
                        {record.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                      {record.leadId.slice(0, 12)}...
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {new Date(record.discoveredAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {records.data && records.data.total > 10 ? (
          <p className="mt-3 text-center text-xs text-muted-foreground/60">
            Showing 10 of {records.data.total} records. View all in the Leads page.
          </p>
        ) : null}
      </div>

      {/* How it Works */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-base font-bold tracking-tight">How Discovery Works</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          {[
            { step: 1, title: 'Select ICP', desc: 'Choose which customer profile to target', icon: Target },
            { step: 2, title: 'Search & Discover', desc: 'AI scans multiple data sources for matching leads', icon: Search },
            { step: 3, title: 'Enrich & Score', desc: 'Each lead is enriched and scored automatically', icon: TrendingUp },
            { step: 4, title: 'Message & Follow-up', desc: 'Approved messages are sent via email or WhatsApp', icon: Zap },
          ].map(({ step, title, desc, icon: Icon }, idx) => (
            <div key={step} className="relative flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zbooni-teal/10">
                <Icon className="h-5 w-5 text-zbooni-teal" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground/60">Step {step}</p>
                <p className="font-semibold">{title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground/60">{desc}</p>
              </div>
              {idx < 3 ? (
                <ChevronRight className="absolute -right-2 top-3 hidden h-4 w-4 text-muted-foreground/20 sm:block" />
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
