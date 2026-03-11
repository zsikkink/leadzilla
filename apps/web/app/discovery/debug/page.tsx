'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Cpu,
  Database,
  Gauge,
  GitBranch,
  Globe,
  Layers,
  Loader2,
  Mail,
  MessageSquare,
  Radar,
  Search,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react';

import { cn } from '@/lib/utils.js';
import { useAuth } from '@/hooks/use-auth.js';
import { useApiQuery } from '@/hooks/use-api-query.js';
import { getSupabaseBrowserClient } from '@/lib/supabase-client.js';
import { EnrichedStageContent } from '@/components/debug/stage-renderers.js';
import { fetchLeadLifecycleData } from '@/components/debug/lifecycle-data.js';
import type { LeadLifecycleData } from '@/components/debug/lifecycle-data.js';

// ══════════════════════════════════════════════════════════════════════════════
//  TAB NAVIGATION
// ══════════════════════════════════════════════════════════════════════════════

type TabId = 'lifecycle' | 'model';

const TABS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string | undefined }> }[] = [
  { id: 'lifecycle', label: 'Lead Lifecycle', icon: Search },
  { id: 'model', label: 'Model Inspector', icon: Brain },
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
  hasEnrichedContent?: boolean | undefined;
}

interface PipelineCategory {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string | undefined }>;
  stages: PipelineStage[];
  status: StageStatus;
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
  categories: PipelineCategory[];
}

const STATUS_PROGRESSION: Record<string, number> = {
  new: 0,
  processing: 1,
  enriched: 2,
  scored: 3,
  qualified: 3,
  rejected: -2,
  failed: -1,
  messaged: 4,
  drafted: 4,
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
  businessCountryCode?: string | null | undefined;
  businessCountry?: string | null | undefined;
  businessCity?: string | null | undefined;
  businessCategory?: string | null | undefined;
}

