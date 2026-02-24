'use client';

import {
  ArrowLeft,
  Brain,
  Building2,
  Clock,
  Cpu,
  Database,
  ExternalLink,
  Globe,
  Hash,
  Linkedin,
  Mail,
  MapPin,
  MessageSquare,
  Pencil,
  Phone,
  Search,
  Send,
  User,
  Users,
  Briefcase,
  AlertCircle,
  TrendingUp,
} from 'lucide-react';
import type { GetLeadResponse, MessageSendResponse } from '@lead-flood/contracts';
import { useParams, useRouter } from 'next/navigation';
import { useCallback } from 'react';

import { LeadStatusBadge } from '../../../../src/components/lead-status-badge.js';
import { ScoreBandBadge } from '../../../../src/components/score-band-badge.js';
import { useApiQuery } from '../../../../src/hooks/use-api-query.js';
import { useAuth } from '../../../../src/hooks/use-auth.js';

interface EnrichmentField {
  label: string;
  value: string | number | null | undefined;
  icon: React.ComponentType<{ className?: string }>;
  href?: string | undefined;
}

interface ScoreInfo {
  blendedScore?: number | undefined;
  scoreBand?: string | undefined;
  reasoning?: string[] | undefined;
}

function extractEnrichmentFields(data: unknown): EnrichmentField[] {
  if (!data || typeof data !== 'object') return [];
  const d = data as Record<string, unknown>;
  const fields: EnrichmentField[] = [];

  if (d.email) fields.push({ label: 'Email', value: String(d.email), icon: Mail, href: `mailto:${d.email}` });
  if (d.phone || d.mobile_phone || d.phone_number)
    fields.push({ label: 'Phone', value: String(d.phone ?? d.mobile_phone ?? d.phone_number), icon: Phone, href: `tel:${d.phone ?? d.mobile_phone ?? d.phone_number}` });
  if (d.linkedinUrl || d.linkedin_url || d.linkedin)
    fields.push({ label: 'LinkedIn', value: String(d.linkedinUrl ?? d.linkedin_url ?? d.linkedin), icon: Linkedin, href: String(d.linkedinUrl ?? d.linkedin_url ?? d.linkedin) });
  if (d.companyName || d.company_name || d.organization_name)
    fields.push({ label: 'Company', value: String(d.companyName ?? d.company_name ?? d.organization_name), icon: Building2 });
  if (d.industry)
    fields.push({ label: 'Industry', value: String(d.industry), icon: Briefcase });
  if (d.title || d.job_title || d.position)
    fields.push({ label: 'Position', value: String(d.title ?? d.job_title ?? d.position), icon: User });
  if (d.country)
    fields.push({ label: 'Country', value: String(d.country), icon: MapPin });
  if (d.city)
    fields.push({ label: 'City', value: String(d.city), icon: MapPin });
  if (d.employeeCount || d.employee_count || d.company_size)
    fields.push({ label: 'Company Size', value: String(d.employeeCount ?? d.employee_count ?? d.company_size), icon: Users });
  if (d.domain || d.website)
    fields.push({ label: 'Website', value: String(d.domain ?? d.website), icon: Globe, href: `https://${String(d.domain ?? d.website).replace(/^https?:\/\//, '')}` });
  if (d.avgDealSize)
    fields.push({ label: 'Avg Deal Size', value: String(d.avgDealSize), icon: TrendingUp });
  if (d.whatsappUsage)
    fields.push({ label: 'WhatsApp Usage', value: String(d.whatsappUsage), icon: Phone });

  return fields;
}

function extractScoreInfo(data: unknown): ScoreInfo | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const info = d._scoreInfo;
  if (!info || typeof info !== 'object') return null;
  const s = info as Record<string, unknown>;
  return {
    blendedScore: typeof s.blendedScore === 'number' ? s.blendedScore : undefined,
    scoreBand: typeof s.scoreBand === 'string' ? s.scoreBand : undefined,
    reasoning: Array.isArray(s.reasoning) ? (s.reasoning as string[]) : undefined,
  };
}

