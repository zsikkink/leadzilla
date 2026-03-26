'use client';

import type { GetLeadResponse } from '@lead-flood/contracts';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Brain,
  Briefcase,
  Building2,
  Check,
  ExternalLink,
  FileText,
  Globe,
  Inbox,
  Linkedin,
  Loader2,
  Mail,
  MapPin,
  Monitor,
  Newspaper,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Star,
  Trash2,
  TrendingUp,
  User,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { toast } from 'sonner';

import { AboutBusinessCard } from '../../../../src/components/about-business-card.js';
import { LeadStatusBadge } from '../../../../src/components/lead-status-badge.js';
import { ScoreBandBadge } from '../../../../src/components/score-band-badge.js';
import { ScoringBreakdown } from '../../../../src/components/scoring-breakdown.js';
import {
  getSocialPlatformLabel,
  normalizeSocialPlatform,
  SOCIAL_BRAND_COLORS,
  SocialLinkIcon,
} from '../../../../src/components/social-link-icon.js';
import { useApiQuery } from '../../../../src/hooks/use-api-query.js';
import { useAuth } from '../../../../src/hooks/use-auth.js';
import { countryName } from '../../../../src/lib/countries.js';
import { getSupabaseBrowserClient } from '../../../../src/lib/supabase-client.js';
import { getTeamMemberTier, sortTeamMembers } from '../../../../src/lib/team-members.js';

// ── Types ──────────────────────────────────────────────────
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

interface BusinessScrapeData {
  name: string;
  websiteScrape: Record<string, unknown> | null;
  instagramScrape: Record<string, unknown> | null;
  websiteDomain: string | null;
  instagramHandle: string | null;
  rating: number | null;
  reviewCount: number | null;
  followerCount: number | null;
  category: string | null;
  countryCode: string | null;
  city: string | null;
}

interface DecisionMaker { name: string; title: string; email?: string | undefined; linkedinUrl?: string | undefined }
interface ContactEmail { email: string; context?: string | undefined }
interface ContactPhone { number: string; type?: string | undefined }
interface ContactAddress { text: string }
interface SocialLink { platform: string; url: string; handle?: string | undefined }
interface TeamMember {
  id: string;
  fullName: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  seniority: string | null;
  positionRank: number | null;
  source: string | null;
  fromBusinessContacts: boolean;
}

/** Brave/Google CSE matched decision maker from business conversion metadata */
interface BraveMatchedPerson {
  name: string;
  title: string;
  linkedinUrl: string | null;
  confidence: number;
}

/** Brave/Google CSE search result */
interface BraveSearchResult {
  title: string;
  link: string;
  snippet: string;
  linkedinUrl: string | null;
}

/** Business conversion data loaded from Supabase */
interface ConversionData {
  businessInsights: string | null;
  matchedPerson: BraveMatchedPerson | null;
  searchResults: BraveSearchResult[];
}

/** Supabase business_contacts row */
interface BusinessContactRow {
  id: string;
  businessId: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  seniority: string;
  positionRank: number;
  source: string;
}

// ── Utility functions ──────────────────────────────────────

function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function getBusinessNameFromLead(lead: GetLeadResponse | null): string | null {
  if (!lead?.enrichmentData || typeof lead.enrichmentData !== 'object') {
    return null;
  }
  const data = lead.enrichmentData as Record<string, unknown>;
  return readOptionalString(
    data.companyName
      ?? data.company_name
      ?? data.organization_name
      ?? data.company,
  );
}

function buildTeamMembersFromLead(lead: GetLeadResponse | null): TeamMember[] {
  const candidates = lead?.contactDiscovery?.topCandidates ?? [];
  return candidates.map((candidate, index) => ({
    id: `contact-discovery-${index}`,
    fullName: candidate.name,
    jobTitle: candidate.title,
    email: candidate.email,
    phone: null,
    linkedinUrl: candidate.linkedinUrl,
    seniority: null,
    positionRank: index,
    source: candidate.sourceStage ?? 'Contact discovery',
    fromBusinessContacts: false,
  }));
}

function getLeadTitleFromEnrichment(enrichmentData: unknown): string | null {
  if (!enrichmentData || typeof enrichmentData !== 'object') return null;
  const data = enrichmentData as Record<string, unknown>;
  const title = data.title ?? data.job_title ?? data.position;
  return typeof title === 'string' && title.trim().length > 0 ? title.trim() : null;
}

function isExecutiveOrDirector(member: Pick<TeamMember, 'seniority' | 'jobTitle'>): boolean {
  return getTeamMemberTier(member.seniority, member.jobTitle) <= 1;
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
    fields.push({ label: 'Country', value: countryName(String(d.country)), icon: MapPin });
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

// ── Supabase business data (A1 fix: query by businessId, not leadId) ──
interface SupabaseBusinessData {
  businessId: string | null;
  businessInsights: string | null;
  conversionMetadata: Record<string, unknown> | null;
  businessContacts: TeamMember[];
  businessName: string | null;
  websiteDomain: string | null;
  instagramHandle: string | null;
  rating: number | null;
  reviewCount: number | null;
}
interface _InstagramPost {
  caption: string;
  likes: number;
  comments: number;
  timestamp: string;
  url: string | null;
  thumbnailUrl: string | null;
  postType: 'image' | 'video' | 'carousel';
}

function _getInstagramPostType(raw: unknown): 'image' | 'video' | 'carousel' {
  if (raw === 'video') return 'video';
  if (raw === 'carousel') return 'carousel';
  return 'image';
}

function _getInstagramPostTypeLabel(postType: 'image' | 'video' | 'carousel'): string {
  if (postType === 'video') return 'Video';
  if (postType === 'carousel') return 'Carousel';
  return 'Image';
}

// ── Scrape data extraction ─────────────────────────────────

function extractBusinessDecisionMakers(scrape: Record<string, unknown>): DecisionMaker[] {
  const raw = scrape.decisionMakers;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((dm): dm is DecisionMaker => dm && typeof dm.name === 'string')
    .slice(0, 5);
}

function extractBusinessTechStack(scrape: Record<string, unknown>): Array<{ category: string; technologies: string[] }> {
  const techObj = scrape.technologies;
  if (techObj && typeof techObj === 'object' && !Array.isArray(techObj)) {
    return Object.entries(techObj as Record<string, unknown>)
      .filter(([, techs]) => Array.isArray(techs) && techs.length > 0)
      .map(([category, techs]) => ({ category, technologies: (techs as string[]) }))
      .slice(0, 8);
  }
  const raw = scrape.techStack;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((ts): ts is { category: string; technologies: string[] } => ts && typeof ts.category === 'string')
    .slice(0, 8);
}

function extractBusinessSocialLinks(scrape: Record<string, unknown>): SocialLink[] {
  const raw = scrape.socialLinks;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((sl): sl is SocialLink => sl && typeof sl.platform === 'string')
    .slice(0, 8);
}

function extractBusinessCertifications(scrape: Record<string, unknown>): string[] {
  const signals = scrape.businessSignals;
  if (signals && typeof signals === 'object') {
    const s = signals as Record<string, unknown>;
    if (Array.isArray(s.certifications) && s.certifications.length > 0) {
      return s.certifications.filter((c): c is string => typeof c === 'string').slice(0, 8);
    }
  }
  const raw = scrape.certifications;
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is string => typeof c === 'string').slice(0, 8);
}