function buildPipelineStages(lead: LeadItem): PipelineStage[] {
  const enrichment = lead.latestEnrichmentNormalizedPayload as Record<string, unknown> | null;
  const rawEnrichment = lead.latestEnrichmentRawPayload as Record<string, unknown> | null;
  const hasEnrichment = enrichment !== null || rawEnrichment !== null;
  const hasScore = lead.latestBlendedScore !== null && lead.latestBlendedScore !== undefined;
  const statusLevel = STATUS_PROGRESSION[lead.status] ?? 0;
  const isFailed = lead.status === 'failed';
  const isRejected = lead.status === 'rejected';
  const isMessaged = statusLevel >= 4;
  const isReplied = lead.status === 'replied';
  const isCold = lead.status === 'cold';
  const isLowScore = lead.latestScoreBand === 'LOW';
  const isBelowThreshold = isLowScore || isRejected;
  const enrichmentFailed = isFailed && !hasEnrichment;
  const enrichmentSkipped = !hasEnrichment && hasScore && isLowScore;

  const qualificationCompleted = hasScore || hasEnrichment || statusLevel >= 2;
  const qualificationStatus: StageStatus = enrichmentFailed ? 'failed' : qualificationCompleted ? 'completed' : 'pending';

  // Discovery details — basic info; enriched content loaded via EnrichedStageContent
  const discoveryDetails: StageDetail[] = [
    { label: 'Source', value: lead.source },
    { label: 'Lead ID', value: lead.id },
  ];

  // Country/industry from Business record fallback
  const country = extractField(lead, 'country') || extractField(lead, 'countryCode');
  const industry = extractField(lead, 'industry') || extractField(lead, 'category');

  // Pre-qualification hard filter results
  const prequalDetails: StageDetail[] = [];
  if (country) prequalDetails.push({ label: 'Country in supported regions', value: `${country} -- Passed` });
  const hasEmail = lead.email && lead.email.includes('@');
  prequalDetails.push({ label: 'Has email contact', value: hasEmail ? 'Yes -- Passed' : 'No data' });
  const alignmentScore = enrichment?.data_alignment_score as number | undefined;
  if (alignmentScore !== undefined) {
    prequalDetails.push({ label: 'Data alignment score', value: `${alignmentScore.toFixed(2)} -- ${alignmentScore >= 0.3 ? 'Passed' : 'Below threshold'}` });
  }
  if (industry) prequalDetails.push({ label: 'Industry match', value: `${industry} -- Passed` });

  // Enrichment — now loaded via EnrichedStageContent, summary details only
  const enrichmentDetails: StageDetail[] = [];
  if (enrichmentFailed && lead.error) {
    enrichmentDetails.push({ label: 'Error', value: lead.error });
  }

  // Enrichment status
  const enrichmentStatus: StageStatus = enrichmentFailed ? 'failed'
    : hasEnrichment ? 'completed'
    : enrichmentSkipped ? 'skipped'
    : qualificationCompleted ? 'completed'
    : 'pending';
  const enrichmentSkippedDetails: StageDetail[] = enrichmentSkipped
    ? [{ label: 'Reason', value: 'Skipped -- score below threshold' }]
    : enrichmentDetails;

  // Downstream skipping for below-threshold / rejected leads
  const skipReason = isRejected ? 'Skipped -- lead rejected' : 'Skipped -- score below threshold';
  const downstreamSkipped = isBelowThreshold && !isMessaged && !isReplied && !isCold;

  return [
    { id: 'discovery', title: 'Discovery', icon: Radar, status: 'completed', timestamp: lead.createdAt, details: discoveryDetails, hasEnrichedContent: true },
    { id: 'prequalification', title: 'Pre-qualification', icon: Layers, status: qualificationStatus, timestamp: qualificationCompleted ? lead.updatedAt : null, details: prequalDetails },
    { id: 'enrichment', title: 'Enrichment', icon: Globe, status: enrichmentStatus, timestamp: hasEnrichment ? lead.updatedAt : null, details: enrichmentSkippedDetails, hasEnrichedContent: true },
    { id: 'conversion', title: 'Business Conversion', icon: Database, status: hasEnrichment || statusLevel >= 2 ? 'completed' : enrichmentFailed ? 'failed' : 'pending', timestamp: hasEnrichment ? lead.updatedAt : null, details: [], hasEnrichedContent: true },
    { id: 'features', title: 'Feature Computation', icon: Sparkles, status: hasScore ? 'completed' : enrichmentFailed ? 'skipped' : 'pending', timestamp: hasScore ? lead.updatedAt : null, details: [], hasEnrichedContent: true },
    { id: 'scoring', title: 'Scoring', icon: Target, status: hasScore ? 'completed' : enrichmentFailed ? 'skipped' : 'pending', timestamp: hasScore ? lead.updatedAt : null, details: isRejected ? [{ label: 'Outcome', value: 'Lead rejected' }] : [], hasEnrichedContent: true },
    { id: 'message-gen', title: 'Message Generation', icon: Mail, status: isMessaged || isReplied || isCold ? 'completed' : downstreamSkipped ? 'skipped' : 'pending', timestamp: null, details: downstreamSkipped ? [{ label: 'Reason', value: skipReason }] : [], hasEnrichedContent: true },
    { id: 'message-send', title: 'Message Send', icon: MessageSquare, status: isMessaged || isReplied || isCold ? 'completed' : downstreamSkipped ? 'skipped' : 'pending', timestamp: null, details: downstreamSkipped ? [{ label: 'Reason', value: skipReason }] : [], hasEnrichedContent: true },
    { id: 'followups', title: 'Follow-ups', icon: Clock, status: isReplied || isCold ? 'completed' : downstreamSkipped ? 'skipped' : isMessaged ? 'pending' : 'pending', timestamp: null, details: downstreamSkipped ? [{ label: 'Reason', value: skipReason }] : isCold ? [{ label: 'Outcome', value: 'No reply received' }] : isReplied ? [{ label: 'Outcome', value: 'Reply received' }] : [], hasEnrichedContent: true },
    { id: 'feedback', title: 'Feedback / Learning', icon: TrendingUp, status: isReplied ? 'completed' : downstreamSkipped ? 'skipped' : isCold ? 'pending' : isMessaged ? 'pending' : 'pending', timestamp: null, details: downstreamSkipped ? [{ label: 'Reason', value: skipReason }] : [], hasEnrichedContent: true },
  ];
}

function deriveCategoryStatus(stages: PipelineStage[]): StageStatus {
  if (stages.some((s) => s.status === 'failed')) return 'failed';
  if (stages.every((s) => s.status === 'completed')) return 'completed';
  if (stages.every((s) => s.status === 'skipped')) return 'skipped';
  if (stages.some((s) => s.status === 'completed')) return 'pending';
  return 'pending';
}

