'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Brain,
  CalendarCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Cpu,
  Gauge,
  GitBranch,
  Globe,
  Layers,
  Loader2,
  Mail,
  MessageSquare,
  MessageSquareReply,
  Radar,
  Search,
  Sparkles,
  Tag,
  Target,
  ThumbsDown,
  ThumbsUp,
  TrendingDown,
  TrendingUp,
  Unplug,
  Users,
  Zap,
} from 'lucide-react';

import { cn } from '@/lib/utils.js';
import { useAuth } from '@/hooks/use-auth.js';
import { useApiQuery } from '@/hooks/use-api-query.js';

// ══════════════════════════════════════════════════════════════════════════════
//  TAB NAVIGATION
// ══════════════════════════════════════════════════════════════════════════════

type TabId = 'lifecycle' | 'model' | 'feedback';

const TABS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string | undefined }> }[] = [
  { id: 'lifecycle', label: 'Lead Lifecycle', icon: Search },
  { id: 'model', label: 'Model Inspector', icon: Brain },
  { id: 'feedback', label: 'Feedback & Replies', icon: MessageSquareReply },
];

// ══════════════════════════════════════════════════════════════════════════════
//  LIFECYCLE TAB — types & helpers
// ══════════════════════════════════════════════════════════════════════════════

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
  const enrichmentFailed = isFailed && !hasEnrichment;

  return [
    { id: 'discovery', title: 'Discovery', icon: Radar, status: 'completed', timestamp: lead.createdAt, details: [{ label: 'Source', value: lead.source }, { label: 'Lead ID', value: lead.id }] },
    { id: 'enrichment', title: 'Enrichment', icon: Layers, status: enrichmentFailed ? 'failed' : hasEnrichment ? 'completed' : 'pending', timestamp: hasEnrichment ? lead.updatedAt : null, details: [...(enrichmentFailed && lead.error ? [{ label: 'Error', value: lead.error }] : []), ...(enrichment ? extractEnrichmentDetails(enrichment) : [])] },
    { id: 'features', title: 'Feature Computation', icon: Sparkles, status: hasScore ? 'completed' : enrichmentFailed ? 'skipped' : 'pending', timestamp: hasScore ? lead.updatedAt : null, details: enrichment ? extractFeatureDetails(enrichment) : [] },
    { id: 'scoring', title: 'Scoring', icon: Target, status: hasScore ? 'completed' : enrichmentFailed ? 'skipped' : 'pending', timestamp: hasScore ? lead.updatedAt : null, details: hasScore ? [{ label: 'Blended Score', value: lead.latestBlendedScore!.toFixed(3) }, { label: 'Score Band', value: lead.latestScoreBand ?? 'N/A' }] : [] },
    { id: 'message-gen', title: 'Message Generation', icon: Mail, status: isMessaged || isReplied || isCold ? 'completed' : isLowScore ? 'skipped' : 'pending', timestamp: null, details: isLowScore ? [{ label: 'Reason', value: 'Score below threshold' }] : [] },
    { id: 'message-send', title: 'Message Send', icon: MessageSquare, status: isMessaged || isReplied || isCold ? 'completed' : isLowScore || enrichmentFailed ? 'skipped' : 'pending', timestamp: null, details: isLowScore || enrichmentFailed ? [{ label: 'Reason', value: 'No message generated' }] : [] },
    { id: 'followups', title: 'Follow-ups', icon: Clock, status: isReplied || isCold ? 'completed' : isMessaged ? 'pending' : 'skipped', timestamp: null, details: isCold ? [{ label: 'Outcome', value: 'No reply received' }] : isReplied ? [{ label: 'Outcome', value: 'Reply received' }] : [] },
    { id: 'feedback', title: 'Feedback', icon: TrendingUp, status: isReplied ? 'completed' : isMessaged || isCold ? 'pending' : 'skipped', timestamp: null, details: isReplied ? [{ label: 'Status', value: 'Reply classified' }] : [] },
  ];
}

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

const STATUS_CONFIG: Record<StageStatus, { label: string; color: string; bg: string; borderColor: string; dotColor: string }> = {
  completed: { label: 'Completed', color: 'text-zbooni-green', bg: 'bg-zbooni-green/10', borderColor: 'border-zbooni-green/30', dotColor: 'bg-zbooni-green' },
  pending: { label: 'Pending', color: 'text-zbooni-teal', bg: 'bg-zbooni-teal/10', borderColor: 'border-zbooni-teal/30', dotColor: 'bg-zbooni-teal' },
  skipped: { label: 'Skipped', color: 'text-yellow-400', bg: 'bg-yellow-400/10', borderColor: 'border-yellow-400/30', dotColor: 'bg-yellow-400' },
  failed: { label: 'Failed', color: 'text-red-400', bg: 'bg-red-400/10', borderColor: 'border-red-400/30', dotColor: 'bg-red-400' },
};

function StatusIcon({ status, className }: { status: StageStatus; className?: string | undefined }) {
  switch (status) {
    case 'completed': return <CheckCircle2 className={cn('text-zbooni-green', className)} />;
    case 'pending': return <Clock className={cn('text-zbooni-teal', className)} />;
    case 'skipped': return <AlertTriangle className={cn('text-yellow-400', className)} />;
    case 'failed': return <AlertTriangle className={cn('text-red-400', className)} />;
  }
}