function extractContactEmails(scrape: Record<string, unknown>): ContactEmail[] {
  const ci = scrape.contactInfo;
  if (ci && typeof ci === 'object') {
    const c = ci as Record<string, unknown>;
    if (Array.isArray(c.emails)) {
      return c.emails.filter((e): e is ContactEmail => e && typeof e.email === 'string').slice(0, 5);
    }
  }
  if (Array.isArray(scrape.emails)) {
    return scrape.emails.filter((e): e is ContactEmail => e && typeof e.email === 'string').slice(0, 5);
  }
  return [];
}

function extractContactPhones(scrape: Record<string, unknown>): ContactPhone[] {
  const ci = scrape.contactInfo;
  if (ci && typeof ci === 'object') {
    const c = ci as Record<string, unknown>;
    if (Array.isArray(c.phones)) {
      return c.phones.filter((p): p is ContactPhone => p && typeof p.number === 'string').slice(0, 5);
    }
  }
  if (Array.isArray(scrape.phones)) {
    return scrape.phones.filter((p): p is ContactPhone => p && typeof p.number === 'string').slice(0, 5);
  }
  return [];
}

function extractContactAddresses(scrape: Record<string, unknown>): ContactAddress[] {
  const ci = scrape.contactInfo;
  if (ci && typeof ci === 'object') {
    const c = ci as Record<string, unknown>;
    if (Array.isArray(c.addresses)) {
      return c.addresses.filter((a): a is ContactAddress => a && typeof a.text === 'string').slice(0, 3);
    }
  }
  return [];
}

function mergeSocialLinks(
  websiteScrape: Record<string, unknown> | null,
  instagramHandle: string | null,
  instagramScrape: Record<string, unknown> | null,
): SocialLink[] {
  const links: SocialLink[] = [];
  const seen = new Set<string>();

  if (websiteScrape) {
    const raw = extractBusinessSocialLinks(websiteScrape);
    for (const sl of raw) {
      const key = sl.platform.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        links.push(sl);
      }
    }
  }

  if (instagramHandle && !seen.has('instagram')) {
    seen.add('instagram');
    links.push({ platform: 'Instagram', url: `https://instagram.com/${instagramHandle}`, handle: instagramHandle });
  }

  if (instagramScrape && !seen.has('instagram')) {
    const handle = instagramScrape.username as string | undefined;
    if (handle) {
      seen.add('instagram');
      links.push({ platform: 'Instagram', url: `https://instagram.com/${handle}`, handle });
    }
  }

  return links;
}

// ── Brave CEO card + Related Findings helpers ──────────────

function classifyUrl(url: string): 'linkedin' | 'company' | 'article' {
  const lower = url.toLowerCase();
  if (lower.includes('linkedin.com')) return 'linkedin';
  // Check if this is the business's own website domain
  // (we can't check domain here, so classify press/news/directory as article)
  if (lower.includes('crunchbase.com') || lower.includes('bloomberg.com') || lower.includes('reuters.com') ||
      lower.includes('techcrunch.com') || lower.includes('forbes.com') || lower.includes('news.') ||
      lower.includes('press') || lower.includes('article') || lower.includes('medium.com') ||
      lower.includes('businesswire.com') || lower.includes('prnewswire.com')) {
    return 'article';
  }
  return 'company';
}

function getUrlIcon(type: 'linkedin' | 'company' | 'article') {
  switch (type) {
    case 'linkedin': return Linkedin;
    case 'article': return Newspaper;
    case 'company': return Building2;
  }
}

function getUrlIconColor(type: 'linkedin' | 'company' | 'article') {
  switch (type) {
    case 'linkedin': return 'text-blue-400';
    case 'article': return 'text-amber-400';
    case 'company': return 'text-zbooni-teal';
  }
}

// ── Extract conversion data from Supabase ──────────────────

function parseConversionData(row: Record<string, unknown> | null): ConversionData {
  if (!row) return { businessInsights: null, matchedPerson: null, searchResults: [] };

  const insights = typeof row.businessInsights === 'string' ? row.businessInsights : null;
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : null;

  let matchedPerson: BraveMatchedPerson | null = null;
  let searchResults: BraveSearchResult[] = [];

  if (metadata) {
    // Extract matched person (the top decision maker identified via Brave/Google CSE)
    const mp = metadata.googleCseMatchedPerson ?? metadata.matchedPerson ?? metadata.topPerson;
    if (mp && typeof mp === 'object') {
      const p = mp as Record<string, unknown>;
      if (typeof p.name === 'string') {
        matchedPerson = {
          name: p.name,
          title: typeof p.title === 'string' ? p.title : 'Unknown',
          linkedinUrl: typeof p.linkedinUrl === 'string' ? p.linkedinUrl : null,
          confidence: typeof p.confidence === 'number' ? p.confidence : 0,
        };
      }
    }

    // Extract search results
    const results = metadata.googleCseResults ?? metadata.braveResults ?? metadata.webSearchResults;
    if (Array.isArray(results)) {
      searchResults = results
        .filter((r): r is Record<string, unknown> => r && typeof r === 'object')
        .map((r) => ({
          title: typeof r.title === 'string' ? r.title : '',
          link: typeof r.link === 'string' ? r.link : (typeof r.url === 'string' ? r.url : ''),
          snippet: typeof r.snippet === 'string' ? r.snippet : '',
          linkedinUrl: typeof r.linkedinUrl === 'string' ? r.linkedinUrl : null,
        }))
        .filter((r) => r.link.length > 0)
        .slice(0, 10);
    }
  }

  return { businessInsights: insights, matchedPerson, searchResults };
}

// ── Intelligence Gathered Component ────────────────────────

