'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  Building2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Globe,
  Instagram,
  Linkedin,
  Loader2,
  Mail,
  MapPin,
  Monitor,
  Phone,
  Search,
  Shield,
  Users,
  X,
} from 'lucide-react';

import { AboutBusinessCard } from '@/components/about-business-card.js';
import { LeadsNav } from '@/components/leads-nav.js';
import { SocialLinkIcon } from '@/components/social-link-icon.js';
import { cn } from '@/lib/utils.js';
import { getSupabaseBrowserClient } from '@/lib/supabase-client.js';
import { countryName } from '@/lib/countries.js';
import { sortTeamMembers } from '@/lib/team-members.js';

// ── Types ──────────────────────────────────────────────────────────────────

interface BusinessRow {
  id: string;
  name: string;
  country_code: string;
  country: string | null;
  city: string | null;
  category: string | null;
  rating: number | null;
  review_count: number | null;
  follower_count: number | null;
  deterministic_score: number;
  score_band: string | null;
  has_whatsapp: boolean;
  has_instagram: boolean;
  accepts_online_payments: boolean;
  recent_activity: boolean;
  website_domain: string | null;
  phone_e164: string | null;
  instagram_handle: string | null;
  pre_qualified: boolean | null;
  disqualification_reason: string | null;
  apify_website_scrape_json: Record<string, unknown> | null;
  apify_instagram_scrape_json: Record<string, unknown> | null;
  website_scraped_at: string | null;
  instagram_scraped_at: string | null;
  created_at: string;
  updated_at: string;
  manualReviewStatus?: 'OPEN' | 'REJECTED' | null | undefined;
  manualReviewReason?: string | null | undefined;
  manualReviewUpdatedAt?: string | null | undefined;
  // Joined from business_conversions → leads
  leadBlendedScore?: number | null | undefined;
  conversionMetadata?: Record<string, unknown> | null | undefined;
}

// ── Helpers for extracting scraper intelligence ────────────────────────────

function extractDecisionMakers(scrape: Record<string, unknown>): Array<{ name: string; title: string }> {
  const raw = scrape.decisionMakers;
  if (!Array.isArray(raw)) return [];
  return raw.filter((dm): dm is { name: string; title: string } => dm && typeof dm.name === 'string').slice(0, 10);
}

function extractSocialLinks(scrape: Record<string, unknown>): Array<{ platform: string; url: string }> {
  const raw = scrape.socialLinks;
  if (!Array.isArray(raw)) return [];
  return raw.filter((sl): sl is { platform: string; url: string } => sl && typeof sl.platform === 'string').slice(0, 10);
}

function extractTechStack(scrape: Record<string, unknown>): Array<{ category: string; technologies: string[] }> {
  // New adapter format: technologies is an object { analytics: [], crm: [], ... }
  const techObj = scrape.technologies;
  if (techObj && typeof techObj === 'object' && !Array.isArray(techObj)) {
    return Object.entries(techObj as Record<string, unknown>)
      .filter(([, techs]) => Array.isArray(techs) && techs.length > 0)
      .map(([category, techs]) => ({ category, technologies: techs as string[] }))
      .slice(0, 10);
  }
  // Legacy format: techStack is an array of { category, technologies[] }
  const raw = scrape.techStack;
  if (!Array.isArray(raw)) return [];
  return raw.filter((ts): ts is { category: string; technologies: string[] } => ts && typeof ts.category === 'string').slice(0, 10);
}

function extractCertifications(scrape: Record<string, unknown>): string[] {
  // New format: businessSignals.certifications
  const signals = scrape.businessSignals as Record<string, unknown> | undefined;
  if (signals && Array.isArray(signals.certifications)) {
    return signals.certifications.filter((c): c is string => typeof c === 'string').slice(0, 10);
  }
  // Legacy format: top-level certifications
  const raw = scrape.certifications;
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is string => typeof c === 'string').slice(0, 10);
}

function extractContactInfo(scrape: Record<string, unknown>): { emails: string[]; phones: string[]; addresses: string[] } {
  // New format: contactInfo.emails[{email}] / contactInfo.phones[{number}] / contactInfo.addresses[{text}]
  const ci = scrape.contactInfo;
  if (ci && typeof ci === 'object') {
    const c = ci as Record<string, unknown>;
    const emails = Array.isArray(c.emails)
      ? c.emails.map((e: unknown) => (e && typeof e === 'object' && 'email' in (e as Record<string, unknown>)) ? String((e as Record<string, unknown>).email) : typeof e === 'string' ? e : null).filter((e): e is string => e !== null)
      : [];
    const phones = Array.isArray(c.phones)
      ? c.phones.map((p: unknown) => (p && typeof p === 'object' && 'number' in (p as Record<string, unknown>)) ? String((p as Record<string, unknown>).number) : typeof p === 'string' ? p : null).filter((p): p is string => p !== null)
      : [];
    const addresses = Array.isArray(c.addresses)
      ? c.addresses.map((a: unknown) => (a && typeof a === 'object' && 'text' in (a as Record<string, unknown>)) ? String((a as Record<string, unknown>).text) : typeof a === 'string' ? a : null).filter((a): a is string => a !== null)
      : [];
    if (emails.length > 0 || phones.length > 0 || addresses.length > 0) {
      return { emails, phones, addresses };
    }
  }
  // Legacy format: flat arrays of strings at top level
  const emails = Array.isArray(scrape.emails) ? scrape.emails.filter((e): e is string => typeof e === 'string') : [];
  const phones = Array.isArray(scrape.phones) ? scrape.phones.filter((p): p is string => typeof p === 'string') : [];
  const addresses = Array.isArray(scrape.addresses) ? scrape.addresses.filter((a): a is string => typeof a === 'string') : [];
  return { emails, phones, addresses };
}