function TimelineStage({ stage, isLast, index }: { stage: PipelineStage; isLast: boolean; index: number }) {
  const [expanded, setExpanded] = useState(stage.status === 'failed');
  const config = STATUS_CONFIG[stage.status];
  const Icon = stage.icon;

  return (
    <div className="timeline-entry group relative flex gap-4" style={{ animationDelay: `${index * 60}ms` }}>
      <div className="relative flex flex-col items-center">
        <div className={cn('z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 transition-colors', config.borderColor, config.bg)}>
          <Icon className={cn('h-4.5 w-4.5', config.color)} />
        </div>
        {!isLast && <div className="w-px flex-1 bg-border/40" />}
      </div>
      <div className={cn('flex-1 pb-6', isLast && 'pb-0')}>
        <button type="button" onClick={() => setExpanded(!expanded)} className="group/btn flex w-full items-center gap-3 rounded-xl text-left transition-colors hover:bg-white/[0.02]">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <h3 className="text-sm font-bold tracking-tight">{stage.title}</h3>
              <span className={cn('rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider', config.bg, config.color)}>{config.label}</span>
            </div>
            {stage.timestamp ? (
              <p className="mt-0.5 font-mono text-[11px] text-muted-foreground/50">{new Date(stage.timestamp).toLocaleString()}</p>
            ) : (
              <p className="mt-0.5 text-[11px] text-muted-foreground/30 italic">Not started</p>
            )}
          </div>
          {stage.details.length > 0 && (
            <span className="text-muted-foreground/30 transition-colors group-hover/btn:text-muted-foreground/60">
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </span>
          )}
        </button>
        {expanded && stage.details.length > 0 && (
          <div className="mt-3 space-y-1.5 rounded-xl border border-border/30 bg-slate-800 p-4">
            {stage.details.map((detail) => (
              <div key={detail.label} className="flex items-start gap-3 text-sm">
                <span className="w-40 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{detail.label}</span>
                <span className={cn('font-mono text-xs', stage.status === 'failed' && detail.label === 'Error' ? 'text-red-400' : 'text-foreground/80')}>{detail.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LeadSearchResult({ lead, isSelected, onSelect }: { lead: LeadRecord; isSelected: boolean; onSelect: () => void }) {
  const tierColor = lead.tier === 'HIGH' ? 'text-zbooni-green bg-zbooni-green/10' : lead.tier === 'MEDIUM' ? 'text-yellow-400 bg-yellow-400/10' : 'text-red-400 bg-red-400/10';
  const completedCount = lead.stages.filter((s) => s.status === 'completed').length;
  const failedCount = lead.stages.filter((s) => s.status === 'failed').length;

  return (
    <button type="button" onClick={onSelect} className={cn('w-full rounded-xl border p-4 text-left transition-all duration-200', isSelected ? 'border-zbooni-green/40 bg-zbooni-green/[0.04] shadow-[0_0_20px_rgba(123,255,107,0.06)]' : 'border-border/30 bg-zbooni-dark/20 hover:border-border/50 hover:bg-zbooni-dark/40')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold tracking-tight">{lead.name}</p>
          <p className="text-[12px] text-muted-foreground/60">{lead.company}</p>
        </div>
        <span className={cn('shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider', tierColor)}>{lead.tier}</span>
      </div>
      <div className="mt-2.5 flex items-center gap-3 text-[11px] text-muted-foreground/40">
        {lead.country ? <span className="flex items-center gap-1"><Globe className="h-3 w-3" />{lead.country}{lead.city ? ` / ${lead.city}` : ''}</span> : null}
        {lead.country ? <span className="text-muted-foreground/20">|</span> : null}
        <span className="font-mono tabular-nums">{lead.score.toFixed(3)}</span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="flex -space-x-0.5">
          {lead.stages.map((stage) => (
            <div key={stage.id} className={cn('h-1.5 w-4 first:rounded-l-full last:rounded-r-full', STATUS_CONFIG[stage.status].dotColor, stage.status === 'pending' && 'opacity-40', stage.status === 'skipped' && 'opacity-50')} />
          ))}
        </div>
        <span className="text-[10px] text-muted-foreground/30">{completedCount}/8{failedCount > 0 ? ` (${failedCount} failed)` : ''}</span>
      </div>
    </button>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  LIFECYCLE TAB CONTENT
// ══════════════════════════════════════════════════════════════════════════════

const PAGE_SIZE_OPTIONS = [8, 16, 25, 50] as const;

function LifecycleTab() {
  const { apiClient } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(8);

  const leadsQuery = useApiQuery(
    useCallback(() => apiClient.listLeads({ page: 1, pageSize: 50, includeQualityMetrics: false }), [apiClient]),
  );

  const allLeads = useMemo(() => leadsQuery.data?.items.map(mapToLeadRecord) ?? [], [leadsQuery.data]);

  const filteredLeads = useMemo(() => {
    if (!searchQuery.trim()) return allLeads;
    const q = searchQuery.toLowerCase();
    return allLeads.filter((lead) => lead.name.toLowerCase().includes(q) || lead.company.toLowerCase().includes(q) || lead.email.toLowerCase().includes(q) || lead.id.toLowerCase().includes(q));
  }, [searchQuery, allLeads]);

  const totalPages = Math.max(1, Math.ceil(filteredLeads.length / pageSize));
  const paginatedLeads = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredLeads.slice(start, start + pageSize);
  }, [filteredLeads, currentPage, pageSize]);

  // Reset to page 1 when search query or page size changes
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    setCurrentPage(1);
  }, []);

  const handlePageSizeChange = useCallback((size: number) => {
    setPageSize(size);
    setCurrentPage(1);
  }, []);

  const selectedLead = selectedLeadId ? allLeads.find((l) => l.id === selectedLeadId) ?? null : null;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zbooni-teal/10">
            <Search className="h-4 w-4 text-zbooni-teal" />
          </div>
          <div className="relative flex-1">
            <input type="text" value={searchQuery} onChange={(e) => handleSearchChange(e.target.value)} placeholder="Search by lead ID, name, company, or email..." className="w-full rounded-xl border border-border/50 bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:border-zbooni-teal/50 focus:outline-none focus:ring-1 focus:ring-zbooni-teal/30" />
          </div>
          <span className="text-[11px] text-muted-foreground/40">{leadsQuery.isLoading ? '...' : `${filteredLeads.length} lead${filteredLeads.length !== 1 ? 's' : ''}`}</span>
        </div>
      </div>

      {leadsQuery.error ? <p className="text-sm text-destructive">{leadsQuery.error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <div className="flex flex-col">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/40">Search Results</p>
          <div className="max-h-[calc(100vh-240px)] overflow-y-auto space-y-3 pr-1">
            {leadsQuery.isLoading ? (
              <div className="flex items-center gap-2 rounded-xl border border-border/30 bg-zbooni-dark/20 p-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/40" />
                <span className="text-sm text-muted-foreground/50">Loading leads...</span>
              </div>
            ) : paginatedLeads.length > 0 ? (
              paginatedLeads.map((lead) => (
                <LeadSearchResult key={lead.id} lead={lead} isSelected={selectedLeadId === lead.id} onSelect={() => setSelectedLeadId(lead.id)} />
              ))
            ) : (
              <div className="rounded-xl border border-border/30 bg-zbooni-dark/20 p-6 text-center">
                <Search className="mx-auto h-8 w-8 text-muted-foreground/20" />
                <p className="mt-2 text-sm text-muted-foreground/50">No leads match your search</p>
                <p className="mt-1 text-[11px] text-muted-foreground/30">Try a different name, company, or ID</p>
              </div>
            )}
          </div>
          {/* Pagination controls */}
          {filteredLeads.length > 0 && (
            <div className="mt-3 flex items-center justify-between border-t border-border/30 pt-3">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground/40">Show</span>
                <select
                  value={pageSize}
                  onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                  className="rounded-md border border-border/40 bg-background px-2 py-1 text-[11px] text-foreground focus:border-zbooni-teal/50 focus:outline-none"
                >
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>{size}</option>
                  ))}
                </select>
                <span className="text-[10px] text-muted-foreground/40">of {filteredLeads.length}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="rounded-md border border-border/40 bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Prev
                </button>
                <span className="px-2 text-[11px] font-medium tabular-nums text-muted-foreground/60">
                  {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="rounded-md border border-border/40 bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
          {selectedLead ? (
            <>
              <div className="mb-6 flex items-start justify-between gap-4 border-b border-border/30 pb-5">
                <div className="flex items-center gap-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800">
                    <Users className="h-5 w-5 text-zbooni-green" />
                  </div>
                  <div>
                    <h2 className="text-lg font-extrabold tracking-tight">{selectedLead.name}</h2>
                    <p className="text-[12px] text-muted-foreground/60">{selectedLead.company}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-2xl font-extrabold tabular-nums tracking-tight">{selectedLead.score.toFixed(3)}</p>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Blended Score</p>
                  </div>
                  <StatusIcon status={selectedLead.tier === 'HIGH' ? 'completed' : selectedLead.tier === 'MEDIUM' ? 'pending' : 'failed'} className="h-5 w-5" />
                </div>
              </div>

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

              <div className="mb-6 flex items-center gap-4">
                <div className="flex -space-x-0.5 flex-1">
                  {selectedLead.stages.map((stage) => (
                    <div key={stage.id} className={cn('h-2 flex-1 first:rounded-l-full last:rounded-r-full transition-all', STATUS_CONFIG[stage.status].dotColor, stage.status === 'pending' && 'opacity-30', stage.status === 'skipped' && 'opacity-40')} />
                  ))}
                </div>
                <div className="flex items-center gap-4 text-[10px]">
                  {(['completed', 'pending', 'failed', 'skipped'] as const).map((status) => {
                    const count = selectedLead.stages.filter((s) => s.status === status).length;
                    if (count === 0) return null;
                    return (
                      <span key={status} className="flex items-center gap-1.5">
                        <span className={cn('h-2 w-2 rounded-full', STATUS_CONFIG[status].dotColor)} />
                        <span className="font-semibold text-muted-foreground/50">{count} {STATUS_CONFIG[status].label.toLowerCase()}</span>
                      </span>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-0">
                {selectedLead.stages.map((stage, i) => (
                  <TimelineStage key={stage.id} stage={stage} isLast={i === selectedLead.stages.length - 1} index={i} />
                ))}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="relative">
                <div className="absolute inset-0 animate-pulse rounded-full bg-zbooni-teal/5 blur-2xl" />
                <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl border border-border/30 bg-zbooni-dark/40">
                  <Zap className="h-8 w-8 text-muted-foreground/20" />
                </div>
              </div>
              <h3 className="mt-5 text-base font-bold tracking-tight text-muted-foreground/60">No lead selected</h3>
              <p className="mt-1.5 max-w-xs text-center text-[12px] text-muted-foreground/35">Select a lead from the list to view the full pipeline trace from discovery through feedback.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  MODEL INSPECTOR TAB — types & helpers
// ══════════════════════════════════════════════════════════════════════════════

interface ModelMetricItem {
  modelVersionId: string;
  versionTag: string;
  split: string;
  evaluatedAt: string;
  auc: number;
  prAuc: number;
  precision: number;
  recall: number;
  f1: number;
  brierScore: number;
}

function MetricCard({ label, value, prevValue, icon: Icon, iconColor, prevVersionTag }: { label: string; value: number; prevValue: number | null; icon: React.ComponentType<{ className?: string | undefined }>; iconColor: string; prevVersionTag: string | null }) {
  const delta = prevValue != null ? value - prevValue : 0;
  const isPositive = delta >= 0;
  const pctChange = prevValue != null && prevValue > 0 ? Math.abs(delta / prevValue) * 100 : 0;

  return (
    <div className="group relative overflow-hidden rounded-xl border border-border/30 bg-slate-800 p-4 transition-colors hover:border-border/50">
      <div className="absolute -right-3 -top-3 opacity-[0.04] transition-opacity group-hover:opacity-[0.07]">
        <Icon className="h-20 w-20" />
      </div>
      <div className="flex items-center gap-2">
        <Icon className={cn('h-3.5 w-3.5', iconColor)} />
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">{label}</p>
      </div>
      <p className="mt-2 text-3xl font-extrabold tabular-nums tracking-tight">{value.toFixed(3)}</p>
      {prevValue != null && prevVersionTag ? (
        <div className="mt-1.5 flex items-center gap-1">
          {isPositive ? <TrendingUp className="h-3 w-3 text-zbooni-green" /> : <TrendingDown className="h-3 w-3 text-red-400" />}
          <span className={cn('text-[11px] font-semibold tabular-nums', isPositive ? 'text-zbooni-green' : 'text-red-400')}>{isPositive ? '+' : '-'}{pctChange.toFixed(1)}%</span>
          <span className="text-[10px] text-slate-400">vs {prevVersionTag}</span>
        </div>
      ) : null}
    </div>
  );
}

function SectionHeader({ icon: Icon, iconColor, title, subtitle, children }: { icon: React.ComponentType<{ className?: string | undefined }>; iconColor: string; title: string; subtitle?: string | undefined; children?: React.ReactNode | undefined }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <Icon className={cn('h-4 w-4', iconColor)} />
        <div>
          <h2 className="text-base font-bold tracking-tight">{title}</h2>
          {subtitle ? <p className="text-[11px] text-muted-foreground/50">{subtitle}</p> : null}
        </div>
      </div>
      {children}
    </div>
  );
}

function ModelStatusBadge({ status }: { status: 'active' | 'archived' | 'failed' }) {
  const config = {
    active: { label: 'Active', color: 'text-zbooni-green', bg: 'bg-zbooni-green/10', border: 'border-zbooni-green/30' },
    archived: { label: 'Archived', color: 'text-muted-foreground/60', bg: 'bg-muted/10', border: 'border-border/30' },
    failed: { label: 'Failed', color: 'text-red-400', bg: 'bg-red-400/10', border: 'border-red-400/30' },
  }[status];
  return (
    <span className={cn('rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider', config.color, config.bg, config.border)}>{config.label}</span>
  );
}

function EmptySection({ icon: Icon, title, description }: { icon: React.ComponentType<{ className?: string | undefined }>; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border/30 bg-slate-800">
        <Icon className="h-6 w-6 text-muted-foreground/20" />
      </div>
      <h3 className="mt-4 text-sm font-bold tracking-tight text-muted-foreground/60">{title}</h3>
      <p className="mt-1 max-w-xs text-[12px] text-muted-foreground/35">{description}</p>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  MODEL INSPECTOR TAB CONTENT
// ══════════════════════════════════════════════════════════════════════════════

function ModelInspectorTab() {
  const { apiClient } = useAuth();
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const metricsQuery = useApiQuery(useCallback(() => apiClient.getModelMetrics(), [apiClient]));
  const retrainQuery = useApiQuery(useCallback(() => apiClient.getRetrainStatus(), [apiClient]));

  const testMetrics = useMemo(() => {
    if (!metricsQuery.data?.items) return [];
    return metricsQuery.data.items.filter((m: ModelMetricItem) => m.split === 'TEST');
  }, [metricsQuery.data]);

  const activeModelId = retrainQuery.data?.activeModelVersionId;
  const activeMetric = testMetrics.find((m: ModelMetricItem) => m.modelVersionId === activeModelId) ?? testMetrics[0] ?? null;

  const sortedByDate = useMemo(() => [...testMetrics].sort((a: ModelMetricItem, b: ModelMetricItem) => new Date(b.evaluatedAt).getTime() - new Date(a.evaluatedAt).getTime()), [testMetrics]);
  const previousMetric = activeMetric ? sortedByDate.find((m: ModelMetricItem) => m.modelVersionId !== activeMetric.modelVersionId) ?? null : null;

  const sortedHistory = useMemo(() => [...testMetrics].sort((a: ModelMetricItem, b: ModelMetricItem) => sortDirection === 'desc' ? new Date(b.evaluatedAt).getTime() - new Date(a.evaluatedAt).getTime() : new Date(a.evaluatedAt).getTime() - new Date(b.evaluatedAt).getTime()), [testMetrics, sortDirection]);

  const isLoading = metricsQuery.isLoading || retrainQuery.isLoading;
  const hasData = testMetrics.length > 0;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />Loading model data...
      </div>
    );
  }

  if (metricsQuery.error ?? retrainQuery.error) {
    return <p className="text-sm text-destructive">{metricsQuery.error ?? retrainQuery.error}</p>;
  }

  if (!hasData) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <EmptySection icon={Brain} title="No models trained yet" description="The model inspector will display scoring model metrics, training history, and feature importance once the first model training completes." />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800">
              <Brain className="h-6 w-6 text-zbooni-green" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg font-extrabold tracking-tight">Active Model</h2>
                <ModelStatusBadge status="active" />
              </div>
              <p className="mt-0.5 text-[12px] text-muted-foreground/50">The currently promoted scoring model used for all new leads</p>
            </div>
          </div>
          {activeMetric ? (
            <div className="flex items-center gap-3 rounded-xl border border-border/20 bg-slate-800 px-4 py-3">
              <GitBranch className="h-4 w-4 text-zbooni-teal" />
              <div>
                <p className="font-mono text-sm font-bold">{activeMetric.versionTag}</p>
                <p className="text-[10px] text-slate-400">Evaluated {new Date(activeMetric.evaluatedAt).toLocaleDateString()}</p>
              </div>
            </div>
          ) : null}
        </div>

        {activeMetric ? (
          <>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border/20 bg-slate-800 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Evaluated At</p>
                <p className="mt-0.5 text-sm font-bold">{new Date(activeMetric.evaluatedAt).toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-border/20 bg-slate-800 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Model Version ID</p>
                <p className="mt-0.5 truncate font-mono text-[11px]">{activeMetric.modelVersionId}</p>
              </div>
              <div className="rounded-lg border border-border/20 bg-slate-800 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Brier Score</p>
                <p className="mt-0.5 text-xl font-extrabold tabular-nums">{activeMetric.brierScore.toFixed(4)}</p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
              <MetricCard label="AUC" value={activeMetric.auc} prevValue={previousMetric?.auc ?? null} prevVersionTag={previousMetric?.versionTag ?? null} icon={Target} iconColor="text-zbooni-teal" />
              <MetricCard label="PR-AUC" value={activeMetric.prAuc} prevValue={previousMetric?.prAuc ?? null} prevVersionTag={previousMetric?.versionTag ?? null} icon={Gauge} iconColor="text-zbooni-green" />
              <MetricCard label="F1 Score" value={activeMetric.f1} prevValue={previousMetric?.f1 ?? null} prevVersionTag={previousMetric?.versionTag ?? null} icon={BarChart3} iconColor="text-purple-400" />
              <MetricCard label="Precision" value={activeMetric.precision} prevValue={previousMetric?.precision ?? null} prevVersionTag={previousMetric?.versionTag ?? null} icon={CheckCircle2} iconColor="text-yellow-400" />
              <MetricCard label="Recall" value={activeMetric.recall} prevValue={previousMetric?.recall ?? null} prevVersionTag={previousMetric?.versionTag ?? null} icon={Zap} iconColor="text-orange-400" />
            </div>
          </>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
          <SectionHeader icon={BarChart3} iconColor="text-zbooni-green" title="Feature Importance" subtitle="Feature weights from the trained model coefficients" />
          <EmptySection icon={Layers} title="Available after model training" description="Feature importance weights will be displayed here once a scoring model has been trained with coefficient data." />
        </div>

        <div className="space-y-4">
          {activeMetric && previousMetric ? (
            <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
              <SectionHeader icon={Activity} iconColor="text-zbooni-teal" title="Version Comparison" subtitle={`${activeMetric.versionTag} vs ${previousMetric.versionTag}`} />
              <div className="space-y-3">
                {([
                  { label: 'AUC', current: activeMetric.auc, previous: previousMetric.auc },
                  { label: 'PR-AUC', current: activeMetric.prAuc, previous: previousMetric.prAuc },
                  { label: 'F1', current: activeMetric.f1, previous: previousMetric.f1 },
                  { label: 'Precision', current: activeMetric.precision, previous: previousMetric.precision },
                  { label: 'Recall', current: activeMetric.recall, previous: previousMetric.recall },
                ] as const).map((metric) => {
                  const delta = metric.current - metric.previous;
                  const isPositive = delta > 0;
                  return (
                    <div key={metric.label} className="flex items-center gap-3">
                      <span className="w-16 text-[11px] font-semibold text-muted-foreground/50">{metric.label}</span>
                      <div className="flex flex-1 items-center gap-2">
                        <span className="w-14 text-right font-mono text-xs text-slate-400">{metric.previous.toFixed(3)}</span>
                        <div className="flex items-center justify-center">
                          {isPositive ? <TrendingUp className="h-3 w-3 text-zbooni-green" /> : <TrendingDown className="h-3 w-3 text-red-400" />}
                        </div>
                        <span className="w-14 font-mono text-xs font-bold">{metric.current.toFixed(3)}</span>
                        <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums', isPositive ? 'bg-zbooni-green/10 text-zbooni-green' : 'bg-red-400/10 text-red-400')}>{isPositive ? '+' : ''}{delta.toFixed(3)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {retrainQuery.data ? (
            <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
              <SectionHeader icon={Cpu} iconColor="text-purple-400" title="Retrain Status" />
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground/60">Active Model</span>
                  <span className="font-mono text-xs font-bold">{retrainQuery.data.activeModelVersionId ?? 'None'}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground/60">Current Run</span>
                  <span className="text-xs font-bold">{retrainQuery.data.currentRun?.status ?? 'Idle'}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground/60">Next Scheduled</span>
                  <span className="text-xs">{retrainQuery.data.nextScheduledAt ? new Date(retrainQuery.data.nextScheduledAt).toLocaleString() : 'Not scheduled'}</span>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {sortedHistory.length > 0 ? (
        <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
          <SectionHeader icon={Cpu} iconColor="text-zbooni-teal" title="Evaluation History" subtitle="All model versions with test-split performance metrics">
            <button type="button" onClick={() => setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc')} className="flex items-center gap-1.5 rounded-lg border border-border/30 bg-slate-800 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground/60 transition-colors hover:text-foreground">
              Date {sortDirection === 'desc' ? 'newest' : 'oldest'}
              {sortDirection === 'desc' ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
            </button>
          </SectionHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                  <th className="py-2.5 pr-4">Version</th>
                  <th className="py-2.5 pr-4">Status</th>
                  <th className="py-2.5 pr-4 text-right">AUC</th>
                  <th className="py-2.5 pr-4 text-right">F1</th>
                  <th className="py-2.5 pr-4 text-right">Precision</th>
                  <th className="py-2.5 pr-4 text-right">Recall</th>
                  <th className="py-2.5 pr-4 text-right">Brier</th>
                  <th className="py-2.5">Evaluated</th>
                </tr>
              </thead>
              <tbody>
                {sortedHistory.map((version: ModelMetricItem) => {
                  const isActive = version.modelVersionId === activeModelId;
                  return (
                    <tr key={`${version.modelVersionId}-${version.split}`} className={cn('border-b border-border/20 last:border-0 transition-colors', isActive && 'bg-zbooni-green/[0.02]')}>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-bold">{version.versionTag}</span>
                          {isActive && <div className="h-2 w-2 rounded-full bg-zbooni-green animate-pulse" />}
                        </div>
                      </td>
                      <td className="py-3 pr-4"><ModelStatusBadge status={isActive ? 'active' : 'archived'} /></td>
                      <td className="py-3 pr-4 text-right font-mono text-xs tabular-nums">{version.auc.toFixed(3)}</td>
                      <td className="py-3 pr-4 text-right font-mono text-xs tabular-nums">{version.f1.toFixed(3)}</td>
                      <td className="py-3 pr-4 text-right font-mono text-xs tabular-nums">{version.precision.toFixed(3)}</td>
                      <td className="py-3 pr-4 text-right font-mono text-xs tabular-nums">{version.recall.toFixed(3)}</td>
                      <td className="py-3 pr-4 text-right font-mono text-xs tabular-nums">{version.brierScore.toFixed(4)}</td>
                      <td className="py-3 text-xs text-muted-foreground/60">{new Date(version.evaluatedAt).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  FEEDBACK TAB — helpers
// ══════════════════════════════════════════════════════════════════════════════

const CLASSIFICATION_CONFIG = [
  { key: 'replied', label: 'Replied', color: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/25', Icon: ThumbsUp },
  { key: 'meetingBooked', label: 'Meeting Booked', color: 'text-zbooni-teal', bg: 'bg-zbooni-teal/15', border: 'border-zbooni-teal/25', Icon: CalendarCheck },
  { key: 'dealWon', label: 'Deal Won', color: 'text-zbooni-green', bg: 'bg-zbooni-green/15', border: 'border-zbooni-green/25', Icon: ThumbsUp },
  { key: 'dealLost', label: 'Deal Lost', color: 'text-red-400', bg: 'bg-red-500/15', border: 'border-red-500/25', Icon: ThumbsDown },
  { key: 'unsubscribed', label: 'Unsubscribed', color: 'text-slate-400', bg: 'bg-slate-500/15', border: 'border-slate-500/25', Icon: Unplug },
  { key: 'bounced', label: 'Bounced', color: 'text-slate-500', bg: 'bg-slate-600/15', border: 'border-slate-600/25', Icon: AlertTriangle },
] as const;

const EVENT_TYPE_LABELS: Record<string, { className: string; label: string }> = {
  REPLIED: { className: 'bg-emerald-500/15 text-emerald-400', label: 'Replied' },
  MEETING_BOOKED: { className: 'bg-zbooni-teal/15 text-zbooni-teal', label: 'Meeting Booked' },
  DEAL_WON: { className: 'bg-zbooni-green/15 text-zbooni-green', label: 'Deal Won' },
  DEAL_LOST: { className: 'bg-red-500/15 text-red-400', label: 'Deal Lost' },
  UNSUBSCRIBED: { className: 'bg-slate-500/15 text-slate-400', label: 'Unsubscribed' },
  BOUNCED: { className: 'bg-slate-600/15 text-slate-500', label: 'Bounced' },
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('en-AE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function conversionRate(from: number, to: number): string {
  if (from === 0) return '0%';
  return `${((to / from) * 100).toFixed(1)}%`;
}

// ══════════════════════════════════════════════════════════════════════════════
//  FEEDBACK TAB CONTENT
// ══════════════════════════════════════════════════════════════════════════════

function FeedbackTab() {
  const { apiClient } = useAuth();
  const [hoveredStage, setHoveredStage] = useState<number | null>(null);

  const feedbackSummary = useApiQuery(useCallback(() => apiClient.getFeedbackSummary(), [apiClient]));
  const funnelQuery = useApiQuery(useCallback(() => apiClient.getFunnel(), [apiClient]));
  const recentEvents = useApiQuery(useCallback(() => apiClient.listFeedbackEvents({ page: 1, pageSize: 20 }), [apiClient]));

  const isLoading = feedbackSummary.isLoading || funnelQuery.isLoading;
  const summary = feedbackSummary.data;
  const funnelData = funnelQuery.data;

  const classificationCounts: Record<string, number> = summary ? {
    replied: summary.repliedCount,
    meetingBooked: summary.meetingBookedCount,
    dealWon: summary.dealWonCount,
    dealLost: summary.dealLostCount,
    unsubscribed: summary.unsubscribedCount,
    bounced: summary.bouncedCount,
  } : {};

  const totalResponses = summary?.totalEvents ?? 0;

  const funnelStages = funnelData ? [
    { label: 'Messaged', value: funnelData.messagesSentCount, color: 'from-zbooni-teal/80 to-zbooni-teal/40' },
    { label: 'Replied', value: funnelData.repliesCount, color: 'from-blue-500/80 to-blue-500/40' },
    ...(summary ? [
      { label: 'Meeting Booked', value: summary.meetingBookedCount, color: 'from-zbooni-green/80 to-zbooni-green/40' },
      { label: 'Deal Won', value: summary.dealWonCount, color: 'from-amber-400/80 to-amber-400/40' },
    ] : []),
  ] : [];

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />Loading feedback data...
      </div>
    );
  }

  if (feedbackSummary.error) {
    return <p className="text-sm text-destructive">{feedbackSummary.error}</p>;
  }

  return (
    <div className="space-y-4">
      {/* Reply Classification Breakdown */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <MessageSquareReply className="h-5 w-5 text-zbooni-teal" />
          <div>
            <h2 className="text-base font-bold tracking-tight">Reply Classification Breakdown</h2>
            <p className="text-[11px] text-muted-foreground/50">Feedback distribution across {totalResponses} total events.</p>
          </div>
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))' }}>
          {CLASSIFICATION_CONFIG.map((item) => {
            const count = classificationCounts[item.key] ?? 0;
            return (
              <div key={item.key} className={cn('rounded-xl border p-4 transition-colors duration-200', item.bg, item.border)}>
                <div className="flex items-center gap-2">
                  <item.Icon className={cn('h-4 w-4', item.color)} />
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{item.label}</span>
                </div>
                <p className={cn('mt-2 text-3xl font-extrabold tabular-nums tracking-tight', item.color)}>{count}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Conversion Funnel */}
      {funnelStages.length > 0 ? (
        <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <TrendingDown className="h-5 w-5 text-zbooni-green rotate-180" />
            <div>
              <h2 className="text-base font-bold tracking-tight">Conversion Funnel</h2>
              <p className="text-[11px] text-muted-foreground/50">End-to-end pipeline throughput from first message to deal close.</p>
            </div>
          </div>
          <div className="mt-2 space-y-1">
            {funnelStages.map((stage, idx) => {
              const maxValue = funnelStages[0]?.value ?? 1;
              const widthPercent = maxValue > 0 ? Math.max(12, (stage.value / maxValue) * 100) : 12;
              const nextStage = funnelStages[idx + 1] as typeof funnelStages[number] | undefined;
              const rate = nextStage ? conversionRate(stage.value, nextStage.value) : null;
              const isHovered = hoveredStage === idx;
              return (
                <div key={stage.label} className="group">
                  <div className="flex items-center gap-4" onMouseEnter={() => setHoveredStage(idx)} onMouseLeave={() => setHoveredStage(null)}>
                    <span className="w-32 shrink-0 text-right text-sm font-medium text-muted-foreground">{stage.label}</span>
                    <div className="relative flex-1">
                      <div className={cn('relative h-10 rounded-lg bg-gradient-to-r transition-all duration-300', stage.color, isHovered ? 'opacity-100 shadow-lg' : 'opacity-80')} style={{ width: `${widthPercent}%` }}>
                        <span className="absolute inset-0 flex items-center px-3 text-sm font-bold text-white drop-shadow-sm">{stage.value}</span>
                      </div>
                    </div>
                  </div>
                  {rate !== null ? (
                    <div className="ml-32 flex items-center gap-2 py-0.5 pl-4">
                      <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
                      <span className="font-mono text-xs text-muted-foreground">{rate} conversion</span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          {funnelStages.length >= 2 ? (
            <div className="mt-4 flex flex-wrap gap-6 rounded-xl border border-border/50 bg-slate-800 px-4 py-3">
              <div>
                <span className="text-xs text-muted-foreground">Overall conversion</span>
                <p className="text-sm font-bold text-zbooni-green">{conversionRate(funnelStages[0]!.value, funnelStages[funnelStages.length - 1]!.value)}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Reply rate</span>
                <p className="text-sm font-bold text-zbooni-teal">{conversionRate(funnelStages[0]!.value, funnelStages[1]!.value)}</p>
              </div>
              {funnelStages.length >= 3 ? (
                <div>
                  <span className="text-xs text-muted-foreground">Meeting rate</span>
                  <p className="text-sm font-bold text-emerald-400">{conversionRate(funnelStages[1]!.value, funnelStages[2]!.value)}</p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Training Labels Summary */}
      {summary ? (
        <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Tag className="h-5 w-5 text-zbooni-teal" />
            <div>
              <h2 className="text-base font-bold tracking-tight">Training Labels Summary</h2>
              <p className="text-[11px] text-muted-foreground/50">Feedback signals collected for model retraining.</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-xl border border-border/30 bg-zbooni-dark/40 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Total Events</p>
              <p className="mt-1 text-2xl font-extrabold tracking-tight text-zbooni-teal">{summary.totalEvents}</p>
            </div>
            <div className="rounded-xl border border-border/30 bg-zbooni-dark/40 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Positive Signals</p>
              <p className="mt-1 text-2xl font-extrabold tracking-tight text-emerald-400">{summary.repliedCount + summary.meetingBookedCount + summary.dealWonCount}</p>
              <p className="mt-0.5 text-xs text-muted-foreground/50">replied, meeting, deal won</p>
            </div>
            <div className="rounded-xl border border-border/30 bg-zbooni-dark/40 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Negative Signals</p>
              <p className="mt-1 text-2xl font-extrabold tracking-tight text-red-400">{summary.dealLostCount + summary.unsubscribedCount + summary.bouncedCount}</p>
              <p className="mt-0.5 text-xs text-muted-foreground/50">deal lost, bounced, unsubscribed</p>
            </div>
          </div>
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <Sparkles className="h-4 w-4 text-zbooni-green" />Label collection progress
              </span>
              <span className="font-mono text-sm font-bold text-muted-foreground">{summary.totalEvents} total labels</span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800 border border-border/50">
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, (summary.totalEvents / Math.max(summary.totalEvents, 50)) * 100)}%`, background: 'linear-gradient(90deg, #3CC8E0 0%, #7BFF6B 100%)' }} />
            </div>
          </div>
        </div>
      ) : null}

      {/* Recent Feedback Events */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="mb-4">
          <h2 className="text-base font-bold tracking-tight">Recent Feedback Events</h2>
          <p className="text-[11px] text-muted-foreground/50">Latest reply classifications and pipeline feedback signals.</p>
        </div>
        {recentEvents.isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />Loading events...
          </div>
        ) : recentEvents.data && recentEvents.data.items.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                  <th className="py-2.5 pr-4">Lead ID</th>
                  <th className="py-2.5 pr-4">Event Type</th>
                  <th className="py-2.5 pr-4">Source</th>
                  <th className="py-2.5 pr-4">Occurred At</th>
                  <th className="py-2.5">Classification</th>
                </tr>
              </thead>
              <tbody>
                {recentEvents.data.items.map((event) => {
                  const pill = EVENT_TYPE_LABELS[event.eventType] ?? { className: 'bg-slate-700/40 text-slate-300', label: event.eventType };
                  return (
                    <tr key={event.id} className="border-b border-border/20 last:border-0">
                      <td className="py-3 pr-4 font-mono text-xs">{event.leadId.slice(0, 16)}...</td>
                      <td className="py-3 pr-4 font-mono text-xs">{event.eventType}</td>
                      <td className="py-3 pr-4">
                        <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold', event.source === 'WEBHOOK' ? 'bg-emerald-500/15 text-emerald-400' : event.source === 'MANUAL' ? 'bg-blue-500/15 text-blue-400' : 'bg-slate-500/15 text-slate-400')}>{event.source}</span>
                      </td>
                      <td className="py-3 pr-4 text-xs text-muted-foreground/60">{formatTime(event.occurredAt)}</td>
                      <td className="py-3">
                        <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold', pill.className)}>{pill.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center py-8 text-center">
            <Clock className="h-8 w-8 text-muted-foreground/20" />
            <p className="mt-2 text-sm text-muted-foreground/50">No feedback events yet</p>
            <p className="mt-1 text-[11px] text-muted-foreground/30">Events will appear here once leads receive replies and feedback is classified.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  MAIN PAGE — Pipeline Debug with tabs
// ══════════════════════════════════════════════════════════════════════════════

export default function PipelineDebugPage() {
  const [activeTab, setActiveTab] = useState<TabId>('lifecycle');

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex items-center gap-1 rounded-xl border border-border/50 bg-card p-1 shadow-sm">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={cn(
              'flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all duration-200',
              activeTab === id
                ? 'bg-zbooni-teal/15 text-zbooni-teal shadow-sm'
                : 'text-muted-foreground hover:bg-muted/10 hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'lifecycle' && <LifecycleTab />}
      {activeTab === 'model' && <ModelInspectorTab />}
      {activeTab === 'feedback' && <FeedbackTab />}
    </div>
  );
}
