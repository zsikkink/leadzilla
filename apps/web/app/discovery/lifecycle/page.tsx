'use client';

import { useState, useMemo } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Globe,
  Layers,
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

// ── Placeholder data ────────────────────────────────────────────────────────

const PLACEHOLDER_LEADS: LeadRecord[] = [
  {
    id: 'lead_01HQXR9KFMV3PZ8YNWT2AG6D5E',
    name: 'Abdullah Al-Rashid',
    company: 'Premium Foods LLC',
    email: 'abdullah@premiumfoods.ae',
    country: 'AE',
    city: 'Dubai',
    industry: 'Food & Beverage',
    score: 0.847,
    tier: 'HIGH',
    stages: [
      {
        id: 'discovery',
        title: 'Discovery',
        icon: Radar,
        status: 'completed',
        timestamp: '2026-02-18T08:12:34Z',
        details: [
          { label: 'Source', value: 'Google Maps Local' },
          { label: 'Provider', value: 'SerpAPI' },
          { label: 'Search Query', value: 'food delivery Dubai premium' },
          { label: 'Evidence Count', value: '4 sources found' },
          { label: 'Task Bucket', value: '2026-W08:default' },
        ],
      },
      {
        id: 'enrichment',
        title: 'Enrichment',
        icon: Layers,
        status: 'completed',
        timestamp: '2026-02-18T08:14:07Z',
        details: [
          { label: 'Provider', value: 'Apollo + PDL' },
          { label: 'Records Found', value: '3 (Apollo: 2, PDL: 1)' },
          { label: 'Email Verified', value: 'Yes (confidence: 0.94)' },
          { label: 'Phone Found', value: '+971-50-XXX-XXXX' },
          { label: 'LinkedIn URL', value: 'linkedin.com/in/abdullah-alrashid' },
          { label: 'Data Quality', value: '87% completeness' },
        ],
      },
      {
        id: 'features',
        title: 'Feature Computation',
        icon: Sparkles,
        status: 'completed',
        timestamp: '2026-02-18T08:14:22Z',
        details: [
          { label: 'Features Computed', value: '24 of 24' },
          { label: 'Has WhatsApp', value: 'Yes' },
          { label: 'Has Instagram', value: 'Yes (12.4k followers)' },
          { label: 'Review Count', value: '847 (Google Maps)' },
          { label: 'Accepts Online Payments', value: 'Yes' },
          { label: 'Recently Active', value: 'Yes (last 7 days)' },
          { label: 'Website Tech Stack', value: 'Shopify, Google Analytics' },
        ],
      },
      {
        id: 'scoring',
        title: 'Scoring',
        icon: Target,
        status: 'completed',
        timestamp: '2026-02-18T08:14:28Z',
        details: [
          { label: 'Deterministic Score', value: '0.812' },
          { label: 'AI Model Score', value: '0.883' },
          { label: 'Blended Score', value: '0.847' },
          { label: 'Score Tier', value: 'HIGH' },
          { label: 'Model Version', value: 'v2.3.1-2026-02-15' },
          { label: 'Top Signal', value: 'review_count (weight: 0.18)' },
        ],
      },
      {
        id: 'message-gen',
        title: 'Message Generation',
        icon: Mail,
        status: 'completed',
        timestamp: '2026-02-18T08:15:01Z',
        details: [
          { label: 'ICP Match', value: 'Segment C: Food & Beverage' },
          { label: 'Template', value: 'WhatsApp Intro - F&B Personalized' },
          { label: 'Variants Generated', value: '2 (A/B test)' },
          { label: 'Tone', value: 'Professional, Arabic-friendly' },
          { label: 'Personalization', value: 'Company name, review count, Instagram' },
          { label: 'Approval', value: 'Auto-approved (score > 0.8)' },
        ],
      },
      {
        id: 'message-send',
        title: 'Message Send',
        icon: MessageSquare,
        status: 'completed',
        timestamp: '2026-02-18T09:00:12Z',
        details: [
          { label: 'Channel', value: 'WhatsApp (Trengo)' },
          { label: 'Status', value: 'Delivered' },
          { label: 'Variant Sent', value: 'B (personalized opener)' },
          { label: 'Trengo Contact ID', value: 'trengo_c_48291' },
          { label: 'Delivery Time', value: '< 3 seconds' },
          { label: 'Session Window', value: '24h from delivery' },
        ],
      },
      {
        id: 'followups',
        title: 'Follow-ups',
        icon: Clock,
        status: 'completed',
        timestamp: '2026-02-21T09:00:00Z',
        details: [
          { label: 'Follow-up Count', value: '1 of 3 max' },
          { label: 'Last Follow-up', value: '2026-02-21 09:00 UTC' },
          { label: 'Next Scheduled', value: 'Cancelled (reply received)' },
          { label: 'Follow-up Strategy', value: '72h interval, escalating urgency' },
        ],
      },
      {
        id: 'feedback',
        title: 'Feedback',
        icon: TrendingUp,
        status: 'completed',
        timestamp: '2026-02-21T14:23:45Z',
        details: [
          { label: 'Reply Received', value: 'Yes' },
          { label: 'Reply Classification', value: 'INTERESTED' },
          { label: 'Sentiment', value: 'Positive (0.91)' },
          { label: 'Label', value: 'meeting_requested' },
          { label: 'Sales Notified', value: 'Yes (Slack + Email)' },
          { label: 'Outcome', value: 'Meeting booked - 2026-02-24' },
        ],
      },
    ],
  },
  {
    id: 'lead_01HQXR9KFMV3PZ8YNWT2AG7F8K',
    name: 'Sara Mahmoud',
    company: 'Bloom Boutique',
    email: 'sara@bloomboutique.sa',
    country: 'SA',
    city: 'Riyadh',
    industry: 'Fashion & Retail',
    score: 0.623,
    tier: 'MEDIUM',
    stages: [
      {
        id: 'discovery',
        title: 'Discovery',
        icon: Radar,
        status: 'completed',
        timestamp: '2026-02-19T11:30:00Z',
        details: [
          { label: 'Source', value: 'Google Search Local' },
          { label: 'Provider', value: 'SerpAPI' },
          { label: 'Search Query', value: 'boutique fashion Riyadh online' },
          { label: 'Evidence Count', value: '2 sources found' },
        ],
      },
      {
        id: 'enrichment',
        title: 'Enrichment',
        icon: Layers,
        status: 'completed',
        timestamp: '2026-02-19T11:31:14Z',
        details: [
          { label: 'Provider', value: 'Hunter' },
          { label: 'Records Found', value: '1 (email only)' },
          { label: 'Data Quality', value: '54% completeness' },
        ],
      },
      {
        id: 'features',
        title: 'Feature Computation',
        icon: Sparkles,
        status: 'completed',
        timestamp: '2026-02-19T11:31:28Z',
        details: [
          { label: 'Features Computed', value: '18 of 24' },
          { label: 'Has WhatsApp', value: 'No' },
          { label: 'Has Instagram', value: 'Yes (3.2k followers)' },
          { label: 'Review Count', value: '124' },
        ],
      },
      {
        id: 'scoring',
        title: 'Scoring',
        icon: Target,
        status: 'completed',
        timestamp: '2026-02-19T11:31:35Z',
        details: [
          { label: 'Deterministic Score', value: '0.590' },
          { label: 'AI Model Score', value: '0.656' },
          { label: 'Blended Score', value: '0.623' },
          { label: 'Score Tier', value: 'MEDIUM' },
        ],
      },
      {
        id: 'message-gen',
        title: 'Message Generation',
        icon: Mail,
        status: 'completed',
        timestamp: '2026-02-19T11:32:10Z',
        details: [
          { label: 'ICP Match', value: 'Segment E: Retail' },
          { label: 'Template', value: 'Email Intro - Retail' },
          { label: 'Variants Generated', value: '2' },
          { label: 'Approval', value: 'Pending manual review' },
        ],
      },
      {
        id: 'message-send',
        title: 'Message Send',
        icon: MessageSquare,
        status: 'pending',
        timestamp: null,
        details: [
          { label: 'Channel', value: 'Email (Resend)' },
          { label: 'Status', value: 'Awaiting approval' },
        ],
      },
      {
        id: 'followups',
        title: 'Follow-ups',
        icon: Clock,
        status: 'pending',
        timestamp: null,
        details: [],
      },
      {
        id: 'feedback',
        title: 'Feedback',
        icon: TrendingUp,
        status: 'pending',
        timestamp: null,
        details: [],
      },
    ],
  },
  {
    id: 'lead_01HQXR9KFMV3PZ8YNWT2AG9J2M',
    name: 'Omar Khalil',
    company: 'GreenTech Solutions',
    email: 'omar@greentech.jo',
    country: 'JO',
    city: 'Amman',
    industry: 'Technology',
    score: 0.312,
    tier: 'LOW',
    stages: [
      {
        id: 'discovery',
        title: 'Discovery',
        icon: Radar,
        status: 'completed',
        timestamp: '2026-02-20T06:45:00Z',
        details: [
          { label: 'Source', value: 'Google Search' },
          { label: 'Provider', value: 'SerpAPI' },
          { label: 'Evidence Count', value: '1 source found' },
        ],
      },
      {
        id: 'enrichment',
        title: 'Enrichment',
        icon: Layers,
        status: 'failed',
        timestamp: '2026-02-20T06:46:12Z',
        details: [
          { label: 'Provider', value: 'Apollo' },
          { label: 'Error', value: '403 Forbidden - Rate limit exceeded' },
          { label: 'Retries', value: '3 of 3 exhausted' },
          { label: 'Fallback', value: 'PDL attempted, no match found' },
        ],
      },
      {
        id: 'features',
        title: 'Feature Computation',
        icon: Sparkles,
        status: 'completed',
        timestamp: '2026-02-20T06:47:01Z',
        details: [
          { label: 'Features Computed', value: '8 of 24 (partial)' },
          { label: 'Data Quality', value: 'Low - enrichment failed' },
        ],
      },
      {
        id: 'scoring',
        title: 'Scoring',
        icon: Target,
        status: 'completed',
        timestamp: '2026-02-20T06:47:08Z',
        details: [
          { label: 'Deterministic Score', value: '0.312' },
          { label: 'AI Model Score', value: 'Skipped (insufficient features)' },
          { label: 'Blended Score', value: '0.312' },
          { label: 'Score Tier', value: 'LOW' },
        ],
      },
      {
        id: 'message-gen',
        title: 'Message Generation',
        icon: Mail,
        status: 'skipped',
        timestamp: null,
        details: [
          { label: 'Reason', value: 'Score below threshold (0.50)' },
        ],
      },
      {
        id: 'message-send',
        title: 'Message Send',
        icon: MessageSquare,
        status: 'skipped',
        timestamp: null,
        details: [
          { label: 'Reason', value: 'No message generated' },
        ],
      },
      {
        id: 'followups',
        title: 'Follow-ups',
        icon: Clock,
        status: 'skipped',
        timestamp: null,
        details: [],
      },
      {
        id: 'feedback',
        title: 'Feedback',
        icon: TrendingUp,
        status: 'skipped',
        timestamp: null,
        details: [],
      },
    ],
  },
];

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
                {new Date(stage.timestamp).toLocaleString()}
              </p>
            ) : (
              <p className="mt-0.5 text-[11px] text-muted-foreground/30 italic">
                Not started
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
          <div className="mt-3 space-y-1.5 rounded-xl border border-border/30 bg-zbooni-dark/30 p-4">
            {stage.details.map((detail) => (
              <div key={detail.label} className="flex items-start gap-3 text-sm">
                <span className="w-40 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/40">
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
        <span className="flex items-center gap-1">
          <Globe className="h-3 w-3" />
          {lead.country} / {lead.city}
        </span>
        <span className="text-muted-foreground/20">|</span>
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
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  const filteredLeads = useMemo(() => {
    if (!searchQuery.trim()) return PLACEHOLDER_LEADS;
    const q = searchQuery.toLowerCase();
    return PLACEHOLDER_LEADS.filter(
      (lead) =>
        lead.name.toLowerCase().includes(q) ||
        lead.company.toLowerCase().includes(q) ||
        lead.email.toLowerCase().includes(q) ||
        lead.id.toLowerCase().includes(q),
    );
  }, [searchQuery]);

  const selectedLead = selectedLeadId
    ? PLACEHOLDER_LEADS.find((l) => l.id === selectedLeadId) ?? null
    : null;

  return (
    <div className="space-y-4">
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
            {filteredLeads.length} lead{filteredLeads.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* ── Main layout: search results + timeline ──────────────────── */}
      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        {/* Left: Search results */}
        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/40">
            Search Results
          </p>
          {filteredLeads.length > 0 ? (
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
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-zbooni-green/20 to-zbooni-teal/20">
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
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
                      Blended Score
                    </p>
                  </div>
                  <StatusIcon status={selectedLead.tier === 'HIGH' ? 'completed' : selectedLead.tier === 'MEDIUM' ? 'pending' : 'failed'} className="h-5 w-5" />
                </div>
              </div>

              {/* Lead metadata row */}
              <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-border/20 bg-zbooni-dark/20 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">Country</p>
                  <p className="mt-0.5 text-sm font-bold">{selectedLead.country} / {selectedLead.city}</p>
                </div>
                <div className="rounded-lg border border-border/20 bg-zbooni-dark/20 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">Industry</p>
                  <p className="mt-0.5 text-sm font-bold">{selectedLead.industry}</p>
                </div>
                <div className="rounded-lg border border-border/20 bg-zbooni-dark/20 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">Email</p>
                  <p className="mt-0.5 truncate font-mono text-xs">{selectedLead.email}</p>
                </div>
                <div className="rounded-lg border border-border/20 bg-zbooni-dark/20 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">Lead ID</p>
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
                Search for a lead by name, company, email, or ID and select it to view the full pipeline trace from discovery through feedback.
              </p>
              <div className="mt-6 flex items-center gap-2 rounded-lg border border-border/20 bg-zbooni-dark/20 px-4 py-2.5 text-[11px] text-muted-foreground/40">
                <Search className="h-3.5 w-3.5" />
                Try searching &ldquo;Abdullah&rdquo; or &ldquo;Premium Foods&rdquo;
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