function extractInstagramData(scrape: Record<string, unknown>): {
  isVerified: boolean;
  businessCategory: string | null;
  businessEmail: string | null;
  businessPhone: string | null;
  mediaCount: number | null;
  isProfessional: boolean;
  bio: string | null;
} {
  return {
    isVerified: Boolean(scrape.isVerified),
    businessCategory: (scrape.businessCategory as string) ?? null,
    businessEmail: (scrape.businessEmail as string) ?? null,
    businessPhone: (scrape.businessPhone as string) ?? null,
    mediaCount: typeof scrape.mediaCount === 'number' ? scrape.mediaCount : null,
    isProfessional: Boolean(scrape.isProfessionalAccount),
    bio: (scrape.biography as string) ?? (scrape.bio as string) ?? null,
  };
}

function extractInstagramPosts(scrape: Record<string, unknown>): Array<{ caption: string; likes: number; comments: number; timestamp: string; url: string | null }> {
  const raw = scrape.recentPosts;
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 6).map((p: unknown) => {
    const post = p as Record<string, unknown>;
    return {
      caption: typeof post.caption === 'string' ? post.caption : '',
      likes: typeof post.likes === 'number' ? post.likes : (typeof post.likesCount === 'number' ? post.likesCount : 0),
      comments: typeof post.comments === 'number' ? post.comments : (typeof post.commentsCount === 'number' ? post.commentsCount : 0),
      timestamp: typeof post.timestamp === 'string' ? post.timestamp : (typeof post.takenAtTimestamp === 'string' ? post.takenAtTimestamp : ''),
      url: typeof post.url === 'string' ? post.url : (typeof post.shortCode === 'string' ? `https://instagram.com/p/${post.shortCode}` : null),
    };
  });
}

interface BusinessContact {
  id: string;
  fullName: string;
  jobTitle: string | null;
  email: string | null;
  linkedinUrl: string | null;
  source: string | null;
}

// ── Business name cleanup ────────────────────────────────────────────────────

const SLOGAN_WORDS = /\b(buying|selling|since|company in|llc|ltd|inc|corp|gmbh|pvt|services for|your|best|top|leading|premier|official|welcome to)\b/i;
const MAX_NAME_LENGTH = 60;

function cleanBusinessName(rawName: string): string {
  let name = rawName.trim();

  // Split on common separators
  const pipeSegments = name.split(/\s*\|\s*/);
  const dashSegments = name.split(/\s*[-–—]\s*/);

  if (pipeSegments.length > 1) {
    // For pipe separators: keep first two segments max
    name = pipeSegments.slice(0, 2).join(' | ');
  } else if (dashSegments.length > 1) {
    // For dash separators: keep first segment, drop if rest looks like slogan
    const rest = dashSegments.slice(1).join(' - ');
    if (SLOGAN_WORDS.test(rest)) {
      name = dashSegments[0]!;
    } else {
      name = dashSegments.slice(0, 2).join(' - ');
    }
  } else {
    // For comma-separated service lists: keep first two items
    const commaSegments = name.split(/\s*,\s*/);
    if (commaSegments.length > 2) {
      name = commaSegments.slice(0, 2).join(' | ');
    }
  }

  // Trim trailing periods, commas, whitespace
  name = name.replace(/[.,\s]+$/, '');

  // Max length truncation
  if (name.length > MAX_NAME_LENGTH) {
    name = name.slice(0, MAX_NAME_LENGTH - 3).replace(/\s+\S*$/, '') + '...';
  }

  return name;
}

// ── Score badge ──────────────────────────────────────────────────────────────

function ScoreBadge({ score, band, leadScore }: { score: number; band: string | null; leadScore?: number | null | undefined }) {
  // Prefer lead's blended score over pre-qualification deterministic score
  if (leadScore != null) {
    const pct = Math.round(leadScore * 100);
    const leadBand = leadScore >= 0.7 ? 'HIGH' : leadScore >= 0.4 ? 'MEDIUM' : 'LOW';
    const color = leadBand === 'HIGH' ? 'text-zbooni-green bg-zbooni-green/10' : leadBand === 'MEDIUM' ? 'text-yellow-400 bg-yellow-400/10' : 'text-red-400 bg-red-400/10';
    return (
      <span className={cn('rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider', color)}>
        {pct}% {leadBand}
      </span>
    );
  }
  if (score === 0) {
    return (
      <span className="rounded-md bg-muted/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50">
        Not scored
      </span>
    );
  }
  const color = band === 'HIGH' ? 'text-zbooni-green bg-zbooni-green/10' : band === 'MEDIUM' ? 'text-yellow-400 bg-yellow-400/10' : 'text-red-400 bg-red-400/10';
  return (
    <span className={cn('rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider', color)}>
      {score.toFixed(2)} {band ?? ''}
    </span>
  );
}