function _IntelligenceGathered({ data }: { data: BusinessScrapeData }) {
  const ws = data.websiteScrape;
  const ig = data.instagramScrape;

  const decisionMakers = ws ? extractBusinessDecisionMakers(ws) : [];
  const techStack = ws ? extractBusinessTechStack(ws) : [];
  const mergedSocialLinks = mergeSocialLinks(ws, data.instagramHandle, ig);
  const certs = ws ? extractBusinessCertifications(ws) : [];
  const emails = ws ? extractContactEmails(ws) : [];
  const phones = ws ? extractContactPhones(ws) : [];
  const addresses = ws ? extractContactAddresses(ws) : [];

  const igBusinessEmail = ig && typeof ig.businessEmail === 'string' ? ig.businessEmail : null;
  const igBusinessPhone = ig && typeof ig.businessPhone === 'string' ? ig.businessPhone : null;
  const allEmails = [...emails];
  if (igBusinessEmail && !allEmails.some((e) => e.email === igBusinessEmail)) {
    allEmails.push({ email: igBusinessEmail, context: 'Instagram' });
  }
  const allPhones = [...phones];
  if (igBusinessPhone && !allPhones.some((p) => p.number === igBusinessPhone)) {
    allPhones.push({ number: igBusinessPhone, type: 'Instagram' });
  }

  const igMediaCount = ig && typeof ig.mediaCount === 'number' ? ig.mediaCount : null;

  const hasAnyData =
    decisionMakers.length > 0 || techStack.length > 0 || mergedSocialLinks.length > 0 ||
    certs.length > 0 || allEmails.length > 0 || allPhones.length > 0 || addresses.length > 0;

  if (!hasAnyData) {
    return (
      <div className="text-sm text-muted-foreground/50">
        No detailed intelligence data available. Business has not been fully scraped yet.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Quick stats row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {data.rating !== null && (
          <div className="rounded-lg border border-border/20 bg-zbooni-dark/30 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Rating</p>
            <p className="mt-0.5 text-sm font-bold">{data.rating}/5</p>
          </div>
        )}
        {data.reviewCount !== null && (
          <div className="rounded-lg border border-border/20 bg-zbooni-dark/30 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Reviews</p>
            <p className="mt-0.5 text-sm font-bold">{data.reviewCount}</p>
          </div>
        )}
        {data.followerCount !== null && (
          <div className="rounded-lg border border-border/20 bg-zbooni-dark/30 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Followers</p>
            <p className="mt-0.5 text-sm font-bold">{data.followerCount.toLocaleString()}</p>
          </div>
        )}
        {igMediaCount !== null && (
          <div className="rounded-lg border border-border/20 bg-zbooni-dark/30 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">IG Media</p>
            <p className="mt-0.5 text-sm font-bold">{igMediaCount}</p>
          </div>
        )}
      </div>

      {/* Contact Methods */}
      {(allEmails.length > 0 || allPhones.length > 0) && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 mb-2">
            <Mail className="mr-1 inline h-3 w-3" />Contact Methods
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {allEmails.map((e, i) => (
              <a key={i} href={`mailto:${e.email}`} className="flex items-center gap-2 rounded-lg border border-border/20 bg-zbooni-dark/30 px-3 py-2 text-xs text-zbooni-teal transition-colors hover:text-zbooni-green hover:border-border/40">
                <Mail className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{e.email}</span>
                {e.context && <span className="ml-auto text-[10px] text-muted-foreground/40">{e.context}</span>}
              </a>
            ))}
            {allPhones.map((p, i) => (
              <a key={i} href={`tel:${p.number}`} className="flex items-center gap-2 rounded-lg border border-border/20 bg-zbooni-dark/30 px-3 py-2 text-xs text-zbooni-teal transition-colors hover:text-zbooni-green hover:border-border/40">
                <Phone className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{p.number}</span>
                {p.type && <span className="ml-auto text-[10px] text-muted-foreground/40">{p.type}</span>}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Location */}
      {addresses.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 mb-2">
            <MapPin className="mr-1 inline h-3 w-3" />Location
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {addresses.map((a, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-border/20 bg-zbooni-dark/30 px-3 py-2 text-xs text-muted-foreground">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                <span className="truncate">{a.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Decision Makers */}
      {decisionMakers.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 mb-2">
            <Users className="mr-1 inline h-3 w-3" />Decision Makers ({decisionMakers.length})
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {decisionMakers.map((dm, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-border/20 bg-zbooni-dark/30 px-3 py-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-500/10 text-[10px] font-bold text-amber-400">{dm.name.charAt(0)}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold truncate">{dm.name}</p>
                  <p className="text-[10px] text-muted-foreground/50 truncate">{dm.title}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {dm.email && (
                    <a href={`mailto:${dm.email}`} title={dm.email} className="text-muted-foreground/40 hover:text-zbooni-teal transition-colors">
                      <Mail className="h-3 w-3" />
                    </a>
                  )}
                  {dm.linkedinUrl && (
                    <a href={dm.linkedinUrl} target="_blank" rel="noopener noreferrer" title="LinkedIn" className="text-muted-foreground/40 hover:text-zbooni-teal transition-colors">
                      <Linkedin className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Social Presence */}
      {mergedSocialLinks.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 mb-2">
            <Globe className="mr-1 inline h-3 w-3" />Social Presence
          </p>
          <div className="flex flex-wrap gap-2">
            {mergedSocialLinks.map((sl, i) => {
              const platform = normalizeSocialPlatform(sl.platform);
              const brandColor = SOCIAL_BRAND_COLORS[platform] ?? '#6366F1';
              const label = getSocialPlatformLabel(sl.platform);
              const isGradient = brandColor.startsWith('linear-gradient');
              const hoverStyle = {
                '--social-brand-color': isGradient ? '#DD2A7B' : brandColor,
                '--social-brand-shadow': isGradient ? '#DD2A7B40' : `${brandColor}40`,
                '--social-brand-gradient': brandColor,
              } as CSSProperties;

              return (
                <a
                  key={i}
                  href={sl.url.startsWith('http') ? sl.url : `https://${sl.url}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={hoverStyle}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/30 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition-all duration-200 hover:border-[var(--social-brand-color)] hover:shadow-[0_0_8px_var(--social-brand-shadow)] hover:text-[var(--social-brand-color)]"
                >
                  <SocialLinkIcon platform={sl.platform} className="h-3 w-3" />
                  <span>{label}</span>
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              );
            })}
          </div>
        </div>
      )}

      {/* Technology Stack */}
      {techStack.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 mb-2">
            <Monitor className="mr-1 inline h-3 w-3" />Technology Stack
          </p>
          <div className="space-y-2">
            {techStack.map((cat) => (
              <div key={cat.category}>
                <p className="text-[10px] font-semibold text-muted-foreground/50">{cat.category}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {cat.technologies.map((tech) => (
                    <span key={tech} className="rounded-full bg-purple-500/10 px-2 py-0.5 text-[10px] font-semibold text-purple-300">{tech}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Certifications */}
      {certs.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 mb-2">
            <Shield className="mr-1 inline h-3 w-3" />Certifications
          </p>
          <div className="flex flex-wrap gap-1.5">
            {certs.map((cert) => (
              <span key={cert} className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">{cert}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Brave Search Results Section ───────────────────────────

function BraveSearchSection({ conversion }: { conversion: ConversionData }) {
  const { matchedPerson, searchResults } = conversion;

  if (!matchedPerson && searchResults.length === 0) return null;

  // Separate related findings (non-linkedin, supplementary results)
  const relatedFindings = searchResults.filter((r) => {
    const type = classifyUrl(r.link);
    return type === 'article';
  });

  return (
    <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
      <h2 className="mb-4 flex items-center gap-2 text-base font-bold tracking-tight">
        <Search className="h-4 w-4 text-zbooni-teal" />
        Web Search Results
      </h2>

      {/* CEO / Decision Maker Card (C3) */}
      {matchedPerson && (
        <div className="rounded-xl border border-border/30 bg-zbooni-dark/30 p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-sm font-bold text-amber-400">
              {matchedPerson.name.charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-bold">{matchedPerson.name}</p>
                <span className="rounded-full border border-amber-400/40 bg-amber-400/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-300">
                  Decision Maker
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground/60">{matchedPerson.title}</p>
              {matchedPerson.confidence > 0 && (
                <p className="mt-1 text-[10px] text-muted-foreground/40">
                  Confidence: {Math.round(matchedPerson.confidence * 100)}%
                </p>
              )}

              {/* Links with proper icons */}
              <div className="mt-2 flex flex-wrap gap-2">
                {matchedPerson.linkedinUrl && (
                  <a
                    href={matchedPerson.linkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-blue-400/20 bg-blue-400/5 px-2.5 py-1.5 text-[11px] font-semibold text-blue-400 transition-colors hover:bg-blue-400/10"
                  >
                    <Linkedin className="h-3 w-3" />
                    LinkedIn Profile
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Search results with correct icon types */}
      {searchResults.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
            Search Results ({searchResults.length})
          </p>
          {searchResults.slice(0, 5).map((r, i) => {
            const urlType = classifyUrl(r.link);
            const Icon = getUrlIcon(urlType);
            const iconColor = getUrlIconColor(urlType);

            return (
              <a
                key={i}
                href={r.link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-2.5 rounded-lg border border-border/20 bg-zbooni-dark/20 px-3 py-2.5 transition-colors hover:border-border/40"
              >
                <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${iconColor}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-foreground/80 truncate">{r.title}</p>
                  {r.snippet && (
                    <p className="mt-0.5 text-[10px] text-muted-foreground/50 line-clamp-2">{r.snippet}</p>
                  )}
                  <p className="mt-0.5 text-[10px] text-muted-foreground/30 truncate">{r.link}</p>
                </div>
                <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/30" />
              </a>
            );
          })}
        </div>
      )}

      {/* Related Findings (C4) */}
      {relatedFindings.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
            <FileText className="mr-1 inline h-3 w-3" />
            Related Findings ({relatedFindings.length})
          </p>
          <div className="space-y-1.5">
            {relatedFindings.map((r, i) => (
              <a
                key={i}
                href={r.link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-lg border border-amber-400/10 bg-amber-400/[0.03] px-3 py-2 text-xs transition-colors hover:border-amber-400/30"
              >
                <Newspaper className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                <span className="truncate font-semibold text-foreground/70">{r.title}</span>
                <ExternalLink className="ml-auto h-3 w-3 shrink-0 text-muted-foreground/30" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Editable Team Members (C9) ─────────────────────────────

function EditableTeamMembers({
  leadId: _leadId,
  leadEmail,
  businessId,
  initialMembers,
}: {
  leadId: string;
  leadEmail: string | null;
  businessId: string | null;
  initialMembers: TeamMember[];
}) {
  const [contacts, setContacts] = useState<BusinessContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  // Form state for editing
  const [editName, setEditName] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');

  // Form state for adding
  const [addName, setAddName] = useState('');
  const [addTitle, setAddTitle] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addPhone, setAddPhone] = useState('');

  const leadEmailNormalized = normalizeEmail(leadEmail);

  // Load contacts from Supabase
  useEffect(() => {
    if (!businessId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function load() {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error } = await supabase
          .from('business_contacts')
          .select('id, businessId:business_id, name, title, email, phone, linkedinUrl:linkedin_url, seniority, positionRank:position_rank, source')
          .eq('business_id', businessId)
          .order('position_rank', { ascending: true });

        if (cancelled) return;
        if (error) {
          console.error('Failed to load business contacts:', error);
          return;
        }
        if (data) {
          setContacts(data as unknown as BusinessContactRow[]);
        }
      } catch (err) {
        if (!cancelled) console.error('Failed to load contacts:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [businessId]);

  // Merge contacts from Supabase + lead's topCandidates (dedup by email)
  const allMembers = useMemo(() => {
    const fromDb: TeamMember[] = contacts.map((c) => ({
      id: c.id,
      fullName: c.name,
      jobTitle: c.title,
      email: c.email,
      phone: c.phone,
      linkedinUrl: c.linkedinUrl,
      seniority: c.seniority,
      positionRank: c.positionRank,
      source: c.source,
      fromBusinessContacts: true,
    }));

    // Merge: prefer DB contacts, add initialMembers that aren't in DB (by email dedup)
    const dbEmails = new Set(fromDb.map((m) => normalizeEmail(m.email)).filter(Boolean));
    const merged = [...fromDb];
    for (const m of initialMembers) {
      const norm = normalizeEmail(m.email);
      if (!norm || !dbEmails.has(norm)) {
        merged.push(m);
      }
    }

    return sortTeamMembers(merged, leadEmail).ordered;
  }, [contacts, initialMembers, leadEmail]);

  const startEdit = (member: TeamMember) => {
    setEditingId(member.id);
    setEditName(member.fullName);
    setEditTitle(member.jobTitle ?? '');
    setEditEmail(member.email ?? '');
    setEditPhone(member.phone ?? '');
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const saveEdit = async (memberId: string) => {
    if (!editName.trim()) {
      toast.error('Name is required');
      return;
    }
    setSavingId(memberId);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase
        .from('business_contacts')
        .update({
          name: editName.trim(),
          title: editTitle.trim() || null,
          email: editEmail.trim() || null,
          phone: editPhone.trim() || null,
        })
        .eq('id', memberId);

      if (error) throw error;

      setContacts((prev) =>
        prev.map((c) =>
          c.id === memberId
            ? { ...c, name: editName.trim(), title: editTitle.trim() || null, email: editEmail.trim() || null, phone: editPhone.trim() || null }
            : c,
        ),
      );
      setEditingId(null);
      toast.success('Contact updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (memberId: string, memberName: string) => {
    if (!window.confirm(`Remove ${memberName} from the team?`)) return;
    setSavingId(memberId);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase
        .from('business_contacts')
        .delete()
        .eq('id', memberId);

      if (error) throw error;

      setContacts((prev) => prev.filter((c) => c.id !== memberId));
      toast.success(`${memberName} removed`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setSavingId(null);
    }
  };

  const handleSetPrimary = async (memberId: string, memberName: string) => {
    if (!businessId) return;
    setSavingId(memberId);
    try {
      const supabase = getSupabaseBrowserClient();

      // Set all other contacts to higher position_rank
      await supabase
        .from('business_contacts')
        .update({ position_rank: 99 })
        .eq('business_id', businessId);

      // Set this one to rank 0
      const { error } = await supabase
        .from('business_contacts')
        .update({ position_rank: 0 })
        .eq('id', memberId);

      if (error) throw error;

      setContacts((prev) =>
        prev.map((c) => ({
          ...c,
          positionRank: c.id === memberId ? 0 : 99,
        })),
      );
      toast.success(`${memberName} set as primary contact`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setSavingId(null);
    }
  };

  const handleAdd = async () => {
    if (!businessId) {
      toast.error('No business linked to this lead');
      return;
    }
    if (!addName.trim()) {
      toast.error('Name is required');
      return;
    }
    setSavingId('add');
    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase
        .from('business_contacts')
        .insert({
          business_id: businessId,
          name: addName.trim(),
          title: addTitle.trim() || null,
          email: addEmail.trim() || null,
          phone: addPhone.trim() || null,
          seniority: 'other',
          position_rank: 50,
          source: 'manual',
        })
        .select('id, businessId:business_id, name, title, email, phone, linkedinUrl:linkedin_url, seniority, positionRank:position_rank, source')
        .single();

      if (error) throw error;

      if (data) {
        setContacts((prev) => [...prev, data as unknown as BusinessContactRow]);
      }
      setAddName('');
      setAddTitle('');
      setAddEmail('');
      setAddPhone('');
      setShowAddForm(false);
      toast.success(`${addName.trim()} added to team`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add contact');
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2 text-sm text-muted-foreground/50">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
          Loading team members...
        </div>
      </div>
    );
  }

  if (allMembers.length === 0 && !showAddForm) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold tracking-tight flex items-center gap-2">
            <Users className="h-4 w-4 text-amber-400" />
            Team Members
          </h2>
          {businessId && (
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-zbooni-teal/10 px-3 py-1.5 text-xs font-semibold text-zbooni-teal transition-colors hover:bg-zbooni-teal/20"
            >
              <Plus className="h-3 w-3" /> Add Member
            </button>
          )}
        </div>
        <p className="mt-3 text-sm text-muted-foreground/50">No team members found for this business.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-bold tracking-tight flex items-center gap-2">
          <Users className="h-4 w-4 text-amber-400" />
          Team Members
          <span className="ml-1 rounded-full bg-muted/20 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">{allMembers.length}</span>
        </h2>
        {businessId && (
          <button
            type="button"
            onClick={() => setShowAddForm(!showAddForm)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-zbooni-teal/10 px-3 py-1.5 text-xs font-semibold text-zbooni-teal transition-colors hover:bg-zbooni-teal/20"
          >
            <Plus className="h-3 w-3" /> Add
          </button>
        )}
      </div>

      {/* Add Form */}
      {showAddForm && (
        <div className="mb-4 rounded-xl border border-zbooni-teal/20 bg-zbooni-teal/5 p-4">
          <p className="mb-3 text-xs font-semibold text-zbooni-teal">New Team Member</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="Name *" className="h-8 rounded-lg border border-border/40 bg-zbooni-dark/30 px-3 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-zbooni-teal/30" />
            <input value={addTitle} onChange={(e) => setAddTitle(e.target.value)} placeholder="Position" className="h-8 rounded-lg border border-border/40 bg-zbooni-dark/30 px-3 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-zbooni-teal/30" />
            <input value={addEmail} onChange={(e) => setAddEmail(e.target.value)} placeholder="Email" type="email" className="h-8 rounded-lg border border-border/40 bg-zbooni-dark/30 px-3 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-zbooni-teal/30" />
            <input value={addPhone} onChange={(e) => setAddPhone(e.target.value)} placeholder="Phone" className="h-8 rounded-lg border border-border/40 bg-zbooni-dark/30 px-3 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-zbooni-teal/30" />
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => void handleAdd()} disabled={savingId === 'add'} className="inline-flex items-center gap-1.5 rounded-lg bg-zbooni-teal/20 px-3 py-1.5 text-xs font-semibold text-zbooni-teal transition-colors hover:bg-zbooni-teal/30 disabled:opacity-50">
              {savingId === 'add' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Add
            </button>
            <button type="button" onClick={() => setShowAddForm(false)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Team member cards */}
      <div className="grid gap-2.5 sm:grid-cols-2">
        {allMembers.map((tm, idx) => {
          const isPrimary = leadEmailNormalized
            ? normalizeEmail(tm.email) === leadEmailNormalized
            : idx === 0;
          const isDecisionMaker = isExecutiveOrDirector(tm);
          const seniorityLabel = tm.seniority ? tm.seniority.charAt(0).toUpperCase() + tm.seniority.slice(1) : null;
          const isEditing = editingId === tm.id;
          const isFromDb = tm.fromBusinessContacts;
          const isSaving = savingId === tm.id;

          if (isEditing) {
            return (
              <div key={tm.id} className="rounded-lg border border-zbooni-teal/30 bg-zbooni-teal/5 p-3">
                <div className="space-y-2">
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Name *" className="h-7 w-full rounded-md border border-border/40 bg-zbooni-dark/30 px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-zbooni-teal/30" />
                  <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="Position" className="h-7 w-full rounded-md border border-border/40 bg-zbooni-dark/30 px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-zbooni-teal/30" />
                  <input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="Email" type="email" className="h-7 w-full rounded-md border border-border/40 bg-zbooni-dark/30 px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-zbooni-teal/30" />
                  <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="Phone" className="h-7 w-full rounded-md border border-border/40 bg-zbooni-dark/30 px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-zbooni-teal/30" />
                  <div className="flex gap-2">
                    <button type="button" onClick={() => void saveEdit(tm.id)} disabled={isSaving} className="inline-flex items-center gap-1 rounded-md bg-zbooni-teal/20 px-2 py-1 text-[10px] font-semibold text-zbooni-teal hover:bg-zbooni-teal/30 disabled:opacity-50">
                      {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      Save
                    </button>
                    <button type="button" onClick={cancelEdit} className="rounded-md px-2 py-1 text-[10px] font-semibold text-muted-foreground hover:text-foreground">
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div key={tm.id} className="group rounded-lg border border-border/25 bg-zbooni-dark/35 p-3">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-[11px] font-bold text-amber-400">
                  {tm.fullName.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="truncate text-sm font-semibold">{tm.fullName}</p>
                    {isPrimary ? (
                      <span className="rounded-full border border-zbooni-green/40 bg-zbooni-green/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-zbooni-green">
                        Primary
                      </span>
                    ) : null}
                    {isDecisionMaker && !isPrimary ? (
                      <span className="rounded-full border border-amber-400/40 bg-amber-400/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-300">
                        Decision Maker
                      </span>
                    ) : null}
                    {seniorityLabel && seniorityLabel.toLowerCase() !== 'other' ? (
                      <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-blue-300">
                        {seniorityLabel}
                      </span>
                    ) : null}
                  </div>
                  {tm.jobTitle ? (
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground/60">{tm.jobTitle}</p>
                  ) : null}

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
                    {tm.email ? (
                      <a href={`mailto:${tm.email}`} className="inline-flex items-center gap-1 text-zbooni-teal transition-colors hover:text-zbooni-green">
                        <Mail className="h-3.5 w-3.5" />
                        <span className="font-mono">{tm.email}</span>
                      </a>
                    ) : (
                      <span className="rounded-full bg-muted/20 px-2 py-0.5 text-[10px] font-medium text-muted-foreground/60">
                        No email found
                      </span>
                    )}
                    {tm.phone ? (
                      <a href={`tel:${tm.phone}`} className="inline-flex items-center gap-1 text-muted-foreground/80 transition-colors hover:text-foreground">
                        <Phone className="h-3.5 w-3.5" />
                        {tm.phone}
                      </a>
                    ) : null}
                    {tm.linkedinUrl ? (
                      <a href={tm.linkedinUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-zbooni-teal transition-colors hover:text-zbooni-green">
                        <Linkedin className="h-3.5 w-3.5" />
                        LinkedIn
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : null}
                  </div>
                </div>

                {/* Edit/Delete/Primary buttons (only for DB-backed contacts) */}
                {isFromDb && (
                  <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    {!isPrimary && (
                      <button
                        type="button"
                        title="Set as primary"
                        onClick={() => void handleSetPrimary(tm.id, tm.fullName)}
                        disabled={isSaving}
                        className="rounded-md p-1 text-muted-foreground/40 transition-colors hover:bg-zbooni-green/10 hover:text-zbooni-green disabled:opacity-50"
                      >
                        <Star className="h-3 w-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      title="Edit"
                      onClick={() => startEdit(tm)}
                      className="rounded-md p-1 text-muted-foreground/40 transition-colors hover:bg-zbooni-teal/10 hover:text-zbooni-teal"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      title="Remove"
                      onClick={() => void handleDelete(tm.id, tm.fullName)}
                      disabled={isSaving}
                      className="rounded-md p-1 text-muted-foreground/40 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Fetch business data from Supabase by businessId (not leadId) ───
async function fetchBusinessDataFromSupabase(leadId: string): Promise<SupabaseBusinessData> {
  const empty: SupabaseBusinessData = {
    businessId: null,
    businessInsights: null,
    conversionMetadata: null,
    businessContacts: [],
    businessName: null,
    websiteDomain: null,
    instagramHandle: null,
    rating: null,
    reviewCount: null,
  };

  try {
    const supabase = getSupabaseBrowserClient();

    // Step 1: Get the lead's businessId from the Lead table
    const { data: leadRow, error: leadError } = await supabase
      .from('Lead')
      .select('businessId')
      .eq('id', leadId)
      .single();

    if (leadError || !leadRow?.businessId) return empty;

    const businessId = leadRow.businessId as string;

    // Step 2: Fetch business_conversions by businessId (not leadId — leadId can be NULL)
    const [conversionResult, contactsResult, businessResult] = await Promise.allSettled([
      supabase
        .from('business_conversions')
        .select('businessInsights, metadata')
        .eq('businessId', businessId)
        .order('createdAt', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('business_contacts')
        .select('id, name, title, email, phone, linkedinUrl, seniority, positionRank, source')
        .eq('businessId', businessId)
        .order('positionRank', { ascending: true }),
      supabase
        .from('businesses')
        .select('name, website_domain, instagram_handle, rating, review_count')
        .eq('id', businessId)
        .single(),
    ]);

    const conversion = conversionResult.status === 'fulfilled' ? conversionResult.value.data : null;
    const contacts = contactsResult.status === 'fulfilled' ? (contactsResult.value.data ?? []) : [];
    const business = businessResult.status === 'fulfilled' ? businessResult.value.data : null;

    const metadata = conversion?.metadata && typeof conversion.metadata === 'object' && !Array.isArray(conversion.metadata)
      ? conversion.metadata as Record<string, unknown>
      : null;

    return {
      businessId,
      businessInsights: conversion?.businessInsights ?? null,
      conversionMetadata: metadata,
      businessContacts: contacts.map((c: Record<string, unknown>) => ({
        id: String(c.id ?? ''),
        fullName: String(c.name ?? 'Unknown'),
        jobTitle: typeof c.title === 'string' ? c.title : null,
        email: typeof c.email === 'string' ? c.email : null,
        phone: typeof c.phone === 'string' ? c.phone : null,
        linkedinUrl: typeof c.linkedinUrl === 'string' ? c.linkedinUrl : null,
        seniority: typeof c.seniority === 'string' ? c.seniority : null,
        positionRank: typeof c.positionRank === 'number' ? c.positionRank : null,
        source: typeof c.source === 'string' ? c.source : null,
        fromBusinessContacts: true,
      })),
      businessName: business?.name ?? null,
      websiteDomain: business?.website_domain ?? null,
      instagramHandle: business?.instagram_handle ?? null,
      rating: typeof business?.rating === 'number' ? business.rating : null,
      reviewCount: typeof business?.review_count === 'number' ? business.review_count : null,
    };
  } catch {
    return empty;
  }
}

// ── Main Page Component ────────────────────────────────────

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { apiClient } = useAuth();
  const router = useRouter();

  const lead = useApiQuery(
    useCallback(() => apiClient.getLead(id), [apiClient, id]),
    [id],
  );

  // A1: Fetch business data from Supabase (by businessId, not leadId)
  const [businessData, setBusinessData] = useState<SupabaseBusinessData | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchBusinessDataFromSupabase(id).then((data) => {
      if (!cancelled) setBusinessData(data);
    });
    return () => { cancelled = true; };
  }, [id]);

  const sends = useApiQuery(
    useCallback(() => apiClient.listSends({ leadId: id, page: 1, pageSize: 50 }), [apiClient, id]),
    [id],
  );
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [backupSuccess, setBackupSuccess] = useState<string | null>(null);

  // Derive conversion data (Brave CEO, search results) from the correct businessData source
  const conversionData = useMemo<ConversionData>(() => {
    if (!businessData) return { businessInsights: null, matchedPerson: null, searchResults: [] };
    return parseConversionData({
      businessInsights: businessData.businessInsights,
      metadata: businessData.conversionMetadata,
    } as unknown as Record<string, unknown>);
  }, [businessData]);

  const maxFollowUpNumber = useMemo(() => {
    if (!sends.data?.items.length) return -1;
    return Math.max(...sends.data.items.map((s) => s.followUpNumber ?? 0));
  }, [sends.data]);

  const handleStartBackupSequence = async (contact: TeamMember) => {
    if (!contact.email) return;
    setIsCreatingBackup(true);
    try {
      const nameParts = contact.fullName.split(' ');
      const firstName = nameParts[0] ?? contact.fullName;
      const lastName = nameParts.slice(1).join(' ') || 'Unknown';
      await apiClient.createBackupLead(id, {
        firstName,
        lastName,
        email: contact.email,
        source: 'BACKUP_CONTACT_ROTATION',
      });
      setBackupSuccess(`New lead created for ${contact.fullName}. It will re-enter qualification using the source business context.`);
    } catch (err) {
      setBackupSuccess(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsCreatingBackup(false);
    }
  };

  const l = lead.data;
  const businessName = useMemo(
    () => getBusinessNameFromLead(l ?? null) ?? (businessData?.businessName || null),
    [l, businessData],
  );
  // A1+A4: Merge API candidates with Supabase business_contacts, deduplicate by email
  const teamMembers = useMemo(() => {
    const apiCandidates = buildTeamMembersFromLead(l ?? null);
    const supabaseContacts = businessData?.businessContacts ?? [];
    const seen = new Set<string>();
    const merged: TeamMember[] = [];

    // API candidates first (they come from conversion metadata)
    for (const tm of apiCandidates) {
      const key = tm.email ? tm.email.toLowerCase() : `name:${tm.fullName.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(tm);
      }
    }
    // Then Supabase business_contacts (may have more contacts)
    for (const tm of supabaseContacts) {
      const key = tm.email ? tm.email.toLowerCase() : `name:${tm.fullName.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(tm);
      }
    }
    return merged;
  }, [l, businessData]);
  const businessSummary = useMemo(() => {
    if (!l) return null;
    if (!businessName && !l.businessCategory && !l.businessCountryCode && !l.businessCity) return null;
    return {
      category: l.businessCategory ?? null,
      countryCode: l.businessCountryCode ?? null,
      city: l.businessCity ?? null,
    };
  }, [businessName, l]);
  const backupContacts = useMemo(() => {
    if (!l) return [];
    const currentEmail = l.email?.toLowerCase();
    return sortTeamMembers(teamMembers, l.email).ordered
      .filter((tm) => tm.email && tm.email.toLowerCase() !== currentEmail);
  }, [l, teamMembers]);
  const hasReply = sends.data?.items.some((s) => s.status === 'REPLIED') ?? false;
  const showBackupBanner = maxFollowUpNumber >= 3 && !hasReply && backupContacts.length > 0;
  const nextBackup = backupContacts[0];
  const hasConversationHistory = (sends.data?.items.length ?? 0) > 0;
  // A4: Build primary contact from the lead's own data and prepend to team members
  const displayTeamMembers = useMemo(() => {
    if (!l) return [];
    const sorted = sortTeamMembers(teamMembers, l.email).ordered;
    const leadEmail = l.email?.toLowerCase();
    const alreadyInList = leadEmail && sorted.some((m) => normalizeEmail(m.email) === leadEmail);

    if (alreadyInList) return sorted;

    // Create a primary contact TeamMember from the lead record
    const primaryContact: TeamMember = {
      id: `lead-primary-${l.id}`,
      fullName: [l.firstName, l.lastName].filter(Boolean).join(' ') || 'Primary Contact',
      jobTitle: getLeadTitleFromEnrichment(l.enrichmentData),
      email: l.email ?? null,
      phone: null,
      linkedinUrl: null,
      seniority: null,
      positionRank: -1,
      source: 'Lead record',
      fromBusinessContacts: false,
    };

    // Enrich with phone from enrichment data
    const enrichData = l.enrichmentData as Record<string, unknown> | null | undefined;
    if (enrichData) {
      const phone = enrichData.phone ?? enrichData.mobile_phone ?? enrichData.phone_number;
      if (typeof phone === 'string' && phone.length > 0) {
        primaryContact.phone = phone;
      }
      const linkedin = enrichData.linkedinUrl ?? enrichData.linkedin_url ?? enrichData.linkedin;
      if (typeof linkedin === 'string' && linkedin.length > 0) {
        primaryContact.linkedinUrl = linkedin;
      }
    }

    return [primaryContact, ...sorted];
  }, [l, teamMembers]);
  const sortedTeamMembers = displayTeamMembers;
  const leadEmailNormalized = normalizeEmail(l?.email);
  const leadTitle = getLeadTitleFromEnrichment(l?.enrichmentData);
  const leadMatchedTeamMember = leadEmailNormalized
    ? sortedTeamMembers.find((member) => normalizeEmail(member.email) === leadEmailNormalized) ?? null
    : null;
  const fallbackLeadTier = getTeamMemberTier(null, leadTitle);
  const primaryLeadTier = leadMatchedTeamMember
    ? getTeamMemberTier(leadMatchedTeamMember.seniority, leadMatchedTeamMember.jobTitle)
    : fallbackLeadTier;
  const executiveDirectorContacts = sortedTeamMembers.filter((member) => (
    isExecutiveOrDirector(member) &&
    normalizeEmail(member.email) !== leadEmailNormalized
  ));
  const firstExecutiveDirectorContact = executiveDirectorContacts[0] ?? null;
  const hasPrimaryAuthoritySignal = leadMatchedTeamMember !== null || Boolean(leadTitle);
  const showLowAuthorityWarning = (
    hasPrimaryAuthoritySignal &&
    primaryLeadTier >= 2 &&
    executiveDirectorContacts.length > 0
  );
  const primaryLinkedinUrl = sortedTeamMembers[0]?.linkedinUrl ?? sortedTeamMembers.find((member) => member.linkedinUrl)?.linkedinUrl ?? null;
  const enrichmentFields = l ? extractEnrichmentFields(l.enrichmentData) : [];
  const scoreInfo = l ? extractScoreInfo(l.enrichmentData) : null;

  if (lead.error) {
    return <p className="text-sm text-destructive">{lead.error}</p>;
  }

  if (lead.isLoading || !l) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
        Loading lead...
      </div>
    );
  }

  const scorePercent = scoreInfo?.blendedScore ? Math.round(scoreInfo.blendedScore * 100) : null;

  // ── Section Order (C8):
  // 1. Header
  // 2. About This Business (AI insights from C1)
  // 3. Brave Search Results (CEO card + Related Findings from C3/C4)
  // 4. Team Members (editable from C9)
  // 5. Intelligence Gathered
  // 6. Scoring Breakdown
  // 7. Message History

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() => router.back()}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to leads
      </button>

      {/* ─── Header ─── */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">
              {l.firstName} {l.lastName}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{l.email}</p>
            {businessName ? (
              <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground/70">
                <Building2 className="h-3 w-3" />
                {businessName}
              </p>
            ) : null}
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

        {/* Phone + LinkedIn */}
        {(enrichmentFields.some((f) => f.label === 'Phone') || primaryLinkedinUrl) && (
          <div className="mt-3 flex flex-wrap gap-3">
            {enrichmentFields.filter((f) => f.label === 'Phone').map((f) => (
              <div key="phone" className="flex items-center gap-2 text-sm">
                <Phone className="h-3.5 w-3.5 text-muted-foreground/50" />
                <a href={f.href ?? '#'} className="font-medium text-zbooni-teal hover:text-zbooni-green transition-colors">
                  {f.value}
                </a>
              </div>
            ))}
            {primaryLinkedinUrl && (
              <a
                href={primaryLinkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm font-medium text-zbooni-teal hover:text-zbooni-green transition-colors"
              >
                <Linkedin className="h-3.5 w-3.5 text-muted-foreground/50" />
                View LinkedIn
              </a>
            )}
          </div>
        )}

        {l.error ? (
          <div className="mt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">Error</p>
            <p className="mt-0.5 font-medium text-destructive">{l.error}</p>
          </div>
        ) : null}
      </div>

      {/* ─── 1. About This Business (C1 — AI insights) ─── */}
      {businessSummary || businessData?.businessInsights ? (
        <AboutBusinessCard
          category={businessSummary?.category ?? null}
          metaDescription={businessData?.businessInsights ?? null}
          instagramBio={null}
          countryCode={businessSummary?.countryCode ?? null}
          city={businessSummary?.city ?? null}
          rating={businessData?.rating ?? null}
          reviewCount={businessData?.reviewCount ?? null}
          businessInsights={conversionData.businessInsights}
        />
      ) : null}

      {/* ─── 2. Brave Search Results (C3 + C4 — CEO card + Related Findings) ─── */}
      <BraveSearchSection conversion={conversionData} />

      {/* Low authority warning */}
      {showLowAuthorityWarning ? (
        <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3">
          <div className="flex items-start gap-2.5 text-sm text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">
                Primary contact is non-executive. Decision makers identified below — consider reaching them directly via LinkedIn.
              </p>
              {firstExecutiveDirectorContact?.linkedinUrl ? (
                <a
                  href={firstExecutiveDirectorContact.linkedinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-amber-100 underline decoration-amber-100/60 underline-offset-2 hover:text-white"
                >
                  View {firstExecutiveDirectorContact.fullName} on LinkedIn
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* ─── 3. Team Members (C9 — fully editable) ─── */}
      <EditableTeamMembers
        leadId={id}
        leadEmail={l.email}
        businessId={businessData?.businessId ?? null}
        initialMembers={teamMembers}
      />

      {/* ─── 4. Intelligence Gathered ─── */}
      {enrichmentFields.length > 0 ? (
        <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-base font-bold tracking-tight flex items-center gap-2">
            <User className="h-4 w-4 text-zbooni-teal" />
            Intelligence Gathered
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

      {/* No enrichment data at all */}
      {!l.enrichmentData ? (
        <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
          <div className="flex items-center gap-3 text-muted-foreground/60">
            <AlertCircle className="h-5 w-5" />
            <p className="text-sm">
              {l.status === 'enriched' || l.status === 'scored' || l.status === 'qualified' || l.status === 'drafted' || l.status === 'messaged' || l.status === 'replied'
                ? 'Enrichment completed, but no normalized enrichment fields are available for this lead yet.'
                : 'No enrichment data available yet. This lead may still be processing.'}
            </p>
          </div>
        </div>
      ) : null}

      {/* ─── 5. Scoring Breakdown (C7) ─── */}
      <ScoringBreakdown
        leadId={id}
        blendedScore={scoreInfo?.blendedScore}
        scoreBand={scoreInfo?.scoreBand}
      />

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

      {/* Backup Contact Rotation Banner */}
      {showBackupBanner && nextBackup ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10">
              <RefreshCw className="h-5 w-5 text-amber-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-amber-300">
                No reply after {maxFollowUpNumber} follow-ups
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Start a new sequence with{' '}
                <strong className="text-foreground">{nextBackup.fullName}</strong>
                {nextBackup.jobTitle ? (
                  <span className="text-muted-foreground/60">, {nextBackup.jobTitle}</span>
                ) : null}
                {' '}({nextBackup.email})
              </p>
              {backupContacts.length > 1 ? (
                <p className="mt-0.5 text-[11px] text-muted-foreground/50">
                  +{backupContacts.length - 1} more backup contact{backupContacts.length > 2 ? 's' : ''} available
                </p>
              ) : null}

              {backupSuccess ? (
                <p className={`mt-2 text-xs ${backupSuccess.startsWith('Failed') ? 'text-red-400' : 'text-zbooni-green'}`}>
                  {backupSuccess}
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleStartBackupSequence(nextBackup)}
                  disabled={isCreatingBackup}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-amber-500/20 px-3.5 py-2 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-500/30 disabled:opacity-50"
                >
                  {isCreatingBackup ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Start New Sequence with {nextBackup.fullName.split(' ')[0]}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* ─── 6. Message History ─── */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-bold tracking-tight flex items-center gap-2">
            <Mail className="h-4 w-4 text-zbooni-green" />
            Message History
          </h2>
          {hasConversationHistory ? (
            <Link
              href={`/dashboard/inbox?leadId=${encodeURIComponent(id)}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <Inbox className="h-3.5 w-3.5" />
              Open in Inbox
            </Link>
          ) : null}
        </div>

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