function buildPipelineCategories(stages: PipelineStage[]): PipelineCategory[] {
  const byId = Object.fromEntries(stages.map((s) => [s.id, s]));
  const groups: { id: string; title: string; icon: React.ComponentType<{ className?: string | undefined }>; stageIds: string[] }[] = [
    { id: 'discovery', title: 'Discovery', icon: Radar, stageIds: ['discovery'] },
    { id: 'qualification', title: 'Pre-qualification', icon: Layers, stageIds: ['prequalification'] },
    { id: 'enrichment', title: 'Enrichment & Conversion', icon: Globe, stageIds: ['enrichment', 'conversion'] },
    { id: 'intelligence', title: 'Intelligence / Scoring', icon: Sparkles, stageIds: ['features', 'scoring'] },
    { id: 'outreach', title: 'Outreach', icon: MessageSquare, stageIds: ['message-gen', 'message-send', 'followups'] },
    { id: 'learning', title: 'Learning Loops', icon: TrendingUp, stageIds: ['feedback'] },
  ];
  return groups.map((g) => {
    const groupStages = g.stageIds.map((sid) => byId[sid]).filter((s): s is PipelineStage => s != null);
    return { id: g.id, title: g.title, icon: g.icon, stages: groupStages, status: deriveCategoryStatus(groupStages) };
  });
}

function extractField(item: LeadItem, field: string): string {
  const enrichment = item.latestEnrichmentNormalizedPayload as Record<string, unknown> | null;
  const rawEnrichment = item.latestEnrichmentRawPayload as Record<string, unknown> | null;
  const discovery = item.latestDiscoveryRawPayload as Record<string, unknown> | null;
  return (enrichment?.[field] as string)
    ?? (rawEnrichment?.[field] as string)
    ?? (discovery?.[field] as string)
    ?? '';
}

