'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Globe,
  Layers,
  Loader2,
  Mail,
  MessageSquare,
  Radar,
  Search,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react';

import { cn } from '@/lib/utils.js';
import { useAuth } from '@/hooks/use-auth.js';
import { useApiQuery } from '@/hooks/use-api-query.js';

// ── Types ──────────────────────────────────────────────────────────────────

type StageStatus = 'completed' | 'pending' | 'skipped' | 'failed';

interface StageDetail {
  label: string;
  value: string;
}

interface PipelineStage {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string | undefined }>;
  status: StageStatus;
  timestamp: string | null;
  details: StageDetail[];
}

interface LeadRecord {
  id: string;
  name: string;
  company: string;
  email: string;
  country: string;
  city: string;
  industry: string;
  score: number;
  tier: string;
  stages: PipelineStage[];
}

// ── Helpers to extract details from enrichment payload ───────────────────

function extractEnrichmentDetails(payload: Record<string, unknown>): StageDetail[] {
  const details: StageDetail[] = [];
  if (payload.companyName) details.push({ label: 'Company', value: String(payload.companyName) });
  if (payload.industry) details.push({ label: 'Industry', value: String(payload.industry) });
  if (payload.country) details.push({ label: 'Country', value: String(payload.country) });
  if (payload.city) details.push({ label: 'City', value: String(payload.city) });
  if (payload.employeeCount) details.push({ label: 'Employees', value: String(payload.employeeCount) });
  if (payload.linkedinUrl) details.push({ label: 'LinkedIn', value: String(payload.linkedinUrl) });
  if (payload.websiteUrl) details.push({ label: 'Website', value: String(payload.websiteUrl) });
  if (payload.googleRating) details.push({ label: 'Google Rating', value: `${payload.googleRating}/5` });
  if (payload.googleReviewCount) details.push({ label: 'Reviews', value: String(payload.googleReviewCount) });
  return details;
}

function extractFeatureDetails(payload: Record<string, unknown>): StageDetail[] {
  const details: StageDetail[] = [];
  if (payload.hasWhatsApp != null) details.push({ label: 'Has WhatsApp', value: payload.hasWhatsApp ? 'Yes' : 'No' });
  if (payload.instagramFollowers) details.push({ label: 'Instagram Followers', value: String(payload.instagramFollowers) });
  if (payload.acceptsOnlinePayments != null) details.push({ label: 'Online Payments', value: payload.acceptsOnlinePayments ? 'Yes' : 'No' });
  if (payload.recentlyActive != null) details.push({ label: 'Recently Active', value: payload.recentlyActive ? 'Yes' : 'No' });
  return details;
}

// ── Map lead data to pipeline stages ─────────────────────────────────────

const STATUS_PROGRESSION: Record<string, number> = {
  new: 0,
  processing: 1,
  enriched: 2,
  failed: -1,
  messaged: 4,
  replied: 5,
  cold: 6,
};

interface LeadItem {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  source: string;
  status: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  latestScoreBand?: string | null | undefined;
  latestBlendedScore?: number | null | undefined;
  latestEnrichmentNormalizedPayload?: unknown | undefined;
  latestEnrichmentRawPayload?: unknown | undefined;
  latestDiscoveryRawPayload?: unknown | undefined;
}