function extractRawDetails(data: unknown): Array<{ key: string; value: string }> {
  if (!data || typeof data !== 'object') return [];
  const d = data as Record<string, unknown>;
  const skipKeys = new Set([
    'email', 'phone', 'mobile_phone', 'phone_number', 'linkedinUrl', 'linkedin_url', 'linkedin',
    'companyName', 'company_name', 'organization_name', 'industry', 'title', 'job_title', 'position',
    'country', 'city', 'employeeCount', 'employee_count', 'company_size', 'domain', 'website',
    'avgDealSize', 'whatsappUsage', '_scoreInfo', 'seasonalPeaks', 'internationalGuests',
    'medicalTourism', 'cohortModel', 'paymentMethod',
  ]);

  return Object.entries(d)
    .filter(([key, val]) => !skipKeys.has(key) && val !== null && val !== undefined && val !== '')
    .map(([key, val]) => ({
      key: key.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim(),
      value: typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val),
    }));
}

// ── Activity Timeline ──────────────────────────────────────────

/** Status progression for determining which pipeline stages are reached. */
const STATUS_ORDER = ['new', 'processing', 'enriched', 'failed', 'messaged', 'replied', 'cold'] as const;

function statusReached(current: string, target: string): boolean {
  // "failed" and "cold" are terminal — they don't imply later stages
  if (current === 'failed' || current === 'cold') {
    const ci = STATUS_ORDER.indexOf(current as (typeof STATUS_ORDER)[number]);
    const ti = STATUS_ORDER.indexOf(target as (typeof STATUS_ORDER)[number]);
    return ti >= 0 && ci >= 0 && ti <= ci;
  }
  const ci = STATUS_ORDER.indexOf(current as (typeof STATUS_ORDER)[number]);
  const ti = STATUS_ORDER.indexOf(target as (typeof STATUS_ORDER)[number]);
  if (ci < 0 || ti < 0) return false;
  return ci >= ti;
}

interface TimelineEvent {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  detail: string;
  time: string;
  timestamp: number;
  /** Tailwind classes for the icon node: text color + background. */
  color: string;
  /** Optional score badge to render inline. */
  scoreBadge?: { value: number; band: string } | undefined;
}

