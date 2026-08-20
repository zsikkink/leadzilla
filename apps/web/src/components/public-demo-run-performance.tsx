'use client';

import {
  ArrowLeft,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  Database,
  Layers,
  ScanSearch,
  Search,
  Target,
  Timer,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect } from 'react';

import { useApiQuery } from '../hooks/use-api-query.js';
import { useAuth } from '../hooks/use-auth.js';
import { countryName } from '../lib/countries.js';
import {
  buildDemoDiscoveryLeadFlow,
  type DemoDiscoveryRunPerformance,
  getDemoDiscoveryRunPerformance,
} from '../lib/demo-discovery-runs.js';
import { LeadFlowSankey } from './lead-flow-sankey.js';

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return 'In progress';
  if (durationMs < 1_000) return '<1s';
  const seconds = Math.round(durationMs / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function formatTimestamp(value: string | null): string {
  if (!value) return 'In progress';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function PerformanceMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-border/30 bg-zbooni-dark/25 px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/50">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

export function PublicDemoRunPerformance({ runId }: { runId: string }) {
  const { apiClient } = useAuth();
  const performance = useApiQuery<DemoDiscoveryRunPerformance>(
    useCallback(() => {
      const bundledRun = getDemoDiscoveryRunPerformance(runId);
      return bundledRun
        ? Promise.resolve(bundledRun)
        : apiClient.getDemoDiscoveryRunPerformance(runId);
    }, [apiClient, runId]),
    [apiClient, runId],
  );

  useEffect(() => {
    if (!performance.data || !['QUEUED', 'RUNNING'].includes(performance.data.run.status)) {
      return;
    }
    const interval = window.setInterval(performance.refetch, 2_500);
    return () => window.clearInterval(interval);
  }, [performance.data, performance.refetch]);

  if (performance.isLoading && !performance.data) {
    return (
      <div className="space-y-4">
        <div className="h-5 w-36 animate-pulse rounded bg-border/20" />
        <div className="h-40 animate-pulse rounded-2xl bg-zbooni-dark/30" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-xl bg-zbooni-dark/30" />
          ))}
        </div>
      </div>
    );
  }

  if (performance.error || !performance.data) {
    return (
      <div className="space-y-5">
        <Link
          href="/dashboard/discover#discovery-runs"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Discover
        </Link>
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-8 text-center">
          <p className="font-bold text-amber-100">Run performance is unavailable</p>
          <p className="mt-1 text-sm text-amber-100/70">
            This live run belongs to a different browser session or has expired.
          </p>
        </div>
      </div>
    );
  }

  const data = performance.data;
  const run = data.run;
  const isSuccessful = run.status === 'SUCCEEDED';
  const leadFlowData = buildDemoDiscoveryLeadFlow(data);
  const scoringSummary = [
    data.scoringSources.openAi > 0 ? `${data.scoringSources.openAi} OpenAI` : null,
    data.scoringSources.trainedModel > 0
      ? `${data.scoringSources.trainedModel} trained model`
      : null,
    data.scoringSources.deterministicFallback > 0
      ? `${data.scoringSources.deterministicFallback} fallback`
      : null,
  ].filter(Boolean).join(' · ') || 'Waiting for scored leads';

  return (
    <div className="space-y-5">
      <Link
        href="/dashboard/discover#discovery-runs"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Discover
      </Link>

      <section className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-xl font-extrabold tracking-tight">
                {data.icpName ?? 'Discovery run'}
              </h2>
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                isSuccessful
                  ? 'bg-zbooni-green/15 text-zbooni-green'
                  : 'bg-amber-500/15 text-amber-300'
              }`}>
                {isSuccessful ? 'Completed' : run.status}
              </span>
            </div>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground/45">{run.runId}</p>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-zbooni-teal/20 bg-zbooni-teal/[0.06] px-3 py-2">
            <Timer className="h-4 w-4 text-zbooni-teal" />
            <div>
              <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/50">Measured duration</p>
              <p className="text-sm font-extrabold tabular-nums text-zbooni-teal">{formatDuration(data.durationMs)}</p>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-blue-400/20 bg-blue-400/[0.06] px-4 py-3">
          <div className="flex items-start gap-2.5">
            <Zap className="mt-0.5 h-4 w-4 shrink-0 text-blue-300" />
            <div>
              <p className="text-xs font-bold text-blue-100">Persisted execution evidence</p>
              <p className="mt-1 text-xs leading-5 text-blue-100/70">{data.stopReason}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
        <PerformanceMetric label="Task budget" value={data.taskBudget} />
        <PerformanceMetric label="Tasks executed" value={data.tasksExecuted} />
        <PerformanceMetric label="Results inspected" value={data.resultsInspected} />
        <PerformanceMetric label="Results scored" value={data.scoredResults} />
        <PerformanceMetric label="Already known" value={data.alreadyKnown} />
        <PerformanceMetric label="New businesses" value={data.newBusinesses} />
        <PerformanceMetric label="Leads created" value={data.leadsCreated} />
      </section>

      <section className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Zap className="h-4 w-4 text-zbooni-green" />
          <h3 className="text-base font-bold">Production pipeline</h3>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: 'Discovery provider',
              value: `${data.tasksExecuted} SerpAPI Maps task${data.tasksExecuted === 1 ? '' : 's'}`,
              detail: 'Durable search tasks and business evidence',
              Icon: Search,
            },
            {
              label: 'Website analysis',
              value: `${data.websitesScraped} fresh scrape${data.websitesScraped === 1 ? '' : 's'}`,
              detail: 'Website content and technology signals',
              Icon: ScanSearch,
            },
            {
              label: 'Feature pipeline',
              value: `${data.scoredResults} scored lead${data.scoredResults === 1 ? '' : 's'}`,
              detail: 'Feature snapshots persisted before scoring',
              Icon: Database,
            },
            {
              label: 'Scoring engine',
              value: scoringSummary,
              detail: data.pipelineMode === 'production_worker'
                ? 'Reported from persisted prediction provenance'
                : 'Bundled portfolio evidence',
              Icon: BrainCircuit,
            },
          ].map(({ label, value, detail, Icon }) => (
            <div key={label} className="rounded-xl border border-border/25 bg-zbooni-dark/20 p-4">
              <Icon className="h-4 w-4 text-zbooni-teal" />
              <p className="mt-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/45">{label}</p>
              <p className="mt-1 text-sm font-bold text-foreground/90">{value}</p>
              <p className="mt-1 text-[11px] leading-4 text-muted-foreground/50">{detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Layers className="h-4 w-4 text-zbooni-teal" />
          <h3 className="text-base font-bold">Discovery Flow</h3>
        </div>
        <LeadFlowSankey data={leadFlowData} />
      </section>

      <section className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Clock3 className="h-4 w-4 text-zbooni-teal" />
          <h3 className="text-base font-bold">Execution timeline</h3>
        </div>
        <div className="grid gap-2 md:grid-cols-4">
          {[
            ['Started', formatTimestamp(run.startedAt), Target],
            ['Provider work', `${data.tasksExecuted} task${data.tasksExecuted === 1 ? '' : 's'} executed`, Search],
            ['Scoring', `${data.scoredResults} results scored`, Database],
            ['Finished', formatTimestamp(run.finishedAt), CheckCircle2],
          ].map(([label, value, Icon]) => {
            const TimelineIcon = Icon as typeof Target;
            return (
              <div key={String(label)} className="rounded-xl border border-border/25 bg-zbooni-dark/20 p-3">
                <TimelineIcon className="h-4 w-4 text-zbooni-teal" />
                <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/45">{String(label)}</p>
                <p className="mt-1 text-xs font-semibold text-foreground/85">{String(value)}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-zbooni-green" />
            <h3 className="text-base font-bold">Provider task performance</h3>
          </div>
          <span className="rounded-full bg-muted/20 px-2.5 py-1 text-[10px] font-bold text-muted-foreground">
            {data.provider}
          </span>
        </div>
        <div className="space-y-2">
          {data.tasks.map((task, index) => (
            <div key={task.id} className="rounded-xl border border-border/25 bg-zbooni-dark/20 px-4 py-3">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-zbooni-green/10 text-[10px] font-extrabold text-zbooni-green">
                      {index + 1}
                    </span>
                    <p className="truncate text-sm font-semibold">{task.queryText}</p>
                  </div>
                  <p className="mt-1 pl-7 text-[11px] text-muted-foreground/50">
                    {countryName(task.countryCode)}{task.city ? ` · ${task.city}` : ''} · {task.provider}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-4 text-right">
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/40">Results</p>
                    <p className="text-xs font-bold tabular-nums">{task.resultsCount ?? 'Run-level'}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/40">Scored</p>
                    <p className="text-xs font-bold tabular-nums">{task.scoredCount}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/40">Duration</p>
                    <p className="text-xs font-bold tabular-nums">{formatDuration(task.durationMs)}</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${
                    task.status.toUpperCase() === 'DONE'
                      ? 'bg-zbooni-green/15 text-zbooni-green'
                      : 'bg-amber-500/15 text-amber-300'
                  }`}>
                    {task.status}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