function mapToLeadRecord(item: LeadItem): LeadRecord {
  const enrichment = item.latestEnrichmentNormalizedPayload as Record<string, unknown> | null;
  return {
    id: item.id,
    name: `${item.firstName} ${item.lastName}`,
    company: (enrichment?.companyName as string) ?? '',
    email: item.email,
    country: extractField(item, 'country') || extractField(item, 'countryCode') || item.businessCountry || item.businessCountryCode || '',
    city: extractField(item, 'city') || item.businessCity || '',
    industry: extractField(item, 'industry') || extractField(item, 'category') || item.businessCategory || '',
    score: item.latestBlendedScore ?? 0,
    tier: item.latestScoreBand ?? 'LOW',
    stages: buildPipelineStages(item),
    categories: buildPipelineCategories(buildPipelineStages(item)),
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

function TimelineStage({
  stage,
  isLast,
  index,
  enrichedData,
}: {
  stage: PipelineStage;
  isLast: boolean;
  index: number;
  enrichedData: LeadLifecycleData | null;
}) {
  const [expanded, setExpanded] = useState(stage.status === 'failed');
  const config = STATUS_CONFIG[stage.status];
  const Icon = stage.icon;
  const hasContent = stage.details.length > 0 || stage.hasEnrichedContent;

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
          {hasContent && (
            <span className="text-muted-foreground/30 transition-colors group-hover/btn:text-muted-foreground/60">
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </span>
          )}
        </button>
        {expanded && hasContent && (
          <div className="mt-3 space-y-3 rounded-xl border border-border/30 bg-slate-800 p-4">
            {/* Static details from pipeline stage */}
            {stage.details.length > 0 && (
              <div className="space-y-1.5">
                {stage.details.map((detail) => (
                  <div key={detail.label} className="flex items-start gap-3 text-sm">
                    <span className="w-44 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{detail.label}</span>
                    <span className={cn('font-mono text-xs', stage.status === 'failed' && detail.label === 'Error' ? 'text-red-400' : 'text-foreground/80')}>{detail.value}</span>
                  </div>
                ))}
              </div>
            )}
            {/* Enriched content from Supabase */}
            {stage.hasEnrichedContent && (
              <EnrichedStageContent stageId={stage.id} data={enrichedData} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CategorySection({
  category,
  index,
  enrichedData,
}: {
  category: PipelineCategory;
  index: number;
  enrichedData: LeadLifecycleData | null;
}) {
  const [expanded, setExpanded] = useState(category.status === 'failed');
  const config = STATUS_CONFIG[category.status];
  const Icon = category.icon;
  const completedCount = category.stages.filter((s) => s.status === 'completed').length;

  return (
    <div className="rounded-xl border border-border/30 bg-zbooni-dark/20 overflow-hidden" style={{ animationDelay: `${index * 80}ms` }}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.02]"
      >
        <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border', config.borderColor, config.bg)}>
          <Icon className={cn('h-4 w-4', config.color)} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold tracking-tight">{category.title}</h3>
            <span className={cn('rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider', config.bg, config.color)}>
              {config.label}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground/40">
            {completedCount}/{category.stages.length} stage{category.stages.length !== 1 ? 's' : ''} completed
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex -space-x-0.5">
            {category.stages.map((s) => (
              <div key={s.id} className={cn('h-1.5 w-5 first:rounded-l-full last:rounded-r-full', STATUS_CONFIG[s.status].dotColor, s.status === 'pending' && 'opacity-40', s.status === 'skipped' && 'opacity-50')} />
            ))}
          </div>
          <span className="text-muted-foreground/30">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border/20 px-4 py-3 space-y-0">
          {category.stages.map((stage, i) => (
            <TimelineStage
              key={stage.id}
              stage={stage}
              isLast={i === category.stages.length - 1}
              index={i}
              enrichedData={enrichedData}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LeadSearchResult({ lead, isSelected, onSelect }: { lead: LeadRecord; isSelected: boolean; onSelect: () => void }) {
  const tierColor = lead.tier === 'HIGH' ? 'text-zbooni-green bg-zbooni-green/10' : lead.tier === 'MEDIUM' ? 'text-yellow-400 bg-yellow-400/10' : 'text-red-400 bg-red-400/10';
  const completedCount = lead.categories.filter((c) => c.status === 'completed').length;
  const failedCount = lead.categories.filter((c) => c.status === 'failed').length;

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
          {lead.categories.map((cat) => (
            <div key={cat.id} className={cn('h-1.5 w-5 first:rounded-l-full last:rounded-r-full', STATUS_CONFIG[cat.status].dotColor, cat.status === 'pending' && 'opacity-40', cat.status === 'skipped' && 'opacity-50')} />
          ))}
        </div>
        <span className="text-[10px] text-muted-foreground/30">{completedCount}/{lead.categories.length}{failedCount > 0 ? ` (${failedCount} failed)` : ''}</span>
      </div>
    </button>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  LIFECYCLE TAB — hook for enriched data loading
// ══════════════════════════════════════════════════════════════════════════════

function useLeadLifecycleData(leadId: string | null): {
  data: LeadLifecycleData | null;
  isLoading: boolean;
  error: string | null;
} {
  const [data, setData] = useState<LeadLifecycleData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leadId) {
      setData(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const supabase = getSupabaseBrowserClient();
    fetchLeadLifecycleData(supabase, leadId)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setIsLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load lifecycle data');
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [leadId]);

  return { data, isLoading, error };
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

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    setCurrentPage(1);
  }, []);

  const handlePageSizeChange = useCallback((size: number) => {
    setPageSize(size);
    setCurrentPage(1);
  }, []);

  const selectedLead = selectedLeadId ? allLeads.find((l) => l.id === selectedLeadId) ?? null : null;

  // Fetch enriched lifecycle data for selected lead
  const lifecycleData = useLeadLifecycleData(selectedLeadId);

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

              <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-border/20 bg-slate-800 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Country</p>
                  <p className="mt-0.5 text-sm font-bold">{selectedLead.country || 'N/A'}{selectedLead.city ? ` / ${selectedLead.city}` : ''}</p>
                </div>
                <div className="rounded-lg border border-border/20 bg-slate-800 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Industry</p>
                  <p className="mt-0.5 text-sm font-bold">{selectedLead.industry || 'N/A'}</p>
                </div>
                <div className="rounded-lg border border-border/20 bg-slate-800 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Lead ID</p>
                  <p className="mt-0.5 truncate font-mono text-[10px]">{selectedLead.id}</p>
                </div>
              </div>

              <div className="mb-6 flex items-center gap-4">
                <div className="flex -space-x-0.5 flex-1">
                  {selectedLead.categories.map((cat) => (
                    <div key={cat.id} className={cn('h-2 flex-1 first:rounded-l-full last:rounded-r-full transition-all', STATUS_CONFIG[cat.status].dotColor, cat.status === 'pending' && 'opacity-30', cat.status === 'skipped' && 'opacity-40')} />
                  ))}
                </div>
                <div className="flex items-center gap-4 text-[10px]">
                  {(['completed', 'pending', 'failed', 'skipped'] as const).map((status) => {
                    const count = selectedLead.categories.filter((c) => c.status === status).length;
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

              {/* Loading indicator for enriched data */}
              {lifecycleData.isLoading && (
                <div className="mb-4 flex items-center gap-2 rounded-lg border border-zbooni-teal/20 bg-zbooni-teal/[0.03] px-4 py-2.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-zbooni-teal" />
                  <span className="text-[11px] text-zbooni-teal/80">Loading enriched pipeline data...</span>
                </div>
              )}
              {lifecycleData.error && (
                <div className="mb-4 rounded-lg border border-red-400/20 bg-red-400/[0.03] px-4 py-2.5">
                  <span className="text-[11px] text-red-400/80">Enriched data unavailable: {lifecycleData.error}</span>
                </div>
              )}

              <div className="space-y-3">
                {selectedLead.categories.map((category, i) => (
                  <CategorySection
                    key={category.id}
                    category={category}
                    index={i}
                    enrichedData={lifecycleData.data}
                  />
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
    </div>
  );
}