function buildPipelineStages(lead: LeadItem): PipelineStage[] {
  const enrichment = lead.latestEnrichmentNormalizedPayload as Record<string, unknown> | null;
  const rawEnrichment = lead.latestEnrichmentRawPayload as Record<string, unknown> | null;
  const hasEnrichment = enrichment !== null || rawEnrichment !== null;
  const hasScore = lead.latestBlendedScore !== null;
  const statusLevel = STATUS_PROGRESSION[lead.status] ?? 0;
  const isFailed = lead.status === 'failed';
  const isMessaged = statusLevel >= 4;
  const isReplied = lead.status === 'replied';
  const isCold = lead.status === 'cold';
  const isLowScore = lead.latestScoreBand === 'LOW';

  // Determine enrichment failure: status is 'failed' with no enrichment data
  const enrichmentFailed = isFailed && !hasEnrichment;

  return [
    // 1. Discovery — always completed (lead exists in system)
    {
      id: 'discovery',
      title: 'Discovery',
      icon: Radar,
      status: 'completed',
      timestamp: lead.createdAt,
      details: [
        { label: 'Source', value: lead.source },
        { label: 'Lead ID', value: lead.id },
      ],
    },

    // 2. Enrichment
    {
      id: 'enrichment',
      title: 'Enrichment',
      icon: Layers,
      status: enrichmentFailed ? 'failed'
        : hasEnrichment ? 'completed'
        : statusLevel >= 1 ? 'pending' : 'pending',
      timestamp: hasEnrichment ? lead.updatedAt : null,
      details: [
        ...(enrichmentFailed && lead.error ? [{ label: 'Error', value: lead.error }] : []),
        ...(enrichment ? extractEnrichmentDetails(enrichment) : []),
      ],
    },

    // 3. Feature Computation
    {
      id: 'features',
      title: 'Feature Computation',
      icon: Sparkles,
      status: hasScore ? 'completed'
        : enrichmentFailed ? 'skipped'
        : hasEnrichment ? 'pending' : 'pending',
      timestamp: hasScore ? lead.updatedAt : null,
      details: enrichment ? extractFeatureDetails(enrichment) : [],
    },

    // 4. Scoring
    {
      id: 'scoring',
      title: 'Scoring',
      icon: Target,
      status: hasScore ? 'completed'
        : enrichmentFailed ? 'skipped'
        : 'pending',
      timestamp: hasScore ? lead.updatedAt : null,
      details: hasScore ? [
        { label: 'Blended Score', value: lead.latestBlendedScore!.toFixed(3) },
        { label: 'Score Band', value: lead.latestScoreBand ?? 'N/A' },
      ] : [],
    },

    // 5. Message Generation
    {
      id: 'message-gen',
      title: 'Message Generation',
      icon: Mail,
      status: isMessaged || isReplied || isCold ? 'completed'
        : isLowScore ? 'skipped'
        : !hasScore ? 'pending' : 'pending',
      timestamp: null,
      details: isLowScore
        ? [{ label: 'Reason', value: 'Score below threshold' }]
        : [],
    },

    // 6. Message Send
    {
      id: 'message-send',
      title: 'Message Send',
      icon: MessageSquare,
      status: isMessaged || isReplied || isCold ? 'completed'
        : isLowScore || enrichmentFailed ? 'skipped'
        : 'pending',
      timestamp: null,
      details: isLowScore || enrichmentFailed
        ? [{ label: 'Reason', value: 'No message generated' }]
        : [],
    },

    // 7. Follow-ups
    {
      id: 'followups',
      title: 'Follow-ups',
      icon: Clock,
      status: isReplied || isCold ? 'completed'
        : isMessaged ? 'pending'
        : 'skipped',
      timestamp: null,
      details: isCold
        ? [{ label: 'Outcome', value: 'No reply received' }]
        : isReplied
          ? [{ label: 'Outcome', value: 'Reply received' }]
          : [],
    },

    // 8. Feedback
    {
      id: 'feedback',
      title: 'Feedback',
      icon: TrendingUp,
      status: isReplied ? 'completed'
        : isMessaged || isCold ? 'pending'
        : 'skipped',
      timestamp: null,
      details: isReplied
        ? [{ label: 'Status', value: 'Reply classified' }]
        : [],
    },
  ];
}

// ── Map API item to LeadRecord ───────────────────────────────────────────

function mapToLeadRecord(item: LeadItem): LeadRecord {
  const enrichment = item.latestEnrichmentNormalizedPayload as Record<string, unknown> | null;

  return {
    id: item.id,
    name: `${item.firstName} ${item.lastName}`,
    company: (enrichment?.companyName as string) ?? '',
    email: item.email,
    country: (enrichment?.country as string) ?? '',
    city: (enrichment?.city as string) ?? '',
    industry: (enrichment?.industry as string) ?? '',
    score: item.latestBlendedScore ?? 0,
    tier: item.latestScoreBand ?? 'LOW',
    stages: buildPipelineStages(item),
  };
}