function buildTimeline(
  lead: GetLeadResponse,
  sends: MessageSendResponse[],
  scoreInfo: ScoreInfo | null,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const createdTs = new Date(lead.createdAt).getTime();

  // 1. Created — always present
  events.push({
    icon: Search,
    label: 'Lead Created',
    detail: `Discovered via ${lead.source.replace(/_/g, ' ')}`,
    time: new Date(lead.createdAt).toLocaleString(),
    timestamp: createdTs,
    color: 'text-blue-400 bg-blue-500/15 ring-blue-500/25',
  });

  // 2. Enriched — when status is enriched or later
  if (statusReached(lead.status, 'enriched')) {
    // Enrichment happens shortly after creation; offset timestamp so it sorts after
    const enrichedTs = createdTs + 1000;
    events.push({
      icon: Database,
      label: 'Data Enriched',
      detail: 'Contact and company data enriched from external sources',
      time: new Date(lead.updatedAt).toLocaleString(),
      timestamp: enrichedTs,
      color: 'text-teal-400 bg-teal-500/15 ring-teal-500/25',
    });
  }

  // 3. Features Computed — when status reached enriched (features are part of enrichment pipeline)
  if (statusReached(lead.status, 'enriched') && lead.enrichmentData) {
    const featuresTs = createdTs + 2000;
    events.push({
      icon: Cpu,
      label: 'Features Computed',
      detail: 'Lead signals extracted and feature vectors calculated',
      time: new Date(lead.updatedAt).toLocaleString(),
      timestamp: featuresTs,
      color: 'text-purple-400 bg-purple-500/15 ring-purple-500/25',
    });
  }

  // 4. Scored — when scoreInfo exists
  if (scoreInfo?.blendedScore !== undefined) {
    const scoreVal = Math.round(scoreInfo.blendedScore * 100);
    const scoredTs = createdTs + 3000;
    const band = scoreInfo.scoreBand ?? 'LOW';
    const bandColor =
      band === 'HIGH'
        ? 'text-zbooni-green bg-zbooni-green/15 ring-zbooni-green/25'
        : band === 'MEDIUM'
          ? 'text-yellow-400 bg-yellow-500/15 ring-yellow-500/25'
          : 'text-orange-400 bg-orange-500/15 ring-orange-500/25';

    events.push({
      icon: TrendingUp,
      label: 'Lead Scored',
      detail: `Score band: ${band}`,
      time: new Date(lead.updatedAt).toLocaleString(),
      timestamp: scoredTs,
      color: bandColor,
      scoreBadge: { value: scoreVal, band },
    });
  }

  // 5. Message Generated — inferred when sends exist (draft was generated before sending)
  if (sends.length > 0) {
    const firstSendTs = new Date(sends[sends.length - 1]?.sentAt ?? sends[sends.length - 1]?.createdAt ?? lead.updatedAt).getTime();
    events.push({
      icon: Pencil,
      label: 'Message Drafted',
      detail: 'AI-generated outreach message prepared for review',
      time: new Date(firstSendTs - 1000).toLocaleString(),
      timestamp: firstSendTs - 1000,
      color: 'text-indigo-400 bg-indigo-500/15 ring-indigo-500/25',
    });
  }

  // 6. Message Sent events — from sends
  for (const send of sends) {
    const sendTs = new Date(send.sentAt ?? send.createdAt).getTime();
    const isFailed = send.status === 'FAILED' || send.status === 'BOUNCED';
    const followUp = send.followUpNumber && send.followUpNumber > 0 ? ` (follow-up #${send.followUpNumber})` : '';
    events.push({
      icon: isFailed ? AlertCircle : Send,
      label: isFailed
        ? `${send.channel} Send Failed`
        : `${send.channel} ${send.status === 'QUEUED' ? 'Queued' : 'Sent'}`,
      detail: `Via ${send.provider}${followUp}${send.failureReason ? ` — ${send.failureReason}` : ''}`,
      time: new Date(send.sentAt ?? send.createdAt).toLocaleString(),
      timestamp: sendTs,
      color: isFailed
        ? 'text-red-400 bg-red-500/15 ring-red-500/25'
        : 'text-zbooni-green bg-zbooni-green/15 ring-zbooni-green/25',
    });

    // 7. Reply Received
    if (send.status === 'REPLIED' && send.repliedAt) {
      const repliedTs = new Date(send.repliedAt).getTime();
      events.push({
        icon: MessageSquare,
        label: 'Reply Received',
        detail: 'Prospect responded — view full conversation in Inbox',
        time: new Date(send.repliedAt).toLocaleString(),
        timestamp: repliedTs,
        color: 'text-emerald-400 bg-emerald-500/15 ring-emerald-500/25',
      });
    }
  }

  // 8. Error — if lead has error
  if (lead.error) {
    const errorTs = new Date(lead.updatedAt).getTime();
    events.push({
      icon: AlertCircle,
      label: 'Pipeline Error',
      detail: lead.error,
      time: new Date(lead.updatedAt).toLocaleString(),
      timestamp: errorTs,
      color: 'text-red-400 bg-red-500/15 ring-red-500/25',
    });
  }

  return events.sort((a, b) => a.timestamp - b.timestamp);
}

