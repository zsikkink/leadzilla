'use client';

import type { ContactRecoveryItem, ContactRecoveryStatus } from '@lead-flood/contracts';
import {
  Building2,
  Globe,
  Instagram,
  Linkedin,
  Loader2,
  Mail,
  MapPin,
  Search,
  ShieldX,
  Sparkles,
  UserRound,
  Wrench,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { CustomSelect } from '@/components/custom-select.js';
import { LeadsNav } from '@/components/leads-nav.js';
import { useApiQuery } from '@/hooks/use-api-query.js';
import { useAuth } from '@/hooks/use-auth.js';
import { cn } from '@/lib/utils.js';

const STATUS_OPTIONS = [
  { value: 'OPEN', label: 'Open queue' },
  { value: 'REJECTED', label: 'Rejected items' },
];

function formatReason(reason: string): string {
  return reason === 'NO_CONTACTS_FOUND' ? 'No contacts found' : 'No sendable email';
}

function formatAttemptStatus(status: string): string {
  return status.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatVerificationVerdict(verdict: string): string {
  switch (verdict) {
    case 'verified':
      return 'Verified';
    case 'not_verified':
      return 'Not verified';
    case 'inconclusive':
      return 'Inconclusive';
    default:
      return 'Not attempted';
  }
}

function formatQueryFamily(queryFamily: string | null): string {
  if (!queryFamily) {
    return 'No dominant query';
  }

  return queryFamily
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function scorePercent(score: number | null): string {
  if (score === null) {
    return 'N/A';
  }
  return `${Math.round(score * 100)}%`;
}

function RecoveryListCard({
  item,
  isSelected,
  onSelect,
}: {
  item: ContactRecoveryItem;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-2xl border p-4 text-left transition-colors',
        isSelected
          ? 'border-amber-400/50 bg-amber-500/10 shadow-sm'
          : 'border-border/40 bg-card hover:border-border/70 hover:bg-card/80',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{item.business.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {[item.business.city, item.business.country].filter(Boolean).join(', ') || 'Location unavailable'}
          </p>
        </div>
        <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-300">
          {formatReason(item.reason)}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
        <span className="rounded-full bg-muted/40 px-2.5 py-1">
          Fit {scorePercent(item.business.deterministicScore ?? null)}
        </span>
        <span className="rounded-full bg-muted/40 px-2.5 py-1">
          {item.candidateCount} candidate{item.candidateCount === 1 ? '' : 's'}
        </span>
        <span className="rounded-full bg-muted/40 px-2.5 py-1">
          Evidence {scorePercent(item.evidenceScore)}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>{item.icpProfileName ?? 'Unknown ICP'}</span>
        <span>{new Date(item.updatedAt).toLocaleDateString()}</span>
      </div>
    </button>
  );
}

function RecoveryDetailPanel({
  item,
  onReject,
  rejecting,
}: {
  item: ContactRecoveryItem;
  onReject: () => void;
  rejecting: boolean;
}) {
  return (
    <div className="space-y-4 rounded-2xl border border-border/50 bg-card p-5 shadow-sm">
      <div className="flex flex-col gap-3 border-b border-border/40 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-foreground">{item.business.name}</h2>
            <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-300">
              {formatReason(item.reason)}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Run {item.discoveryRunId.slice(0, 8)} • {item.icpProfileName ?? 'Unknown ICP'}
          </p>
        </div>
        {item.status === 'OPEN' ? (
          <button
            type="button"
            onClick={onReject}
            disabled={rejecting}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-300 transition-colors hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {rejecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldX className="h-4 w-4" />}
            Reject Item
          </button>
        ) : (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            Rejected {item.rejectedAt ? new Date(item.rejectedAt).toLocaleString() : ''}
          </div>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-border/40 bg-background/30 p-3">
          <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground/60">Fit Score</p>
          <p className="mt-2 text-2xl font-bold text-foreground">{scorePercent(item.business.deterministicScore ?? null)}</p>
        </div>
        <div className="rounded-xl border border-border/40 bg-background/30 p-3">
          <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground/60">Recovery Evidence</p>
          <p className="mt-2 text-2xl font-bold text-foreground">{scorePercent(item.evidenceScore)}</p>
        </div>
        <div className="rounded-xl border border-border/40 bg-background/30 p-3">
          <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground/60">Verification</p>
          <p className="mt-2 text-2xl font-bold text-foreground">{formatVerificationVerdict(item.snapshot.telemetry.verificationVerdict)}</p>
        </div>
        <div className="rounded-xl border border-border/40 bg-background/30 p-3">
          <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground/60">Emails Inferred</p>
          <p className="mt-2 text-2xl font-bold text-foreground">{item.snapshot.telemetry.cseEmailsInferred}</p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <section className="space-y-4">
          <div className="rounded-xl border border-border/40 bg-background/30 p-4">
            <h3 className="text-sm font-semibold text-foreground">Business Context</h3>
            <div className="mt-3 grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground/50" />
                <span>{[item.business.city, item.business.country].filter(Boolean).join(', ') || 'Location unavailable'}</span>
              </div>
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground/50" />
                <span>{item.business.category ?? 'Category unavailable'}</span>
              </div>
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground/50" />
                <span>{item.business.websiteDomain ?? 'No website domain'}</span>
              </div>
              <div className="flex items-center gap-2">
                <Instagram className="h-4 w-4 text-muted-foreground/50" />
                <span>{item.business.instagramHandle ? `@${item.business.instagramHandle}` : 'No Instagram handle'}</span>
              </div>
            </div>
            {item.snapshot.businessInsights ? (
              <div className="mt-4 rounded-lg border border-border/40 bg-card/70 p-3 text-sm text-muted-foreground">
                {item.snapshot.businessInsights}
              </div>
            ) : null}
          </div>

          <div className="rounded-xl border border-border/40 bg-background/30 p-4">
            <div className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-amber-300" />
              <h3 className="text-sm font-semibold text-foreground">Recovery Attempts</h3>
            </div>
            <div className="mt-3 space-y-3">
              {item.snapshot.attempts.length > 0 ? item.snapshot.attempts.map((attempt, index) => (
                <div key={`${attempt.provider}-${attempt.mode ?? 'none'}-${index}`} className="rounded-lg border border-border/40 bg-card/70 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{attempt.provider}</p>
                      <p className="text-xs text-muted-foreground">{attempt.mode ? `${attempt.stage} • ${attempt.mode}` : attempt.stage}</p>
                    </div>
                    <span className="rounded-full bg-muted/40 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
                      {formatAttemptStatus(attempt.status)}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Results: {attempt.resultCount ?? 0}
                  </p>
                  {attempt.notes.length > 0 ? (
                    <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                      {attempt.notes.map((note) => (
                        <p key={note}>{note}</p>
                      ))}
                    </div>
                  ) : null}
                </div>
              )) : (
                <p className="text-sm text-muted-foreground">No recovery attempts were recorded.</p>
              )}
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-xl border border-border/40 bg-background/30 p-4">
            <div className="flex items-center gap-2">
              <UserRound className="h-4 w-4 text-muted-foreground/70" />
              <h3 className="text-sm font-semibold text-foreground">Top Candidates</h3>
            </div>
            <div className="mt-3 space-y-3">
              {item.snapshot.topCandidates.length > 0 ? item.snapshot.topCandidates.map((candidate) => (
                <div key={`${candidate.name}-${candidate.source}-${candidate.sourceStage ?? 'none'}`} className="rounded-lg border border-border/40 bg-card/70 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{candidate.name}</p>
                      <p className="text-xs text-muted-foreground">{candidate.title ?? 'Title unavailable'}</p>
                    </div>
                    <span className="rounded-full bg-muted/40 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
                      {scorePercent(candidate.evidenceScore)}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                    <span className="rounded-full bg-muted/40 px-2.5 py-1">{candidate.source}</span>
                    <span className="rounded-full bg-muted/40 px-2.5 py-1">{candidate.sourceStage ?? 'No stage'}</span>
                    <span className="rounded-full bg-muted/40 px-2.5 py-1">{candidate.seniority}</span>
                    <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-amber-200">{formatVerificationVerdict(candidate.verificationVerdict)}</span>
                  </div>

                  <div className="mt-3 space-y-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <Mail className="h-3.5 w-3.5" />
                      <span>{candidate.email ?? 'No personal email found'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Linkedin className="h-3.5 w-3.5" />
                      <span>{candidate.linkedinUrl ?? 'No LinkedIn profile found'}</span>
                    </div>
                  </div>

                  {candidate.matchedSignals.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {candidate.matchedSignals.map((signal) => (
                        <span key={signal} className="rounded-full bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-200">
                          {signal.replaceAll('_', ' ')}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {candidate.supportingUrls.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {candidate.supportingUrls.slice(0, 2).map((url) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-200 hover:text-amber-100"
                        >
                          Evidence link
                          <Globe className="h-3 w-3" />
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
              )) : (
                <p className="text-sm text-muted-foreground">No candidate people were preserved for this item.</p>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-border/40 bg-background/30 p-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-muted-foreground/70" />
              <h3 className="text-sm font-semibold text-foreground">Telemetry</h3>
            </div>
            <div className="mt-3 grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
              <p>CSE verify attempted: {item.snapshot.telemetry.cseVerifyAttempted ? 'Yes' : 'No'}</p>
              <p>CSE discover attempted: {item.snapshot.telemetry.cseDiscoverAttempted ? 'Yes' : 'No'}</p>
              <p>CSE raw results: {item.snapshot.telemetry.cseRawResults}</p>
              <p>CSE candidates added: {item.snapshot.telemetry.cseCandidatesAdded}</p>
              <p>CSE candidates validated: {item.snapshot.telemetry.cseCandidatesValidated}</p>
              <p>Top query family: {formatQueryFamily(item.snapshot.telemetry.topQueryFamily)}</p>
              <p>Final outcome: {item.snapshot.telemetry.finalOutcome.replaceAll('_', ' ')}</p>
            </div>
            {item.snapshot.telemetry.supportingUrls.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {item.snapshot.telemetry.supportingUrls.slice(0, 3).map((url) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-full bg-muted/30 px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
                  >
                    Evidence
                    <Globe className="h-3 w-3" />
                  </a>
                ))}
              </div>
            ) : null}
          </div>

          <div className="rounded-xl border border-border/40 bg-background/30 p-4">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground/70" />
              <h3 className="text-sm font-semibold text-foreground">Search Evidence</h3>
            </div>
            {item.snapshot.telemetry.diagnostics.length > 0 ? (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-left text-xs text-muted-foreground">
                  <thead>
                    <tr className="border-b border-border/20 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                      <th className="pb-2 pr-4">Family</th>
                      <th className="pb-2 pr-4">Source</th>
                      <th className="pb-2 pr-4">Raw</th>
                      <th className="pb-2 pr-4">Promoted</th>
                      <th className="pb-2">Verdict</th>
                    </tr>
                  </thead>
                  <tbody>
                    {item.snapshot.telemetry.diagnostics.map((diagnostic, index) => (
                      <tr key={`${diagnostic.queryFamily}-${index}`} className="border-b border-border/10 last:border-0">
                        <td className="py-2 pr-4 font-medium text-foreground">{formatQueryFamily(diagnostic.queryFamily)}</td>
                        <td className="py-2 pr-4">{diagnostic.sourceFamily.replaceAll('_', ' ')}</td>
                        <td className="py-2 pr-4">{diagnostic.rawResultCount}</td>
                        <td className="py-2 pr-4">{diagnostic.promotedCount}</td>
                        <td className="py-2">{formatVerificationVerdict(diagnostic.verdict)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">No query-family diagnostics were recorded.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export default function ContactRecoveryPage() {
  const { apiClient } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [status, setStatus] = useState<ContactRecoveryStatus>('OPEN');
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('selected'));
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const recovery = useApiQuery(
    useCallback(
      () =>
        apiClient.listContactRecoveryItems({
          page,
          pageSize,
          status,
          ...(debouncedQuery ? { q: debouncedQuery } : {}),
        }),
      [apiClient, debouncedQuery, page, pageSize, status],
    ),
    [debouncedQuery, page, pageSize, status],
  );

  useEffect(() => {
    const requestedSelected = searchParams.get('selected');
    if (requestedSelected) {
      setSelectedId(requestedSelected);
    }
  }, [searchParams]);

  useEffect(() => {
    const firstId = recovery.data?.items[0]?.id ?? null;
    if (!selectedId && firstId) {
      setSelectedId(firstId);
    }
    if (selectedId && recovery.data && !recovery.data.items.some((item) => item.id === selectedId)) {
      setSelectedId(firstId);
    }
  }, [recovery.data, selectedId]);

  const selected = selectedId
    ? recovery.data?.items.find((item) => item.id === selectedId) ?? null
    : null;

  async function handleReject(item: ContactRecoveryItem): Promise<void> {
    if (!window.confirm(`Reject "${item.business.name}" from the contact recovery queue?`)) {
      return;
    }

    setRejectingId(item.id);
    try {
      await apiClient.rejectContactRecoveryItem(item.id);
      toast.success(`${item.business.name} removed from the open recovery queue`);
      recovery.refetch();
      router.replace('/dashboard/leads/recovery');
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to reject contact recovery item');
    } finally {
      setRejectingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <LeadsNav active="contact-recovery" />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Contact Recovery</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Review good-fit businesses that passed pre-qualification but still need a real decision-maker contact.
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-border/50 bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex items-center gap-3 rounded-xl border border-border/40 bg-background/40 px-3 py-2 lg:flex-1">
            <Search className="h-4 w-4 text-muted-foreground/40" />
            <input
              type="text"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="Search business name, city, category, or domain..."
              className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
            />
          </div>
          <div className="flex gap-2">
            <CustomSelect
              value={status}
              onChange={(value) => {
                setStatus(value as ContactRecoveryStatus);
                setPage(1);
              }}
              options={STATUS_OPTIONS}
              placeholder="Open queue"
            />
            <CustomSelect
              value={String(pageSize)}
              onChange={(value) => {
                setPageSize(parseInt(value, 10) || 20);
                setPage(1);
              }}
              options={[
                { value: '10', label: '10 per page' },
                { value: '20', label: '20 per page' },
                { value: '40', label: '40 per page' },
              ]}
              placeholder="20 per page"
            />
          </div>
        </div>
      </div>

      {recovery.error ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {recovery.error}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <div className="space-y-3 xl:max-h-[calc(100vh-220px)] xl:overflow-y-auto xl:pr-1">
          {recovery.isLoading ? (
            <div className="flex items-center gap-2 rounded-xl border border-border/30 bg-card p-6">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/40" />
              <span className="text-sm text-muted-foreground/60">Loading recovery queue...</span>
            </div>
          ) : recovery.data && recovery.data.items.length > 0 ? (
            <>
              {recovery.data.items.map((item) => (
                <RecoveryListCard
                  key={item.id}
                  item={item}
                  isSelected={item.id === selectedId}
                  onSelect={() => {
                    setSelectedId(item.id);
                    router.replace(`/dashboard/leads/recovery?selected=${item.id}`);
                  }}
                />
              ))}
              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page === 1}
                  className="rounded-lg border border-border/30 px-3 py-1.5 text-xs font-semibold text-muted-foreground disabled:opacity-30"
                >
                  Prev
                </button>
                <span className="text-xs text-muted-foreground/50">
                  Page {page} of {recovery.data ? Math.max(1, Math.ceil(recovery.data.total / recovery.data.pageSize)) : 1}
                </span>
                <button
                  type="button"
                  onClick={() => setPage(Math.min(Math.max(1, Math.ceil((recovery.data?.total ?? 0) / pageSize)), page + 1))}
                  disabled={!recovery.data || page >= Math.ceil(recovery.data.total / recovery.data.pageSize)}
                  className="rounded-lg border border-border/30 px-3 py-1.5 text-xs font-semibold text-muted-foreground disabled:opacity-30"
                >
                  Next
                </button>
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-border/40 bg-card p-6 text-center">
              <Wrench className="mx-auto h-10 w-10 text-muted-foreground/20" />
              <h3 className="mt-4 text-base font-bold tracking-tight text-muted-foreground/70">Queue is clear</h3>
              <p className="mt-1 text-sm text-muted-foreground/50">
                No recovery items matched the current filters.
              </p>
            </div>
          )}
        </div>

        {selected ? (
          <RecoveryDetailPanel
            item={selected}
            rejecting={rejectingId === selected.id}
            onReject={() => void handleReject(selected)}
          />
        ) : (
          <div className="rounded-2xl border border-border/40 bg-card p-6 shadow-sm">
            <div className="flex min-h-[420px] flex-col items-center justify-center text-center">
              <Wrench className="h-12 w-12 text-muted-foreground/15" />
              <h3 className="mt-4 text-base font-bold tracking-tight text-muted-foreground/65">Select a recovery item</h3>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground/45">
                Choose a business from the queue to inspect recovery attempts, Google CSE evidence, and the best remaining candidate people.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