// ── Business card (list view) ────────────────────────────────────────────────

function BusinessCard({ biz, isSelected, onSelect }: { biz: BusinessRow; isSelected: boolean; onSelect: () => void }) {
  const websiteScrape = biz.apify_website_scrape_json;
  const techCount = websiteScrape ? extractTechStack(websiteScrape).reduce((sum, cat) => sum + cat.technologies.length, 0) : 0;
  const decisionMakers = websiteScrape ? extractDecisionMakers(websiteScrape).length : 0;
  const socialCount = websiteScrape ? extractSocialLinks(websiteScrape).length : 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-xl border p-4 text-left transition-all duration-200',
        isSelected
          ? 'border-zbooni-teal/40 bg-zbooni-teal/[0.04] shadow-[0_0_20px_rgba(60,200,224,0.06)]'
          : 'border-border/30 bg-zbooni-dark/20 hover:border-border/50 hover:bg-zbooni-dark/40',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold tracking-tight truncate">{cleanBusinessName(biz.name)}</p>
          <p className="text-[11px] text-muted-foreground/60">{biz.category ?? 'Uncategorized'}</p>
        </div>
        <ScoreBadge score={biz.deterministic_score} band={biz.score_band} leadScore={biz.leadBlendedScore} />
      </div>
      <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground/40">
        <span className="flex items-center gap-1"><Globe className="h-3 w-3" />{countryName(biz.country_code)}{biz.city ? ` / ${biz.city}` : ''}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {biz.has_whatsapp && <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">WA</span>}
        {biz.has_instagram && <span className="rounded-full bg-pink-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-pink-400">IG</span>}
        {biz.website_domain && <span className="rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-blue-400">Web</span>}
        {biz.manualReviewStatus === 'OPEN' && (
          <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
            Manual Review
          </span>
        )}
        {techCount > 0 && <span className="rounded-full bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-purple-400">{techCount} tech</span>}
        {decisionMakers > 0 && <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">{decisionMakers} DM</span>}
        {socialCount > 0 && <span className="rounded-full bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-400">{socialCount} social</span>}
      </div>
    </button>
  );
}

// ── Collapsible section ──────────────────────────────────────────────────────

function Section({ title, icon: Icon, iconColor, count, children, defaultOpen }: { title: string; icon: React.ComponentType<{ className?: string | undefined }>; iconColor: string; count?: number | undefined; children: React.ReactNode; defaultOpen?: boolean | undefined }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div className="rounded-xl border border-border/30 bg-zbooni-dark/20">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-4 py-3 text-left">
        <Icon className={cn('h-4 w-4', iconColor)} />
        <span className="flex-1 text-sm font-bold tracking-tight">{title}</span>
        {count !== undefined && <span className="rounded-full bg-muted/20 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">{count}</span>}
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/40" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40" />}
      </button>
      {open && <div className="border-t border-border/20 px-4 py-3">{children}</div>}
    </div>
  );
}

// ── Detail panel ─────────────────────────────────────────────────────────────

function mergeSocialLinksForBiz(
  websiteScrape: Record<string, unknown> | null,
  instagramHandle: string | null,
  instagramScrape: Record<string, unknown> | null,
): Array<{ platform: string; url: string }> {
  const links: Array<{ platform: string; url: string }> = [];
  const seen = new Set<string>();
  if (websiteScrape) {
    for (const sl of extractSocialLinks(websiteScrape)) {
      const key = sl.platform.toLowerCase();
      if (!seen.has(key)) { seen.add(key); links.push(sl); }
    }
  }
  if (instagramHandle && !seen.has('instagram')) {
    seen.add('instagram');
    links.push({ platform: 'Instagram', url: `https://instagram.com/${instagramHandle}` });
  }
  if (instagramScrape && !seen.has('instagram')) {
    const handle = instagramScrape.username as string | undefined;
    if (handle) { seen.add('instagram'); links.push({ platform: 'Instagram', url: `https://instagram.com/${handle}` }); }
  }
  return links;
}