// ── Status styling ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<StageStatus, { label: string; color: string; bg: string; borderColor: string; dotColor: string }> = {
  completed: {
    label: 'Completed',
    color: 'text-zbooni-green',
    bg: 'bg-zbooni-green/10',
    borderColor: 'border-zbooni-green/30',
    dotColor: 'bg-zbooni-green',
  },
  pending: {
    label: 'Pending',
    color: 'text-zbooni-teal',
    bg: 'bg-zbooni-teal/10',
    borderColor: 'border-zbooni-teal/30',
    dotColor: 'bg-zbooni-teal',
  },
  skipped: {
    label: 'Skipped',
    color: 'text-yellow-400',
    bg: 'bg-yellow-400/10',
    borderColor: 'border-yellow-400/30',
    dotColor: 'bg-yellow-400',
  },
  failed: {
    label: 'Failed',
    color: 'text-red-400',
    bg: 'bg-red-400/10',
    borderColor: 'border-red-400/30',
    dotColor: 'bg-red-400',
  },
};

function StatusIcon({ status, className }: { status: StageStatus; className?: string | undefined }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className={cn('text-zbooni-green', className)} />;
    case 'pending':
      return <Clock className={cn('text-zbooni-teal', className)} />;
    case 'skipped':
      return <AlertTriangle className={cn('text-yellow-400', className)} />;
    case 'failed':
      return <AlertTriangle className={cn('text-red-400', className)} />;
  }
}

// ── Stage timeline item ─────────────────────────────────────────────────────

