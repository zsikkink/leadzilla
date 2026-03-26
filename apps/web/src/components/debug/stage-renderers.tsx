'use client';

import { useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Mail,
  XCircle,
} from 'lucide-react';

import { cn } from '@/lib/utils.js';

import type {
  BusinessConversionData,
  CategoryScoreData,
  FeedbackEventData,
  FeatureSnapshotData,
  InstagramScrapeData,
  LeadLifecycleData,
  MessageDraftData,
  MessageSendData,
  RuleEvaluation,
  SearchTaskData,
  ScoringData,
  WebsiteScrapeData,
} from './lifecycle-data.js';

// ══════════════════════════════════════════════════════════════════════════════
//  Shared components
// ══════════════════════════════════════════════════════════════════════════════

function DataRow({ label, value, mono }: { label: string; value: string; mono?: boolean | undefined }) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <span className="w-44 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</span>
      <span className={cn('text-xs text-foreground/80', mono && 'font-mono')}>{value}</span>
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-zbooni-teal/80">{title}</h4>
  );
}

function Collapsible({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean | undefined; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div className="rounded-lg border border-border/20 bg-slate-800/50">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        {open ? <ChevronDown className="h-3 w-3 text-muted-foreground/40" /> : <ChevronRight className="h-3 w-3 text-muted-foreground/40" />}
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300">{title}</span>
      </button>
      {open && <div className="border-t border-border/20 px-3 py-3">{children}</div>}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="py-2 text-[11px] italic text-muted-foreground/40">{text}</p>;
}

// ══════════════════════════════════════════════════════════════════════════════
//  C1: Discovery stage — Search query
// ══════════════════════════════════════════════════════════════════════════════

export function DiscoveryStageDetails({ searchTask }: { searchTask: SearchTaskData | null }) {
  if (!searchTask) {
    return <EmptyState text="Search data not available" />;
  }

  const providerLabel = searchTask.provider === 'SERPAPI' || searchTask.provider === 'SERP_MAPS_LOCAL'
    ? 'Google Places (via SerpAPI)'
    : searchTask.provider === 'GOOGLE_PLACES'
      ? 'Google Places'
      : searchTask.provider;

  return (
    <div className="space-y-1.5">
      <DataRow label="Search Query" value={searchTask.queryText} />
      <DataRow label="Provider" value={providerLabel} />
      {searchTask.city && <DataRow label="Target City" value={searchTask.city} />}
      {searchTask.category && <DataRow label="Category" value={searchTask.category} />}
      <DataRow label="Task Status" value={searchTask.status} />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  C2: Enrichment stage — Website + Instagram scrape
// ══════════════════════════════════════════════════════════════════════════════

function WebsiteScrapeSection({ data }: { data: WebsiteScrapeData }) {
  return (
    <div className="space-y-1.5">
      <SectionTitle title="Website Scrape" />
      {data.pageTitle && <DataRow label="Page Title" value={data.pageTitle} />}
      {data.description && <DataRow label="Description" value={data.description.length > 200 ? data.description.slice(0, 200) + '...' : data.description} />}
      {data.aboutPageText && <DataRow label="About Summary" value={data.aboutPageText.length > 300 ? data.aboutPageText.slice(0, 300) + '...' : data.aboutPageText} />}
      {data.socialLinks.length > 0 && (
        <div className="flex items-start gap-3 text-sm">
          <span className="w-44 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Social Links</span>
          <div className="flex flex-wrap gap-1.5">
            {data.socialLinks.map((link) => (
              <a
                key={`${link.platform}-${link.url}`}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md bg-slate-700/50 px-2 py-0.5 text-[10px] font-medium text-zbooni-teal hover:bg-slate-700"
              >
                {link.platform}
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            ))}
          </div>
        </div>
      )}
      {data.techStack.length > 0 && (
        <div className="flex items-start gap-3 text-sm">
          <span className="w-44 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Tech Stack</span>
          <div className="flex flex-wrap gap-1">
            {data.techStack.map((tech) => (
              <span key={tech} className="rounded-md bg-purple-500/10 px-2 py-0.5 text-[10px] font-medium text-purple-400">{tech}</span>
            ))}
          </div>
        </div>
      )}
      {data.emails.length > 0 && <DataRow label="Emails Found" value={data.emails.join(', ')} mono />}
      {data.phones.length > 0 && <DataRow label="Phones Found" value={data.phones.join(', ')} mono />}
      {!data.pageTitle && !data.description && !data.aboutPageText && data.socialLinks.length === 0 && data.techStack.length === 0 && (
        <EmptyState text="No significant website data extracted" />
      )}
    </div>
  );
}

function InstagramScrapeSection({ data }: { data: InstagramScrapeData }) {
  return (
    <div className="space-y-1.5">
      <SectionTitle title="Instagram Scrape" />
      {data.bio && <DataRow label="Bio" value={data.bio} />}
      {data.followerCount != null && <DataRow label="Followers" value={data.followerCount.toLocaleString()} />}
      {data.followingCount != null && <DataRow label="Following" value={data.followingCount.toLocaleString()} />}
      {data.engagementRate != null && <DataRow label="Engagement Rate" value={`${(data.engagementRate * 100).toFixed(2)}%`} />}
      {data.category && <DataRow label="Category" value={data.category} />}
      {data.businessCategory && data.businessCategory !== data.category && <DataRow label="Business Category" value={data.businessCategory} />}
      {data.isVerified != null && <DataRow label="Verified" value={data.isVerified ? 'Yes' : 'No'} />}
      {data.isBusinessAccount != null && <DataRow label="Business Account" value={data.isBusinessAccount ? 'Yes' : 'No'} />}
      {data.recentPostsCount != null && <DataRow label="Recent Posts" value={String(data.recentPostsCount)} />}
    </div>
  );
}

export function EnrichmentStageDetails({ websiteScrape, instagramScrape }: { websiteScrape: WebsiteScrapeData | null; instagramScrape: InstagramScrapeData | null }) {
  if (!websiteScrape && !instagramScrape) {
    return <EmptyState text="No enrichment data available" />;
  }

  return (
    <div className="space-y-4">
      {websiteScrape && <WebsiteScrapeSection data={websiteScrape} />}
      {instagramScrape && <InstagramScrapeSection data={instagramScrape} />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  C3: Business conversion — Apollo/Hunter contacts + insights
// ══════════════════════════════════════════════════════════════════════════════

export function ConversionStageDetails({ data }: { data: BusinessConversionData | null }) {
  if (!data) {
    return <EmptyState text="No conversion data available" />;
  }

  return (
    <div className="space-y-4">
      {data.contactSource && <DataRow label="Contact Source" value={data.contactSource} />}
      {data.foundCsuiteDecisionMaker && (
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-zbooni-green/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zbooni-green">C-Suite Found</span>
          {data.ceoMatch && <span className="text-xs text-foreground/70">{data.ceoMatch.name}{data.ceoMatch.title ? ` — ${data.ceoMatch.title}` : ''}</span>}
        </div>
      )}

      {data.apolloContacts.length > 0 && (
        <Collapsible title={`Apollo Contacts (${data.apolloContacts.length})`} defaultOpen>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/30 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                  <th className="py-1.5 pr-3">Name</th>
                  <th className="py-1.5 pr-3">Title</th>
                  <th className="py-1.5 pr-3">Email</th>
                  <th className="py-1.5 pr-3">Company</th>
                </tr>
              </thead>
              <tbody>
                {data.apolloContacts.map((contact, i) => (
                  <tr key={`apollo-${i}`} className="border-b border-border/10">
                    <td className="py-1.5 pr-3 font-medium">{contact.name ?? '-'}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground/60">{contact.title ?? '-'}</td>
                    <td className="py-1.5 pr-3 font-mono text-[10px]">{contact.email ?? '-'}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground/60">{contact.company ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Collapsible>
      )}

      {data.hunterContacts.length > 0 && (
        <Collapsible title={`Hunter Contacts (${data.hunterContacts.length})`} defaultOpen>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/30 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                  <th className="py-1.5 pr-3">Email</th>
                  <th className="py-1.5 pr-3">Name</th>
                  <th className="py-1.5 pr-3">Position</th>
                  <th className="py-1.5 pr-3">Confidence</th>
                  <th className="py-1.5 pr-3">Type</th>
                </tr>
              </thead>
              <tbody>
                {data.hunterContacts.map((contact, i) => (
                  <tr key={`hunter-${i}`} className="border-b border-border/10">
                    <td className="py-1.5 pr-3 font-mono text-[10px]">{contact.email}</td>
                    <td className="py-1.5 pr-3 font-medium">{[contact.firstName, contact.lastName].filter(Boolean).join(' ') || '-'}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground/60">{contact.position ?? '-'}</td>
                    <td className="py-1.5 pr-3">
                      <span className={cn('font-mono text-[10px] font-bold', contact.confidence >= 70 ? 'text-zbooni-green' : contact.confidence >= 40 ? 'text-yellow-400' : 'text-red-400')}>
                        {contact.confidence}%
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-muted-foreground/60">{contact.type ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Collapsible>
      )}

      {data.businessInsights && (
        <div className="space-y-1.5">
          <SectionTitle title="AI Business Insights" />
          <p className="whitespace-pre-wrap text-xs text-foreground/70">{data.businessInsights}</p>
        </div>
      )}

      {data.apolloContacts.length === 0 && data.hunterContacts.length === 0 && !data.businessInsights && (
        <EmptyState text="No contact or insight data found during conversion" />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  C3b: Brave Search — CEO/founder web search results
// ══════════════════════════════════════════════════════════════════════════════

export function BraveSearchStageDetails({ data }: { data: BusinessConversionData | null }) {
  if (!data || data.braveSearchResults.length === 0) {
    return <EmptyState text="No Brave Search results available" />;
  }

  return (
    <div className="space-y-3">
      <DataRow label="Results Found" value={String(data.braveSearchResults.length)} />
      <Collapsible title={`Search Results (${data.braveSearchResults.length})`} defaultOpen>
        <div className="space-y-2">
          {data.braveSearchResults.map((result, i) => {
            const isLinkedIn = result.link.includes('linkedin.com');
            return (
              <div key={`brave-${i}`} className={cn('rounded-lg border px-3 py-2', isLinkedIn ? 'border-blue-500/30 bg-blue-500/[0.03]' : 'border-border/10')}>
                <a href={result.link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs font-medium text-zbooni-teal hover:underline">
                  {result.title}
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
                {result.snippet && <p className="mt-0.5 text-[10px] text-muted-foreground/60">{result.snippet.length > 200 ? result.snippet.slice(0, 200) + '...' : result.snippet}</p>}
                {isLinkedIn && <span className="mt-1 inline-block rounded bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-bold text-blue-400">LinkedIn Profile</span>}
              </div>
            );
          })}
        </div>
      </Collapsible>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  C3c: LLM CEO Validation — matched person details
// ══════════════════════════════════════════════════════════════════════════════

export function LlmCeoValidationDetails({ data }: { data: BusinessConversionData | null }) {
  if (!data) {
    return <EmptyState text="No LLM validation data available" />;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">C-Suite Found</span>
        {data.foundCsuiteDecisionMaker ? (
          <span className="rounded-md bg-zbooni-green/15 px-2 py-0.5 text-[10px] font-bold text-zbooni-green">Yes</span>
        ) : (
          <span className="rounded-md bg-red-400/15 px-2 py-0.5 text-[10px] font-bold text-red-400">No</span>
        )}
      </div>
      {data.ceoMatch && (
        <div className="space-y-1.5">
          <SectionTitle title="Matched Person" />
          <DataRow label="Name" value={data.ceoMatch.name ?? 'Unknown'} />
          {data.ceoMatch.title && <DataRow label="Title" value={data.ceoMatch.title} />}
          {data.ceoMatch.linkedinUrl && (
            <div className="flex items-start gap-3 text-sm">
              <span className="w-44 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-400">LinkedIn</span>
              <a href={data.ceoMatch.linkedinUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-zbooni-teal hover:underline">
                {data.ceoMatch.linkedinUrl}
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </div>
          )}
        </div>
      )}
      {!data.ceoMatch && !data.foundCsuiteDecisionMaker && (
        <EmptyState text="No C-suite decision maker identified from search results" />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  C3d: Apollo Org Enrichment — organization-level data
// ══════════════════════════════════════════════════════════════════════════════

export function ApolloOrgEnrichmentDetails({ data }: { data: BusinessConversionData | null }) {
  if (!data?.apolloOrgEnrichment) {
    return <EmptyState text="No Apollo organization enrichment data available" />;
  }

  const org = data.apolloOrgEnrichment;

  return (
    <div className="space-y-1.5">
      {org.name != null && <DataRow label="Organization" value={String(org.name)} />}
      {org.industry != null && <DataRow label="Industry" value={String(org.industry)} />}
      {org.estimatedEmployees != null && <DataRow label="Employees" value={Number(org.estimatedEmployees).toLocaleString()} />}
      {org.foundedYear != null && <DataRow label="Founded" value={String(org.foundedYear)} />}
      {org.annualRevenue != null && <DataRow label="Revenue" value={String(org.annualRevenue)} />}
      {org.city != null && <DataRow label="City" value={String(org.city)} />}
      {org.country != null && <DataRow label="Country" value={String(org.country)} />}
      {org.linkedinUrl != null && (
        <div className="flex items-start gap-3 text-sm">
          <span className="w-44 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-400">LinkedIn</span>
          <a href={String(org.linkedinUrl)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-zbooni-teal hover:underline">
            {String(org.linkedinUrl)}
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </div>
      )}
      {org.primaryPhone != null && <DataRow label="Phone" value={String(org.primaryPhone)} mono />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  C4: Feature computation — full 43-feature snapshot
// ══════════════════════════════════════════════════════════════════════════════

const FEATURE_GROUPS: Record<string, string[]> = {
  'Sales Motion Fit': ['has_whatsapp', 'custom_order_signals', 'high_ticket_signals'],
  'Payment Complexity': ['accepts_online_payments', 'shopify_detected', 'pure_self_serve_ecom', 'subscription_billing_detected', 'apify_has_shopify', 'apify_has_pricing_tiers', 'apify_has_product_catalog', 'apify_payment_widget_count'],
  'Risk / Urgency': ['recent_activity', 'follower_growth_signal', 'instagram_days_since_last_post'],
  'Social Presence': ['has_instagram', 'follower_count', 'follower_count_tier', 'instagram_follower_count', 'instagram_engagement_rate', 'instagram_is_business_account', 'instagram_has_bio_link', 'high_engagement_signal', 'social_link_count', 'has_linkedin'],
  'Contact Quality': ['decision_maker_count', 'has_decision_maker_phone', 'apollo_has_direct_phone', 'found_csuite_decision_maker', 'website_email_count', 'website_phone_count', 'has_booking_or_contact_form', 'apify_has_booking_form'],
  'Business Profile': ['review_count', 'review_count_tier', 'physical_address_present', 'multi_staff_detected', 'estimated_employees', 'tech_stack_size', 'international_customer_signals'],
  'ICP Match': ['industry_match', 'geo_match', 'icp_segment_priority'],
};

function formatFeatureValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return 'N/A';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    // Tier fields and counts are integers
    if (key.includes('tier') || key.includes('count') || key.includes('size') || key.includes('employees') || key === 'icp_segment_priority') {
      return String(value);
    }
    // Rate/score fields get decimal display
    if (key.includes('rate') || key.includes('score') || key.includes('priority')) {
      return value.toFixed(3);
    }
    // Binary flags stored as 0/1
    if (value === 0 || value === 1) return value === 1 ? 'Yes (1)' : 'No (0)';
    return value.toFixed(3);
  }
  return String(value);
}

function featureValueColor(value: unknown): string {
  if (value === null || value === undefined) return 'text-muted-foreground/30';
  if (typeof value === 'boolean') return value ? 'text-zbooni-green' : 'text-red-400/70';
  if (typeof value === 'number') {
    if (value === 1) return 'text-zbooni-green';
    if (value === 0) return 'text-muted-foreground/50';
    if (value > 0) return 'text-foreground/80';
  }
  return 'text-foreground/80';
}

export function FeatureStageDetails({ data }: { data: FeatureSnapshotData | null }) {
  if (!data) {
    return <EmptyState text="No feature snapshot available" />;
  }

  const features = data.featuresJson;
  const allGroupedKeys = new Set(Object.values(FEATURE_GROUPS).flat());
  const ungroupedKeys = Object.keys(features).filter((k) => !allGroupedKeys.has(k));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 text-[11px] text-muted-foreground/50">
        <span>Version: <span className="font-mono font-bold text-foreground/60">{data.sourceVersion}</span></span>
        <span>Rules matched: <span className="font-bold text-foreground/60">{data.ruleMatchCount}</span></span>
        <span>Hard filter: <span className={cn('font-bold', data.hardFilterPassed ? 'text-zbooni-green' : 'text-red-400')}>{data.hardFilterPassed ? 'Passed' : 'Failed'}</span></span>
        <span>Computed: <span className="text-foreground/60">{new Date(data.computedAt).toLocaleString()}</span></span>
      </div>

      {Object.entries(FEATURE_GROUPS).map(([groupName, keys]) => {
        const groupFeatures = keys.filter((k) => features[k] !== undefined);
        if (groupFeatures.length === 0) return null;
        return (
          <Collapsible key={groupName} title={`${groupName} (${groupFeatures.length} features)`} defaultOpen>
            <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
              {groupFeatures.map((key) => (
                <div key={key} className="flex items-center justify-between rounded-md px-2 py-1 hover:bg-slate-700/30">
                  <span className="text-[11px] text-muted-foreground/60">{key.replace(/_/g, ' ')}</span>
                  <span className={cn('font-mono text-[11px] font-bold', featureValueColor(features[key]))}>
                    {formatFeatureValue(key, features[key])}
                  </span>
                </div>
              ))}
            </div>
          </Collapsible>
        );
      })}

      {ungroupedKeys.length > 0 && (
        <Collapsible title={`Other Features (${ungroupedKeys.length})`}>
          <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
            {ungroupedKeys.map((key) => (
              <div key={key} className="flex items-center justify-between rounded-md px-2 py-1 hover:bg-slate-700/30">
                <span className="text-[11px] text-muted-foreground/60">{key.replace(/_/g, ' ')}</span>
                <span className={cn('font-mono text-[11px] font-bold', featureValueColor(features[key]))}>
                  {formatFeatureValue(key, features[key])}
                </span>
              </div>
            ))}
          </div>
        </Collapsible>
      )}

      <p className="text-[10px] text-muted-foreground/30">Total features: {Object.keys(features).length}</p>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  C5: Scoring — per-rule evaluation table
// ══════════════════════════════════════════════════════════════════════════════

function RuleEvaluationTable({ rules }: { rules: RuleEvaluation[] }) {
  if (rules.length === 0) {
    return <EmptyState text="No rule evaluations available" />;
  }

  const matchedCount = rules.filter((r) => r.matched).length;
  const totalWeight = rules.reduce((sum, r) => sum + r.weightApplied, 0);
  const totalContribution = rules.reduce((sum, r) => sum + r.contribution, 0);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/30 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
              <th className="py-1.5 pr-3">Rule / Field</th>
              <th className="py-1.5 pr-3">Type</th>
              <th className="py-1.5 pr-3 text-center">Matched</th>
              <th className="py-1.5 pr-3 text-right">Weight</th>
              <th className="py-1.5 pr-3 text-right">Contribution</th>
              <th className="py-1.5 pr-3">Reason</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule, i) => (
              <tr key={`${rule.ruleId}-${i}`} className={cn('border-b border-border/10', rule.ruleType === 'HARD_FILTER' && 'bg-orange-500/[0.03]')}>
                <td className="py-1.5 pr-3">
                  <span className="font-mono text-[10px]">{rule.fieldKey}</span>
                  {rule.ruleType === 'HARD_FILTER' && (
                    <span className="ml-1.5 rounded bg-orange-500/15 px-1 py-0.5 text-[8px] font-bold uppercase text-orange-400">Hard Filter</span>
                  )}
                </td>
                <td className="py-1.5 pr-3 text-muted-foreground/50">{rule.operator}</td>
                <td className="py-1.5 pr-3 text-center">
                  {rule.matched
                    ? <CheckCircle2 className="mx-auto h-3.5 w-3.5 text-zbooni-green" />
                    : <XCircle className="mx-auto h-3.5 w-3.5 text-red-400/50" />
                  }
                </td>
                <td className="py-1.5 pr-3 text-right font-mono text-[10px] text-muted-foreground/60">{rule.weightApplied.toFixed(1)}</td>
                <td className={cn('py-1.5 pr-3 text-right font-mono text-[10px] font-bold', rule.contribution > 0 ? 'text-zbooni-green' : 'text-muted-foreground/40')}>
                  {rule.contribution > 0 ? `+${rule.contribution.toFixed(3)}` : rule.contribution.toFixed(3)}
                </td>
                <td className="py-1.5 pr-3 text-[10px] text-muted-foreground/50">{rule.reasonCode}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-6 rounded-lg border border-border/20 bg-slate-800/50 px-4 py-2.5 text-[11px]">
        <span className="text-muted-foreground/50">Rules matched: <span className="font-bold text-foreground/80">{matchedCount} / {rules.length}</span></span>
        <span className="text-muted-foreground/50">Total weight pool: <span className="font-bold text-foreground/80">{totalWeight.toFixed(1)}</span></span>
        <span className="text-muted-foreground/50">Score contribution: <span className="font-mono font-bold text-zbooni-green">{totalContribution.toFixed(3)}</span></span>
      </div>
    </div>
  );
}

export function ScoringRuleDetails({ scoring }: { scoring: ScoringData | null }) {
  if (!scoring) {
    return <EmptyState text="No scoring data available" />;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-border/20 bg-slate-800/50 p-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Deterministic</p>
          <p className="mt-0.5 font-mono text-lg font-extrabold tabular-nums">{scoring.deterministicScore.toFixed(3)}</p>
        </div>
        <div className="rounded-lg border border-border/20 bg-slate-800/50 p-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Logistic (AI)</p>
          <p className="mt-0.5 font-mono text-lg font-extrabold tabular-nums">{scoring.logisticScore.toFixed(3)}</p>
        </div>
        <div className="rounded-lg border border-border/20 bg-slate-800/50 p-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Blended</p>
          <p className="mt-0.5 font-mono text-lg font-extrabold tabular-nums">{scoring.blendedScore.toFixed(3)}</p>
        </div>
        <div className="rounded-lg border border-border/20 bg-slate-800/50 p-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Score Band</p>
          <p className={cn('mt-0.5 text-lg font-extrabold', scoring.scoreBand === 'HIGH' ? 'text-zbooni-green' : scoring.scoreBand === 'MEDIUM' ? 'text-yellow-400' : 'text-red-400')}>
            {scoring.scoreBand}
          </p>
        </div>
      </div>

      <Collapsible title="Rule Evaluation Table" defaultOpen>
        <RuleEvaluationTable rules={scoring.ruleEvaluation} />
      </Collapsible>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  C6: Category scores breakdown
// ══════════════════════════════════════════════════════════════════════════════

const CATEGORY_LABELS: Record<string, string> = {
  SALES_MOTION_FIT: 'Sales Motion Fit',
  PAYMENT_COMPLEXITY: 'Payment Complexity',
  RISK_URGENCY: 'Risk / Urgency',
  SWITCHING_WILLINGNESS: 'Switching Willingness',
  GENERAL: 'General',
};

export function CategoryScoresDetails({ scoring }: { scoring: ScoringData | null }) {
  if (!scoring) {
    return <EmptyState text="No category scoring data available" />;
  }

  const categories = scoring.reasonsJson.categoryScores;
  const categoryEntries = Object.entries(categories);
  const path = scoring.reasonsJson.qualificationPath;
  const blendWeights = scoring.reasonsJson.blendWeights;

  const pathColors: Record<string, string> = {
    PROCEED: 'text-zbooni-green bg-zbooni-green/10 border-zbooni-green/30',
    SELECTIVE: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
    DISQUALIFY: 'text-red-400 bg-red-400/10 border-red-400/30',
    HARD_FILTERED: 'text-red-400 bg-red-400/10 border-red-400/30',
  };

  if (categoryEntries.length === 0) {
    return <EmptyState text="No category score data available" />;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {categoryEntries.map(([catKey, scores]: [string, CategoryScoreData]) => {
          const passed = scores.rate >= 0.5 && scores.matched >= 1;
          return (
            <div key={catKey} className="rounded-lg border border-border/20 bg-slate-800/50 p-3">
              <div className="flex items-center justify-between">
                <h5 className="text-[11px] font-bold uppercase tracking-wider text-slate-300">{CATEGORY_LABELS[catKey] ?? catKey}</h5>
                <span className={cn('rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider', passed ? 'border-zbooni-green/30 bg-zbooni-green/10 text-zbooni-green' : 'border-red-400/30 bg-red-400/10 text-red-400')}>
                  {passed ? 'Pass' : 'Fail'}
                </span>
              </div>
              <div className="mt-2 space-y-1 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-muted-foreground/50">Rules matched</span>
                  <span className="font-bold text-foreground/80">{scores.matched} / {scores.total}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground/50">Match rate</span>
                  <span className="font-mono font-bold text-foreground/80">{(scores.rate * 100).toFixed(0)}%</span>
                </div>
                {/* Progress bar */}
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-700">
                  <div
                    className={cn('h-full rounded-full transition-all', passed ? 'bg-zbooni-green' : 'bg-red-400/60')}
                    style={{ width: `${Math.min(100, scores.rate * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-4 rounded-lg border border-border/20 bg-slate-800/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground/50">Qualification Path:</span>
          <span className={cn('rounded-md border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider', pathColors[path] ?? 'text-foreground')}>
            {path}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-4 text-[11px]">
          <span className="text-muted-foreground/50">Blend: <span className="font-bold text-foreground/80">{(blendWeights.deterministic * 100).toFixed(0)}% Det / {(blendWeights.ai * 100).toFixed(0)}% AI</span></span>
          <span className="text-muted-foreground/50">AI Model: <span className="font-bold text-foreground/80">{scoring.reasonsJson.usedTrainedModel ? 'Active' : 'None'}</span></span>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  C7: Message drafts and sends
// ══════════════════════════════════════════════════════════════════════════════

function DraftCard({ draft }: { draft: MessageDraftData }) {
  const [expanded, setExpanded] = useState(false);
  const statusColors: Record<string, string> = {
    APPROVED: 'text-zbooni-green bg-zbooni-green/10',
    AUTO_APPROVED: 'text-zbooni-green bg-zbooni-green/10',
    REJECTED: 'text-red-400 bg-red-400/10',
    PENDING: 'text-yellow-400 bg-yellow-400/10',
  };

  return (
    <div className="rounded-lg border border-border/20 bg-slate-800/50">
      <button type="button" onClick={() => setExpanded(!expanded)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
        <Mail className="h-3.5 w-3.5 text-zbooni-teal" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-slate-300">
              {draft.followUpNumber === 0 ? 'Initial Draft' : `Follow-up #${draft.followUpNumber}`}
            </span>
            <span className={cn('rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider', statusColors[draft.approvalStatus] ?? 'text-muted-foreground bg-muted/10')}>
              {draft.approvalStatus}
            </span>
            {draft.variants.length > 0 && (
              <span className="text-[10px] text-muted-foreground/40">{draft.variants.length} variant{draft.variants.length !== 1 ? 's' : ''}</span>
            )}
          </div>
          <p className="mt-0.5 text-[10px] text-muted-foreground/40">{new Date(draft.createdAt).toLocaleString()}</p>
        </div>
        {expanded ? <ChevronDown className="h-3 w-3 text-muted-foreground/30" /> : <ChevronRight className="h-3 w-3 text-muted-foreground/30" />}
      </button>
      {expanded && draft.variants.length > 0 && (
        <div className="border-t border-border/20 px-3 py-3 space-y-3">
          {draft.variants.map((variant) => (
            <div key={variant.id} className={cn('rounded-lg border p-3', variant.isSelected ? 'border-zbooni-green/30 bg-zbooni-green/[0.03]' : 'border-border/10 bg-slate-900/30')}>
              <div className="mb-2 flex items-center gap-2 text-[10px]">
                <span className="font-bold uppercase text-slate-400">{variant.channel}</span>
                <span className="text-muted-foreground/30">|</span>
                <span className="text-muted-foreground/40">{variant.variantKey}</span>
                {variant.isSelected && <span className="rounded bg-zbooni-green/15 px-1.5 py-0.5 text-[8px] font-bold text-zbooni-green">SELECTED</span>}
                {variant.qualityScore != null && <span className="ml-auto text-muted-foreground/40">Quality: <span className="font-mono font-bold">{variant.qualityScore.toFixed(2)}</span></span>}
              </div>
              {variant.subject && (
                <p className="mb-1 text-[11px] font-bold text-foreground/80">Subject: {variant.subject}</p>
              )}
              <p className="whitespace-pre-wrap text-xs text-foreground/60 leading-relaxed">{variant.bodyText.length > 500 ? variant.bodyText.slice(0, 500) + '...' : variant.bodyText}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function MessageStageDetails({ drafts, sends }: { drafts: MessageDraftData[]; sends: MessageSendData[] }) {
  if (drafts.length === 0 && sends.length === 0) {
    return <EmptyState text="No message drafts generated yet" />;
  }

  return (
    <div className="space-y-4">
      {drafts.length > 0 && (
        <div className="space-y-2">
          <SectionTitle title={`Message Drafts (${drafts.length})`} />
          {drafts.map((draft) => (
            <DraftCard key={draft.id} draft={draft} />
          ))}
        </div>
      )}

      {sends.length > 0 && (
        <div className="space-y-2">
          <SectionTitle title={`Message Sends (${sends.length})`} />
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/30 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                  <th className="py-1.5 pr-3">Channel</th>
                  <th className="py-1.5 pr-3">Status</th>
                  <th className="py-1.5 pr-3">Follow-up #</th>
                  <th className="py-1.5 pr-3">Sent At</th>
                  <th className="py-1.5 pr-3">Delivered</th>
                  <th className="py-1.5 pr-3">Replied</th>
                  <th className="py-1.5 pr-3">Error</th>
                </tr>
              </thead>
              <tbody>
                {sends.map((send) => {
                  const statusColor = send.status === 'DELIVERED' || send.status === 'REPLIED'
                    ? 'text-zbooni-green'
                    : send.status === 'FAILED' || send.status === 'BOUNCED'
                      ? 'text-red-400'
                      : 'text-yellow-400';
                  return (
                    <tr key={send.id} className="border-b border-border/10">
                      <td className="py-1.5 pr-3 font-medium">{send.channel}</td>
                      <td className={cn('py-1.5 pr-3 font-bold', statusColor)}>{send.status}</td>
                      <td className="py-1.5 pr-3 text-muted-foreground/60">{send.followUpNumber}</td>
                      <td className="py-1.5 pr-3 text-muted-foreground/60">{send.sentAt ? new Date(send.sentAt).toLocaleString() : '-'}</td>
                      <td className="py-1.5 pr-3 text-muted-foreground/60">{send.deliveredAt ? new Date(send.deliveredAt).toLocaleString() : '-'}</td>
                      <td className="py-1.5 pr-3 text-muted-foreground/60">{send.repliedAt ? new Date(send.repliedAt).toLocaleString() : '-'}</td>
                      <td className="py-1.5 pr-3 text-[10px] text-red-400/60">{send.failureReason ?? (send.failureCode ?? '-')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  C8: Follow-up history and feedback
// ══════════════════════════════════════════════════════════════════════════════

export function FollowUpStageDetails({ sends }: { sends: MessageSendData[] }) {
  const followUps = sends.filter((s) => s.followUpNumber > 0);

  if (followUps.length === 0) {
    return <EmptyState text="No follow-up messages sent yet" />;
  }

  return (
    <div className="space-y-2">
      <DataRow label="Follow-up Count" value={String(followUps.length)} />
      {followUps.map((fu) => (
        <div key={fu.id} className="flex items-center gap-3 rounded-lg border border-border/10 bg-slate-800/30 px-3 py-2">
          <span className="rounded-md bg-zbooni-teal/10 px-2 py-0.5 text-[10px] font-bold text-zbooni-teal">#{fu.followUpNumber}</span>
          <span className="text-[11px] text-muted-foreground/50">{fu.channel}</span>
          <span className={cn('text-[11px] font-bold', fu.status === 'DELIVERED' || fu.status === 'REPLIED' ? 'text-zbooni-green' : fu.status === 'FAILED' ? 'text-red-400' : 'text-yellow-400')}>
            {fu.status}
          </span>
          {fu.sentAt && <span className="ml-auto text-[10px] text-muted-foreground/40">{new Date(fu.sentAt).toLocaleString()}</span>}
        </div>
      ))}
    </div>
  );
}

export function FeedbackStageDetails({ events }: { events: FeedbackEventData[] }) {
  if (events.length === 0) {
    return <EmptyState text="No feedback events recorded" />;
  }

  const eventTypeLabels: Record<string, string> = {
    REPLIED: 'Reply Received',
    MEETING_BOOKED: 'Meeting Booked',
    DEAL_WON: 'Deal Won',
    DEAL_LOST: 'Deal Lost',
    UNSUBSCRIBED: 'Unsubscribed',
    BOUNCED: 'Bounced',
  };

  const eventTypeColors: Record<string, string> = {
    REPLIED: 'text-zbooni-green bg-zbooni-green/10',
    MEETING_BOOKED: 'text-zbooni-green bg-zbooni-green/10',
    DEAL_WON: 'text-zbooni-green bg-zbooni-green/10',
    DEAL_LOST: 'text-red-400 bg-red-400/10',
    UNSUBSCRIBED: 'text-orange-400 bg-orange-400/10',
    BOUNCED: 'text-red-400 bg-red-400/10',
  };

  return (
    <div className="space-y-2">
      {events.map((event) => (
        <div key={event.id} className="rounded-lg border border-border/20 bg-slate-800/50 p-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className={cn('rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider', eventTypeColors[event.eventType] ?? 'text-foreground bg-muted/10')}>
              {eventTypeLabels[event.eventType] ?? event.eventType}
            </span>
            <span className="text-[10px] text-muted-foreground/40">{event.source}</span>
            <span className="ml-auto text-[10px] text-muted-foreground/40">{new Date(event.occurredAt).toLocaleString()}</span>
          </div>
          {event.replyClassification && (
            <DataRow label="Classification" value={event.replyClassification} />
          )}
          {event.replyText && (
            <div className="mt-1 rounded-md bg-slate-900/50 p-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Reply Text</p>
              <p className="whitespace-pre-wrap text-xs text-foreground/60">{event.replyText.length > 300 ? event.replyText.slice(0, 300) + '...' : event.replyText}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  Composite renderer: renders enriched details for a given stage
// ══════════════════════════════════════════════════════════════════════════════

export function EnrichedStageContent({
  stageId,
  data,
}: {
  stageId: string;
  data: LeadLifecycleData | null;
}) {
  if (!data) return null;

  switch (stageId) {
    case 'discovery':
      return <DiscoveryStageDetails searchTask={data.searchTask} />;
    case 'enrichment':
      return <EnrichmentStageDetails websiteScrape={data.websiteScrape} instagramScrape={data.instagramScrape} />;
    case 'conversion':
      return <ConversionStageDetails data={data.businessConversion} />;
    case 'brave-search':
      return <BraveSearchStageDetails data={data.businessConversion} />;
    case 'llm-ceo-validation':
      return <LlmCeoValidationDetails data={data.businessConversion} />;
    case 'apollo-org-enrichment':
      return <ApolloOrgEnrichmentDetails data={data.businessConversion} />;
    case 'features':
      return <FeatureStageDetails data={data.featureSnapshot} />;
    case 'scoring':
      return (
        <div className="space-y-6">
          <ScoringRuleDetails scoring={data.scoring} />
          <CategoryScoresDetails scoring={data.scoring} />
        </div>
      );
    case 'message-gen':
      return <MessageStageDetails drafts={data.messageDrafts} sends={[]} />;
    case 'message-send':
      return <MessageStageDetails drafts={[]} sends={data.messageSends} />;
    case 'followups':
      return <FollowUpStageDetails sends={data.messageSends} />;
    case 'feedback':
      return <FeedbackStageDetails events={data.feedbackEvents} />;
    default:
      return null;
  }
}