function ApolloOrgIntelCardBiz({ data }: { data: unknown }) {
  if (!data || typeof data !== 'object') return null;
  const org = data as Record<string, unknown>;
  const hasAnyField = org.industry || org.estimatedEmployees || org.foundedYear || org.annualRevenue || org.primaryPhone || org.linkedinUrl || org.country;
  if (!hasAnyField) return null;

  return (
    <div className="mt-4 rounded-xl border border-border/30 bg-zbooni-dark/30 p-4">
      <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-2">
        <Building2 className="h-3.5 w-3.5 text-zbooni-teal" />
        Company Intel (Apollo)
      </h3>
      <div className="space-y-2 text-sm">
        {typeof org.industry === 'string' && org.industry && (
          <div className="flex justify-between">
            <span className="text-muted-foreground/60">Industry</span>
            <span>{org.industry}</span>
          </div>
        )}
        {typeof org.estimatedEmployees === 'number' && (
          <div className="flex justify-between">
            <span className="text-muted-foreground/60">Employees</span>
            <span>{org.estimatedEmployees.toLocaleString()}</span>
          </div>
        )}
        {typeof org.foundedYear === 'number' && (
          <div className="flex justify-between">
            <span className="text-muted-foreground/60">Founded</span>
            <span>{org.foundedYear}</span>
          </div>
        )}
        {typeof org.annualRevenue === 'string' && org.annualRevenue && (
          <div className="flex justify-between">
            <span className="text-muted-foreground/60">Revenue</span>
            <span>{org.annualRevenue}</span>
          </div>
        )}
        {typeof org.primaryPhone === 'string' && org.primaryPhone && (
          <div className="flex justify-between">
            <span className="text-muted-foreground/60">Phone</span>
            <span className="font-mono text-xs">{org.primaryPhone}</span>
          </div>
        )}
        {typeof org.linkedinUrl === 'string' && org.linkedinUrl && (
          <div className="flex justify-between">
            <span className="text-muted-foreground/60">LinkedIn</span>
            <a href={org.linkedinUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-zbooni-teal transition-colors hover:text-zbooni-green truncate max-w-[200px]">
              Company Profile <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          </div>
        )}
        {typeof org.country === 'string' && org.country && (
          <div className="flex justify-between">
            <span className="text-muted-foreground/60">Location</span>
            <span>{[typeof org.city === 'string' ? org.city : null, org.country].filter(Boolean).join(', ')}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function BusinessDetailPanel({ biz, contacts, onClose }: { biz: BusinessRow; contacts: BusinessContact[]; onClose: () => void }) {
  const orderedContacts = useMemo(() => sortTeamMembers(contacts).ordered, [contacts]);
  const websiteScrape = biz.apify_website_scrape_json;
  const instagramScrape = biz.apify_instagram_scrape_json;

  const decisionMakers = websiteScrape ? extractDecisionMakers(websiteScrape) : [];
  const mergedSocialLinks = mergeSocialLinksForBiz(websiteScrape, biz.instagram_handle, instagramScrape);
  const techStack = websiteScrape ? extractTechStack(websiteScrape) : [];
  const certifications = websiteScrape ? extractCertifications(websiteScrape) : [];
  const contactInfo = websiteScrape ? extractContactInfo(websiteScrape) : { emails: [], phones: [], addresses: [] };
  const igData = instagramScrape ? extractInstagramData(instagramScrape) : null;
  const igPosts = instagramScrape ? extractInstagramPosts(instagramScrape) : [];

  // Merge IG business contact info into contact methods
  const allEmails = [...contactInfo.emails];
  if (igData?.businessEmail && !allEmails.includes(igData.businessEmail)) {
    allEmails.push(igData.businessEmail);
  }
  const allPhones = [...contactInfo.phones];
  if (igData?.businessPhone && !allPhones.includes(igData.businessPhone)) {
    allPhones.push(igData.businessPhone);
  }

  // Instagram incomplete warning
  const igIncomplete = biz.instagram_handle && (
    !instagramScrape ||
    (instagramScrape.isVerified == null && instagramScrape.businessCategory == null)
  );

  // Extract descriptions for about card
  const websiteDescription = biz.conversionMetadata
    ? ((biz.conversionMetadata.websiteDescription as string) ?? null)
    : null;
  const metaDescription = websiteScrape
    ? ((websiteScrape.metaDescription as string) ?? null)
    : null;
  const igBio = igData?.bio ?? null;

  return (
    <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b border-border/30 pb-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-zbooni-teal" />
            <h2 className="text-lg font-extrabold tracking-tight truncate">{cleanBusinessName(biz.name)}</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground/60">{biz.category ?? 'Uncategorized'} &middot; {countryName(biz.country_code)}{biz.city ? `, ${biz.city}` : ''}</p>
        </div>
        <div className="flex items-center gap-3">
          <ScoreBadge score={biz.deterministic_score} band={biz.score_band} leadScore={biz.leadBlendedScore} />
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-muted-foreground/40 hover:bg-muted/10 hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
      </div>

      {/* D2: About This Business */}
      <div className="mt-4">
        <AboutBusinessCard
          category={biz.category}
          websiteDescription={websiteDescription}
          metaDescription={metaDescription}
          instagramBio={igBio}
          countryCode={biz.country_code}
          city={biz.city}
          rating={biz.rating}
          reviewCount={biz.review_count}
        />
      </div>

      {/* Company Intel (Apollo org enrichment from conversion metadata) */}
      <ApolloOrgIntelCardBiz data={biz.conversionMetadata?.apolloOrgEnrichment} />

      {/* Quick stats */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-border/20 bg-slate-800 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Followers</p>
          <p className="mt-0.5 text-sm font-bold">{biz.follower_count ? biz.follower_count.toLocaleString() : 'N/A'}</p>
        </div>
        <div className="rounded-lg border border-border/20 bg-slate-800 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Qualification</p>
          <p className={cn('mt-0.5 text-sm font-bold', biz.pre_qualified ? 'text-zbooni-green' : biz.pre_qualified === false ? 'text-red-400' : 'text-muted-foreground/60')}>
            {biz.pre_qualified ? 'Qualified' : biz.pre_qualified === false ? 'Disqualified' : 'Pending'}
          </p>
          {biz.manualReviewStatus === 'OPEN' ? (
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
              Manual Review Queue
            </p>
          ) : null}
        </div>
      </div>

      {biz.disqualification_reason ? (
        <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">{biz.disqualification_reason}</div>
      ) : null}
      {biz.manualReviewStatus === 'OPEN' ? (
        <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Sales manual review required: {biz.manualReviewReason === 'NO_EMAIL' ? 'decision maker found but no sendable email' : 'no confident decision maker with sendable contact'}
        </div>
      ) : null}

      {/* Contact info */}
      <div className="mt-4 flex flex-wrap gap-3 text-xs">
        {biz.website_domain && (
          <a
            href={`https://${biz.website_domain}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 rounded-full border border-border/30 px-2.5 py-1 text-zbooni-teal transition-colors hover:border-zbooni-teal/40 hover:text-zbooni-green"
          >
            <Globe className="h-3 w-3" />{biz.website_domain}<ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
        {biz.phone_e164 && (
          <a
            href={`tel:${biz.phone_e164}`}
            className="flex items-center gap-1 rounded-full border border-border/30 px-2.5 py-1 text-muted-foreground transition-colors hover:border-border/50 hover:text-foreground"
          >
            <Phone className="h-3 w-3" />{biz.phone_e164}
          </a>
        )}
        {biz.instagram_handle && (
          <a
            href={`https://instagram.com/${biz.instagram_handle}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 rounded-full border border-border/30 px-2.5 py-1 text-pink-400 transition-colors hover:border-pink-400/40 hover:text-pink-300"
          >
            <Instagram className="h-3 w-3" />@{biz.instagram_handle}<ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </div>

      {/* D10: Instagram cookie expiry warning */}
      {igIncomplete ? (
        <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          <div className="flex items-center gap-2 text-xs text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>Instagram insights are partial right now. Session credentials likely need refresh.</span>
          </div>
        </div>
      ) : null}

      {/* Intelligence sections */}
      <div className="mt-5 space-y-3">
        {/* Decision Makers */}
        {decisionMakers.length > 0 && (
          <Section title="Decision Makers" icon={Users} iconColor="text-amber-400" count={decisionMakers.length} defaultOpen>
            <div className="space-y-2">
              {decisionMakers.map((dm, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-[11px] font-bold text-amber-400">{dm.name.charAt(0)}</div>
                  <div>
                    <p className="text-sm font-semibold">{dm.name}</p>
                    <p className="text-[11px] text-muted-foreground/50">{dm.title}</p>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Tech Stack */}
        {techStack.length > 0 && (
          <Section title="Technology Stack" icon={Monitor} iconColor="text-purple-400" count={techStack.reduce((s, c) => s + c.technologies.length, 0)} defaultOpen>
            <div className="space-y-3">
              {techStack.map((cat) => (
                <div key={cat.category}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">{cat.category}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {cat.technologies.map((tech) => (
                      <span key={tech} className="rounded-full bg-purple-500/10 px-2 py-0.5 text-[11px] font-semibold text-purple-300">{tech}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Social Links (D5: icons, D7: merged) */}
        {mergedSocialLinks.length > 0 && (
          <Section title="Social Media" icon={ExternalLink} iconColor="text-cyan-400" count={mergedSocialLinks.length}>
            <div className="space-y-1.5">
              {mergedSocialLinks.map((sl, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <SocialLinkIcon platform={sl.platform} className="h-3.5 w-3.5 text-muted-foreground/50" />
                  <span className="w-20 text-[11px] font-semibold uppercase text-muted-foreground/50">{sl.platform}</span>
                  <a
                    href={sl.url.startsWith('http') ? sl.url : `https://${sl.url}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 truncate font-mono text-xs text-zbooni-teal transition-colors hover:text-zbooni-green"
                  >
                    {sl.url}<ExternalLink className="h-2.5 w-2.5 shrink-0" />
                  </a>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Certifications */}
        {certifications.length > 0 && (
          <Section title="Certifications" icon={Shield} iconColor="text-emerald-400" count={certifications.length}>
            <div className="flex flex-wrap gap-1.5">
              {certifications.map((cert) => (
                <span key={cert} className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">{cert}</span>
              ))}
            </div>
          </Section>
        )}

        {/* Contact Methods (D6: emails + phones) */}
        {(allEmails.length > 0 || allPhones.length > 0) && (
          <Section title="Contact Methods" icon={Mail} iconColor="text-blue-400" count={allEmails.length + allPhones.length}>
            <div className="space-y-2 text-xs">
              {allEmails.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground/40">Emails</p>
                  {allEmails.map((e) => <a key={e} href={`mailto:${e}`} className="block font-mono text-zbooni-teal transition-colors hover:text-zbooni-green">{e}</a>)}
                </div>
              )}
              {allPhones.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground/40">Phones</p>
                  {allPhones.map((p) => <a key={p} href={`tel:${p}`} className="block font-mono text-foreground/70 transition-colors hover:text-foreground">{p}</a>)}
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Location (D6: addresses separate) */}
        {contactInfo.addresses.length > 0 && (
          <Section title="Location" icon={MapPin} iconColor="text-blue-400" count={contactInfo.addresses.length}>
            <div className="space-y-1 text-xs">
              {contactInfo.addresses.map((a) => <p key={a} className="text-foreground/70">{a}</p>)}
            </div>
          </Section>
        )}

        {/* Instagram Analytics */}
        {igData && instagramScrape && (
          <Section title="Instagram Analytics" icon={Instagram} iconColor="text-pink-400" defaultOpen={igData.isVerified || igData.isProfessional}>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase text-muted-foreground/40">Verified</p>
                <p className={cn('text-sm font-bold', igData.isVerified ? 'text-blue-400' : 'text-muted-foreground/50')}>{igData.isVerified ? 'Yes' : 'No'}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase text-muted-foreground/40">Professional</p>
                <p className={cn('text-sm font-bold', igData.isProfessional ? 'text-zbooni-green' : 'text-muted-foreground/50')}>{igData.isProfessional ? 'Yes' : 'No'}</p>
              </div>
              {igData.businessCategory && (
                <div className="col-span-2">
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground/40">Business Category</p>
                  <p className="text-sm font-bold">{igData.businessCategory}</p>
                </div>
              )}
              {igData.mediaCount !== null && (
                <div>
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground/40">Media Count</p>
                  <p className="text-sm font-bold">{igData.mediaCount.toLocaleString()}</p>
                </div>
              )}
              {igData.bio && (
                <div className="col-span-2">
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground/40">Bio</p>
                  <p className="text-xs text-foreground/70 whitespace-pre-wrap">{igData.bio}</p>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Instagram Recent Posts */}
        {igPosts.length > 0 && (
          <Section title="Recent Instagram Posts" icon={Instagram} iconColor="text-pink-400" count={igPosts.length}>
            <div className="space-y-2">
              {igPosts.map((post, i) => (
                <div key={i} className="rounded-lg border border-border/20 bg-slate-800 px-3 py-2">
                  <p className="text-xs text-foreground/70 line-clamp-2">{post.caption || 'No caption'}</p>
                  <div className="mt-1.5 flex items-center gap-3 text-[10px] text-muted-foreground/40">
                    <span>{post.likes.toLocaleString()} likes</span>
                    <span>{post.comments.toLocaleString()} comments</span>
                    {post.timestamp ? <span>{new Date(post.timestamp).toLocaleDateString()}</span> : null}
                    {post.url ? (
                      <a href={post.url} target="_blank" rel="noopener noreferrer" className="ml-auto flex items-center gap-0.5 text-pink-400 hover:text-pink-300 transition-colors">
                        View <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Team Members (D8: primary/alternative badges + source) */}
        {orderedContacts.length > 0 && (
          <Section title="Team Members" icon={Users} iconColor="text-amber-400" count={orderedContacts.length} defaultOpen>
            <div className="space-y-2">
              {orderedContacts.map((tm, idx) => (
                <div key={tm.id} className="flex items-center gap-3 rounded-lg border border-border/20 bg-slate-800 px-3 py-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-500/10 text-[10px] font-bold text-amber-400">{tm.fullName.charAt(0)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs font-semibold truncate">{tm.fullName}</p>
                      {idx === 0 ? (
                        <span className="shrink-0 rounded-full bg-zbooni-green/15 px-1.5 py-0.5 text-[9px] font-bold text-zbooni-green">Primary</span>
                      ) : (
                        <span className="shrink-0 rounded-full bg-muted/20 px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground/50">Alternative</span>
                      )}
                    </div>
                    {tm.jobTitle ? <p className="text-[10px] text-muted-foreground/50 truncate">{tm.jobTitle}</p> : null}
                    {tm.email ? <p className="truncate font-mono text-[10px] text-foreground/75">{tm.email}</p> : null}
                    {tm.source ? <p className="text-[9px] text-muted-foreground/30">{tm.source}</p> : null}
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    {tm.email ? (
                      <a href={`mailto:${tm.email}`} title={tm.email} className="text-muted-foreground/40 hover:text-zbooni-teal transition-colors">
                        <Mail className="h-3 w-3" />
                      </a>
                    ) : null}
                    {tm.linkedinUrl ? (
                      <a href={tm.linkedinUrl} target="_blank" rel="noopener noreferrer" title="LinkedIn" className="text-muted-foreground/40 hover:text-zbooni-teal transition-colors">
                        <Linkedin className="h-3 w-3" />
                      </a>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Scraped timestamps */}
        <div className="flex gap-4 text-[10px] text-muted-foreground/30">
          {biz.website_scraped_at && <span>Website scraped: {new Date(biz.website_scraped_at).toLocaleDateString()}</span>}
          {biz.instagram_scraped_at && <span>Instagram scraped: {new Date(biz.instagram_scraped_at).toLocaleDateString()}</span>}
        </div>

        {/* No intelligence available */}
        {!websiteScrape && !instagramScrape && (
          <div className="flex flex-col items-center py-8 text-center">
            <MapPin className="h-8 w-8 text-muted-foreground/20" />
            <p className="mt-2 text-sm text-muted-foreground/50">No scraper data available</p>
            <p className="mt-1 text-[11px] text-muted-foreground/30">This business has not been scraped yet. Data appears after the enrichment pipeline runs.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function BusinessIntelligencePage() {
  const searchParams = useSearchParams();
  const [businesses, setBusinesses] = useState<BusinessRow[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('selected'));
  const [selectedContacts, setSelectedContacts] = useState<BusinessContact[]>([]);
  const [page, setPage] = useState(1);
  const pageSize = 30;

  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchBusinesses = useCallback(async (pageNum: number, search: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const from = (pageNum - 1) * pageSize;
      const to = from + pageSize - 1;

      let query = supabase
        .from('businesses')
        .select(
          'id,name,country_code,country,city,category,rating,review_count,follower_count,deterministic_score,score_band,has_whatsapp,has_instagram,accepts_online_payments,recent_activity,website_domain,phone_e164,instagram_handle,pre_qualified,disqualification_reason,apify_website_scrape_json,apify_instagram_scrape_json,website_scraped_at,instagram_scraped_at,created_at,updated_at',
          { count: 'exact' },
        );

      // D11: Server-side search
      if (search) {
        query = query.or(`name.ilike.%${search}%,category.ilike.%${search}%,website_domain.ilike.%${search}%,city.ilike.%${search}%,instagram_handle.ilike.%${search}%`);
      }

      const { data, error: fetchError, count } = await query
        .order('deterministic_score', { ascending: false })
        .order('updated_at', { ascending: false })
        .range(from, to);

      if (fetchError) throw new Error(fetchError.message);

      let rows = (data ?? []) as BusinessRow[];

      // Track which businesses have recovery items and which have converted leads
      const recoveryBizIds = new Set<string>();
      const convertedBizIds = new Set<string>();

      if (rows.length > 0) {
        const bizIds = rows.map((row) => row.id);

        // Fetch recovery items
        const { data: recoveryRows } = await supabase
          .from('contact_recovery_items')
          .select('business_id,status,reason,updated_at')
          .in('business_id', bizIds)
          .order('updated_at', { ascending: false });

        if (recoveryRows && recoveryRows.length > 0) {
          const latestByBusiness = new Map<string, { status: 'OPEN' | 'REJECTED'; reason: string; updated_at: string }>();
          for (const row of recoveryRows as Array<{ business_id: string; status: 'OPEN' | 'REJECTED'; reason: string; updated_at: string }>) {
            recoveryBizIds.add(row.business_id);
            if (!latestByBusiness.has(row.business_id)) {
              latestByBusiness.set(row.business_id, row);
            }
          }
          for (const businessRow of rows) {
            const recovery = latestByBusiness.get(businessRow.id);
            businessRow.manualReviewStatus = recovery?.status ?? null;
            businessRow.manualReviewReason = recovery?.reason ?? null;
            businessRow.manualReviewUpdatedAt = recovery?.updated_at ?? null;
          }
        }

        // Fetch lead blended scores + conversion metadata via business_conversions → leads
        const { data: conversions } = await supabase
          .from('business_conversions')
          .select('business_id, lead_id, metadata')
          .in('business_id', bizIds);

        if (conversions && conversions.length > 0) {
          // Build businessId → conversion metadata map (take first conversion)
          const bizMetadataMap = new Map<string, Record<string, unknown>>();
          for (const conv of conversions as Array<{ business_id: string; lead_id: string; metadata: Record<string, unknown> | null }>) {
            convertedBizIds.add(conv.business_id);
            if (conv.metadata && !bizMetadataMap.has(conv.business_id)) {
              bizMetadataMap.set(conv.business_id, conv.metadata);
            }
          }

          const leadIds = [...new Set(conversions.map((c: { lead_id: string }) => c.lead_id))];
          const { data: leads } = await supabase
            .from('leads')
            .select('id, enrichment_data')
            .in('id', leadIds);

          if (leads) {
            // Build leadId → blendedScore map
            const leadScoreMap = new Map<string, number>();
            for (const lead of leads) {
              const ed = lead.enrichment_data as Record<string, unknown> | null;
              if (ed?._scoreInfo && typeof ed._scoreInfo === 'object') {
                const si = ed._scoreInfo as Record<string, unknown>;
                if (typeof si.blendedScore === 'number') {
                  leadScoreMap.set(lead.id, si.blendedScore);
                }
              }
            }

            // Build businessId → leadId map (take first conversion)
            const bizLeadMap = new Map<string, string>();
            for (const conv of conversions) {
              const c = conv as { business_id: string; lead_id: string };
              if (!bizLeadMap.has(c.business_id)) {
                bizLeadMap.set(c.business_id, c.lead_id);
              }
            }

            // Merge scores + conversion metadata into business rows
            for (const row of rows) {
              const leadId = bizLeadMap.get(row.id);
              if (leadId) {
                row.leadBlendedScore = leadScoreMap.get(leadId) ?? null;
              }
              row.conversionMetadata = bizMetadataMap.get(row.id) ?? null;
            }
          }
        }

        // B4: Filter out businesses that are ONLY in contact recovery (no converted lead).
        // Edge case: if a business has BOTH a converted lead AND a recovery item, keep it (lead takes precedence).
        rows = rows.filter((row) => {
          const hasRecovery = recoveryBizIds.has(row.id);
          const hasLead = convertedBizIds.has(row.id);
          // Exclude if recovery-only (no lead)
          if (hasRecovery && !hasLead) return false;
          return true;
        });
      }

      setBusinesses(rows);
      // Adjust total count to reflect filtered results
      const filteredOutCount = recoveryBizIds.size - [...recoveryBizIds].filter((id) => convertedBizIds.has(id)).length;
      setTotal(Math.max((count ?? 0) - filteredOutCount, 0));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load businesses');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchBusinesses(page, debouncedSearch);
  }, [page, debouncedSearch, fetchBusinesses]);

  // Fetch business_contacts when a business is selected
  useEffect(() => {
    if (!selectedId) {
      setSelectedContacts([]);
      return;
    }
    let cancelled = false;
    async function fetchContacts() {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data: contacts } = await supabase
          .from('business_contacts')
          .select('id, name, title, email, phone, linkedinUrl, seniority, positionRank, source')
          .eq('businessId', selectedId)
          .order('createdAt', { ascending: false })
          .limit(10);

        if (contacts && contacts.length > 0 && !cancelled) {
          setSelectedContacts(contacts.map((c: { id: string; name: string; title: string | null; email: string | null; linkedinUrl: string | null; source: string | null }) => ({
            id: c.id,
            fullName: c.name,
            jobTitle: c.title,
            email: c.email,
            linkedinUrl: c.linkedinUrl,
            source: (c.source as string) ?? null,
          })));
        }
      } catch {
        // Silently fail — supplementary data
      }
    }
    void fetchContacts();
    return () => { cancelled = true; };
  }, [selectedId]);

  // Server-side search via debouncedSearch already filters businesses
  const filtered = businesses;

  const selected = selectedId ? businesses.find((b) => b.id === selectedId) ?? null : null;
  const totalPages = Math.ceil(total / pageSize);

  const withScrapeData = businesses.filter((b) => b.apify_website_scrape_json || b.apify_instagram_scrape_json).length;

  return (
    <div className="space-y-4">
      <LeadsNav active="business-intel" />

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Business Intelligence</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {total} businesses discovered &middot; {withScrapeData} with enrichment data
          </p>
        </div>
      </div>

      {error && <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

      {/* Search */}
      <div className="rounded-2xl border border-border/50 bg-card p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Search className="h-4 w-4 text-muted-foreground/40" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter by name, category, city, domain, or Instagram handle..."
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
          />
          <span className="text-[11px] text-muted-foreground/40">{filtered.length} shown</span>
        </div>
      </div>

      {/* Main layout */}
      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        {/* Left: business list */}
        <div className="space-y-3 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto lg:pr-1">
          {isLoading ? (
            <div className="flex items-center gap-2 rounded-xl border border-border/30 bg-zbooni-dark/20 p-6">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/40" />
              <span className="text-sm text-muted-foreground/50">Loading businesses...</span>
            </div>
          ) : filtered.length > 0 ? (
            <>
              {filtered.map((biz) => (
                <BusinessCard key={biz.id} biz={biz} isSelected={selectedId === biz.id} onSelect={() => setSelectedId(biz.id)} />
              ))}
              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-2">
                  <button type="button" onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="rounded-lg border border-border/30 px-3 py-1.5 text-xs font-semibold text-muted-foreground disabled:opacity-30">Prev</button>
                  <span className="text-xs text-muted-foreground/40">Page {page} of {totalPages}</span>
                  <button type="button" onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} className="rounded-lg border border-border/30 px-3 py-1.5 text-xs font-semibold text-muted-foreground disabled:opacity-30">Next</button>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-xl border border-border/30 bg-zbooni-dark/20 p-6 text-center">
              <Building2 className="mx-auto h-8 w-8 text-muted-foreground/20" />
              <p className="mt-2 text-sm text-muted-foreground/50">No businesses found</p>
            </div>
          )}
        </div>

        {/* Right: detail panel */}
        {selected ? (
          <div className="lg:sticky lg:top-20 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto">
            <BusinessDetailPanel biz={selected} contacts={selectedContacts} onClose={() => setSelectedId(null)} />
          </div>
        ) : (
          <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
            <div className="flex flex-col items-center justify-center py-20">
              <Building2 className="h-12 w-12 text-muted-foreground/15" />
              <h3 className="mt-4 text-base font-bold tracking-tight text-muted-foreground/60">Select a business</h3>
              <p className="mt-1 max-w-xs text-center text-[12px] text-muted-foreground/35">
                Click a business to view its intelligence data: tech stack, decision makers, social presence, certifications, and Instagram analytics.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