function TimelineStage({
  stage,
  isLast,
  index,
}: {
  stage: PipelineStage;
  isLast: boolean;
  index: number;
}) {
  const [expanded, setExpanded] = useState(stage.status === 'failed');
  const config = STATUS_CONFIG[stage.status];
  const Icon = stage.icon;

  return (
    <div
      className="timeline-entry group relative flex gap-4"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      {/* Vertical line + dot */}
      <div className="relative flex flex-col items-center">
        <div
          className={cn(
            'z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 transition-colors',
            config.borderColor,
            config.bg,
          )}
        >
          <Icon className={cn('h-4.5 w-4.5', config.color)} />
        </div>
        {!isLast && (
          <div className="w-px flex-1 bg-border/40" />
        )}
      </div>

      {/* Content */}
      <div className={cn('flex-1 pb-6', isLast && 'pb-0')}>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="group/btn flex w-full items-center gap-3 rounded-xl text-left transition-colors hover:bg-white/[0.02]"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <h3 className="text-sm font-bold tracking-tight">{stage.title}</h3>
              <span
                className={cn(
                  'rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                  config.bg,
                  config.color,
                )}
              >
                {config.label}
              </span>
            </div>
            {stage.timestamp ? (
              <p className="mt-0.5 font-mono text-[11px] text-muted-foreground/50">
                Approx. {new Date(stage.timestamp).toLocaleString()}
              </p>
            ) : (
              <p className="mt-0.5 text-[11px] text-muted-foreground/30 italic">
                No inferred timestamp
              </p>
            )}
          </div>
          {stage.details.length > 0 && (
            <span className="text-muted-foreground/30 transition-colors group-hover/btn:text-muted-foreground/60">
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </span>
          )}
        </button>

        {expanded && stage.details.length > 0 && (
          <div className="mt-3 space-y-1.5 rounded-xl border border-border/30 bg-slate-800 p-4">
            {stage.details.map((detail) => (
              <div key={detail.label} className="flex items-start gap-3 text-sm">
                <span className="w-40 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  {detail.label}
                </span>
                <span className={cn(
                  'font-mono text-xs',
                  stage.status === 'failed' && detail.label === 'Error'
                    ? 'text-red-400'
                    : 'text-foreground/80',
                )}>
                  {detail.value}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Lead summary card in search results ─────────────────────────────────────

function LeadSearchResult({
  lead,
  isSelected,
  onSelect,
}: {
  lead: LeadRecord;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const tierColor = lead.tier === 'HIGH'
    ? 'text-zbooni-green bg-zbooni-green/10'
    : lead.tier === 'MEDIUM'
      ? 'text-yellow-400 bg-yellow-400/10'
      : 'text-red-400 bg-red-400/10';

  const completedCount = lead.stages.filter((s) => s.status === 'completed').length;
  const failedCount = lead.stages.filter((s) => s.status === 'failed').length;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-xl border p-4 text-left transition-all duration-200',
        isSelected
          ? 'border-zbooni-green/40 bg-zbooni-green/[0.04] shadow-[0_0_20px_rgba(123,255,107,0.06)]'
          : 'border-border/30 bg-zbooni-dark/20 hover:border-border/50 hover:bg-zbooni-dark/40',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold tracking-tight">{lead.name}</p>
          <p className="text-[12px] text-muted-foreground/60">{lead.company}</p>
        </div>
        <span className={cn('shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider', tierColor)}>
          {lead.tier}
        </span>
      </div>
      <div className="mt-2.5 flex items-center gap-3 text-[11px] text-muted-foreground/40">
        {lead.country ? (
          <span className="flex items-center gap-1">
            <Globe className="h-3 w-3" />
            {lead.country}{lead.city ? ` / ${lead.city}` : ''}
          </span>
        ) : null}
        {lead.country ? <span className="text-muted-foreground/20">|</span> : null}
        <span className="font-mono tabular-nums">{lead.score.toFixed(3)}</span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="flex -space-x-0.5">
          {lead.stages.map((stage) => (
            <div
              key={stage.id}
              className={cn(
                'h-1.5 w-4 first:rounded-l-full last:rounded-r-full',
                STATUS_CONFIG[stage.status].dotColor,
                stage.status === 'pending' && 'opacity-40',
                stage.status === 'skipped' && 'opacity-50',
              )}
            />
          ))}
        </div>
        <span className="text-[10px] text-muted-foreground/30">
          {completedCount}/8{failedCount > 0 ? ` (${failedCount} failed)` : ''}
        </span>
      </div>
    </button>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function LeadLifecyclePage() {
  const { apiClient } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  const leadsQuery = useApiQuery(
    useCallback(() => apiClient.listLeads({ page: 1, pageSize: 50, includeQualityMetrics: false }), [apiClient]),
  );

  const allLeads = useMemo(() => {
    return leadsQuery.data?.items.map(mapToLeadRecord) ?? [];
  }, [leadsQuery.data]);

  const filteredLeads = useMemo(() => {
    if (!searchQuery.trim()) return allLeads;
    const q = searchQuery.toLowerCase();
    return allLeads.filter(
      (lead) =>
        lead.name.toLowerCase().includes(q) ||
        lead.company.toLowerCase().includes(q) ||
        lead.email.toLowerCase().includes(q) ||
        lead.id.toLowerCase().includes(q),
    );
  }, [searchQuery, allLeads]);

  const selectedLead = selectedLeadId
    ? allLeads.find((l) => l.id === selectedLeadId) ?? null
    : null;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-extrabold tracking-tight">Lead Lifecycle</h1>
            <p className="mt-1 text-sm text-muted-foreground/60">
              Reconstructed from current lead state, enrichment payloads, and latest record timestamps. This is not a canonical event log.
            </p>
          </div>
          <span className="inline-flex items-center rounded-full border border-yellow-400/20 bg-yellow-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-yellow-300">
            Inferred View
          </span>
        </div>
      </div>

      {/* ── Search bar ──────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zbooni-teal/10">
            <Search className="h-4 w-4 text-zbooni-teal" />
          </div>
          <div className="relative flex-1">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by lead ID, name, company, or email..."
              className="w-full rounded-xl border border-border/50 bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:border-zbooni-teal/50 focus:outline-none focus:ring-1 focus:ring-zbooni-teal/30"
            />
          </div>
          <span className="text-[11px] text-muted-foreground/40">
            {leadsQuery.isLoading ? '...' : `${filteredLeads.length} lead${filteredLeads.length !== 1 ? 's' : ''}`}
          </span>
        </div>
      </div>

      {leadsQuery.error ? (
        <p className="text-sm text-destructive">{leadsQuery.error}</p>
      ) : null}

      {/* ── Main layout: search results + timeline ──────────────────── */}
      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        {/* Left: Search results */}
        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/40">
            Search Results
          </p>
          {leadsQuery.isLoading ? (
            <div className="flex items-center gap-2 rounded-xl border border-border/30 bg-zbooni-dark/20 p-6">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/40" />
              <span className="text-sm text-muted-foreground/50">Loading leads...</span>
            </div>
          ) : filteredLeads.length > 0 ? (
            filteredLeads.map((lead) => (
              <LeadSearchResult
                key={lead.id}
                lead={lead}
                isSelected={selectedLeadId === lead.id}
                onSelect={() => setSelectedLeadId(lead.id)}
              />
            ))
          ) : (
            <div className="rounded-xl border border-border/30 bg-zbooni-dark/20 p-6 text-center">
              <Search className="mx-auto h-8 w-8 text-muted-foreground/20" />
              <p className="mt-2 text-sm text-muted-foreground/50">No leads match your search</p>
              <p className="mt-1 text-[11px] text-muted-foreground/30">
                Try a different name, company, or ID
              </p>
            </div>
          )}
        </div>

        {/* Right: Timeline */}
        <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
          {selectedLead ? (
            <>
              {/* Lead identity header */}
              <div className="mb-6 flex items-start justify-between gap-4 border-b border-border/30 pb-5">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800">
                      <Users className="h-5 w-5 text-zbooni-green" />
                    </div>
                    <div>
                      <h2 className="text-lg font-extrabold tracking-tight">{selectedLead.name}</h2>
                      <p className="text-[12px] text-muted-foreground/60">{selectedLead.company}</p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-2xl font-extrabold tabular-nums tracking-tight">{selectedLead.score.toFixed(3)}</p>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Blended Score
                    </p>
                  </div>
                  <StatusIcon status={selectedLead.tier === 'HIGH' ? 'completed' : selectedLead.tier === 'MEDIUM' ? 'pending' : 'failed'} className="h-5 w-5" />
                </div>
              </div>

              {/* Lead metadata row */}
              <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-border/20 bg-slate-800 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Country</p>
                  <p className="mt-0.5 text-sm font-bold">{selectedLead.country}{selectedLead.city ? ` / ${selectedLead.city}` : ''}</p>
                </div>
                <div className="rounded-lg border border-border/20 bg-slate-800 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Industry</p>
                  <p className="mt-0.5 text-sm font-bold">{selectedLead.industry || 'N/A'}</p>
                </div>
                <div className="rounded-lg border border-border/20 bg-slate-800 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Email</p>
                  <p className="mt-0.5 truncate font-mono text-xs">{selectedLead.email}</p>
                </div>
                <div className="rounded-lg border border-border/20 bg-slate-800 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Lead ID</p>
                  <p className="mt-0.5 truncate font-mono text-[10px]">{selectedLead.id}</p>
                </div>
              </div>

              {/* Stage summary bar */}
              <div className="mb-6 flex items-center gap-4">
                <div className="flex -space-x-0.5 flex-1">
                  {selectedLead.stages.map((stage) => (
                    <div
                      key={stage.id}
                      className={cn(
                        'h-2 flex-1 first:rounded-l-full last:rounded-r-full transition-all',
                        STATUS_CONFIG[stage.status].dotColor,
                        stage.status === 'pending' && 'opacity-30',
                        stage.status === 'skipped' && 'opacity-40',
                      )}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-4 text-[10px]">
                  {(['completed', 'pending', 'failed', 'skipped'] as const).map((status) => {
                    const count = selectedLead.stages.filter((s) => s.status === status).length;
                    if (count === 0) return null;
                    return (
                      <span key={status} className="flex items-center gap-1.5">
                        <span className={cn('h-2 w-2 rounded-full', STATUS_CONFIG[status].dotColor)} />
                        <span className="font-semibold text-muted-foreground/50">
                          {count} {STATUS_CONFIG[status].label.toLowerCase()}
                        </span>
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* Pipeline timeline */}
              <div className="space-y-0">
                {selectedLead.stages.map((stage, i) => (
                  <TimelineStage
                    key={stage.id}
                    stage={stage}
                    isLast={i === selectedLead.stages.length - 1}
                    index={i}
                  />
                ))}
              </div>
            </>
          ) : (
            /* Empty state */
            <div className="flex flex-col items-center justify-center py-20">
              <div className="relative">
                <div className="absolute inset-0 animate-pulse rounded-full bg-zbooni-teal/5 blur-2xl" />
                <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl border border-border/30 bg-zbooni-dark/40">
                  <Zap className="h-8 w-8 text-muted-foreground/20" />
                </div>
              </div>
              <h3 className="mt-5 text-base font-bold tracking-tight text-muted-foreground/60">
                No lead selected
              </h3>
              <p className="mt-1.5 max-w-xs text-center text-[12px] text-muted-foreground/35">
                Select a lead from the list to view the reconstructed lifecycle from discovery through feedback.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