function ActivityTimeline({
  lead,
  sends,
  scoreInfo,
}: {
  lead: GetLeadResponse;
  sends: MessageSendResponse[];
  scoreInfo: ScoreInfo | null;
}) {
  const events = buildTimeline(lead, sends, scoreInfo);

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-muted-foreground/40">
        <Clock className="h-8 w-8" />
        <p className="text-sm">No activity recorded yet.</p>
      </div>
    );
  }

  return (
    <div className="relative ml-2">
      {/* Vertical connecting line */}
      <div className="absolute left-[17px] top-5 bottom-5 w-px bg-gradient-to-b from-border/60 via-border/30 to-transparent" />

      <div className="space-y-1">
        {events.map((event, i) => {
          const Icon = event.icon;
          return (
            <div
              key={`${event.label}:${event.timestamp}:${i}`}
              className="timeline-entry relative flex items-start gap-4 py-2"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              {/* Node */}
              <div
                className={`relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1 ${event.color}`}
              >
                <Icon className="h-4 w-4" />
              </div>

              {/* Event card */}
              <div className="min-w-0 flex-1 rounded-xl border border-border/30 bg-zbooni-dark/30 p-3 transition-colors hover:border-border/50 hover:bg-zbooni-dark/50">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{event.label}</p>
                  <span className="shrink-0 text-[11px] text-muted-foreground/50">{event.time}</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <p className="text-xs text-muted-foreground/70">{event.detail}</p>
                  {event.scoreBadge ? (
                    <span
                      className={`ml-auto inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${
                        event.scoreBadge.band === 'HIGH'
                          ? 'bg-zbooni-green/20 text-zbooni-green'
                          : event.scoreBadge.band === 'MEDIUM'
                            ? 'bg-yellow-500/20 text-yellow-400'
                            : 'bg-orange-500/20 text-orange-400'
                      }`}
                    >
                      {event.scoreBadge.value}%
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { apiClient } = useAuth();
  const router = useRouter();

  const lead = useApiQuery(
    useCallback(() => apiClient.getLead(id), [apiClient, id]),
    [id],
  );

  const sends = useApiQuery(
    useCallback(() => apiClient.listSends({ leadId: id, page: 1, pageSize: 50 }), [apiClient, id]),
    [id],
  );

  if (lead.error) {
    return <p className="text-sm text-destructive">{lead.error}</p>;
  }

  if (lead.isLoading || !lead.data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
        Loading lead...
      </div>
    );
  }

  const l = lead.data;
  const enrichmentFields = extractEnrichmentFields(l.enrichmentData);
  const scoreInfo = extractScoreInfo(l.enrichmentData);
  const additionalDetails = extractRawDetails(l.enrichmentData);

  const scorePercent = scoreInfo?.blendedScore ? Math.round(scoreInfo.blendedScore * 100) : null;

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() => router.back()}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to leads
      </button>

      {/* Header */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">
              {l.firstName} {l.lastName}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{l.email}</p>
          </div>
          <div className="flex items-center gap-2">
            <LeadStatusBadge status={l.status} />
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">Source</p>
            <p className="mt-0.5 font-medium">{l.source.replace(/_/g, ' ')}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">Created</p>
            <p className="mt-0.5 font-medium">{new Date(l.createdAt).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">Updated</p>
            <p className="mt-0.5 font-medium">{new Date(l.updatedAt).toLocaleString()}</p>
          </div>
          {/* Score in bottom-right of header */}
          {scoreInfo?.scoreBand ? (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">Lead Score</p>
              <div className="mt-1 flex items-center gap-2">
                <ScoreBandBadge band={scoreInfo.scoreBand as 'HIGH' | 'MEDIUM' | 'LOW'} />
                {scorePercent !== null ? (
                  <span className="text-lg font-bold tabular-nums tracking-tight">{scorePercent}%</span>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        {l.error ? (
          <div className="mt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">Error</p>
            <p className="mt-0.5 font-medium text-destructive">{l.error}</p>
          </div>
        ) : null}
      </div>

      {/* Score Reasoning */}
      {scoreInfo?.reasoning && scoreInfo.reasoning.length > 0 ? (
        <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-base font-bold tracking-tight flex items-center gap-2">
            <Brain className="h-4 w-4 text-zbooni-teal" />
            Score Reasoning
            {scorePercent !== null ? (
              <span className={`ml-auto inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                scoreInfo.scoreBand === 'HIGH' ? 'bg-zbooni-green/15 text-zbooni-green'
                  : scoreInfo.scoreBand === 'MEDIUM' ? 'bg-yellow-500/15 text-yellow-400'
                  : 'bg-red-500/15 text-red-400'
              }`}>
                {scorePercent}% — {scoreInfo.scoreBand}
              </span>
            ) : null}
          </h2>
          <div className="space-y-2">
            {scoreInfo.reasoning.map((reason, i) => (
              <div
                key={i}
                className="flex items-start gap-3 rounded-lg border border-border/20 bg-zbooni-dark/30 px-3.5 py-2.5"
              >
                <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                  i < 2 ? 'bg-zbooni-green/20 text-zbooni-green' : 'bg-zbooni-teal/15 text-zbooni-teal'
                }`}>
                  {i + 1}
                </div>
                <p className="text-sm text-muted-foreground">{reason}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Contact & Company Details */}
      {enrichmentFields.length > 0 ? (
        <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-base font-bold tracking-tight flex items-center gap-2">
            <User className="h-4 w-4 text-zbooni-teal" />
            Contact & Company Details
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {enrichmentFields.map((field) => {
              const Icon = field.icon;
              return (
                <div
                  key={field.label}
                  className="flex items-start gap-3 rounded-xl border border-border/30 bg-zbooni-dark/40 p-3.5"
                >
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zbooni-teal/10">
                    <Icon className="h-4 w-4 text-zbooni-teal" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                      {field.label}
                    </p>
                    {field.href ? (
                      <a
                        href={field.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-0.5 flex items-center gap-1 text-sm font-medium text-zbooni-teal transition-colors hover:text-zbooni-green"
                      >
                        <span className="truncate">{field.value}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    ) : (
                      <p className="mt-0.5 truncate text-sm font-medium">{field.value}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Additional Enrichment Details */}
      {additionalDetails.length > 0 ? (
        <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-base font-bold tracking-tight flex items-center gap-2">
            <Hash className="h-4 w-4 text-zbooni-green" />
            Additional Details
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {additionalDetails.map((detail) => (
              <div
                key={detail.key}
                className="flex items-start gap-3 rounded-lg border border-border/20 bg-zbooni-dark/30 px-3.5 py-2.5"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50 min-w-[100px]">
                  {detail.key}
                </p>
                <p className="text-sm text-muted-foreground break-all">
                  {detail.value.length > 200 ? detail.value.slice(0, 200) + '...' : detail.value}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* No enrichment data at all */}
      {!l.enrichmentData ? (
        <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
          <div className="flex items-center gap-3 text-muted-foreground/60">
            <AlertCircle className="h-5 w-5" />
            <p className="text-sm">No enrichment data available yet. This lead may still be processing.</p>
          </div>
        </div>
      ) : null}

      {/* Activity Timeline */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-base font-bold tracking-tight flex items-center gap-2">
          <Clock className="h-4 w-4 text-zbooni-teal" />
          Activity Timeline
        </h2>
        <ActivityTimeline
          lead={l}
          sends={sends.data?.items ?? []}
          scoreInfo={scoreInfo}
        />
      </div>

      {/* Message History */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-base font-bold tracking-tight flex items-center gap-2">
          <Mail className="h-4 w-4 text-zbooni-green" />
          Message History
        </h2>

        {sends.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
            Loading messages...
          </div>
        ) : null}

        {!sends.isLoading && sends.data?.items.length === 0 ? (
          <p className="text-sm text-muted-foreground/60">No messages sent yet.</p>
        ) : null}

        <div className="space-y-0">
          {sends.data?.items.map((send) => (
            <div key={send.id} className="border-b border-border/30 py-3 last:border-0">
              <div className="flex items-center gap-3">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                    send.status === 'SENT' || send.status === 'DELIVERED'
                      ? 'bg-zbooni-green/15 text-zbooni-green'
                      : send.status === 'FAILED' || send.status === 'BOUNCED'
                        ? 'bg-red-500/15 text-red-400'
                        : send.status === 'REPLIED'
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : 'bg-yellow-500/15 text-yellow-400'
                  }`}
                >
                  {send.status}
                </span>
                <span className="text-xs text-muted-foreground">
                  {send.channel} via {send.provider}
                </span>
                {send.sentAt ? (
                  <span className="text-xs text-muted-foreground/60">
                    {new Date(send.sentAt).toLocaleString()}
                  </span>
                ) : null}
              </div>
              {send.failureReason ? (
                <p className="mt-1 text-xs text-destructive">{send.failureReason}</p>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
