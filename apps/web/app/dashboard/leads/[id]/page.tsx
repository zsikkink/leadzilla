'use client';

import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Brain,
  Briefcase,
  Building2,
  ExternalLink,
  Globe,
  Instagram,
  Linkedin,
  Loader2,
  Mail,
  MapPin,
  Monitor,
  Phone,
  RefreshCw,
  Shield,
  TrendingUp,
  User,
  Users,
} from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { AboutBusinessCard } from '../../../../src/components/about-business-card.js';
import { LeadStatusBadge } from '../../../../src/components/lead-status-badge.js';
import { ScoreBandBadge } from '../../../../src/components/score-band-badge.js';
import { ScoringBreakdown } from '../../../../src/components/scoring-breakdown.js';
import { SocialLinkIcon } from '../../../../src/components/social-link-icon.js';
import { useApiQuery } from '../../../../src/hooks/use-api-query.js';
import { useAuth } from '../../../../src/hooks/use-auth.js';
import { countryName } from '../../../../src/lib/countries.js';
import { getSupabaseBrowserClient } from '../../../../src/lib/supabase-client.js';
import { sortTeamMembers } from '../../../../src/lib/team-members.js';

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

// ── Company Intelligence (from Business scraper data) ─────────

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

function extractBusinessDecisionMakers(scrape: Record<string, unknown>): DecisionMaker[] {
  const raw = scrape.decisionMakers;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((dm): dm is DecisionMaker => dm && typeof dm.name === 'string')
    .slice(0, 5);
}

function extractBusinessTechStack(scrape: Record<string, unknown>): Array<{ category: string; technologies: string[] }> {
  // New adapter format: technologies is an object { analytics: [], crm: [], ... }
  const techObj = scrape.technologies;
  if (techObj && typeof techObj === 'object' && !Array.isArray(techObj)) {
    return Object.entries(techObj as Record<string, unknown>)
      .filter(([, techs]) => Array.isArray(techs) && techs.length > 0)
      .map(([category, techs]) => ({ category, technologies: (techs as string[]) }))
      .slice(0, 8);
  }
  // Legacy format: techStack is an array of { category, technologies[] }
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
  // New adapter format: businessSignals.certifications
  const signals = scrape.businessSignals;
  if (signals && typeof signals === 'object') {
    const s = signals as Record<string, unknown>;
    if (Array.isArray(s.certifications) && s.certifications.length > 0) {
      return s.certifications.filter((c): c is string => typeof c === 'string').slice(0, 8);
    }
  }
  // Legacy format: certifications at top level
  const raw = scrape.certifications;
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is string => typeof c === 'string').slice(0, 8);
}

function extractContactEmails(scrape: Record<string, unknown>): ContactEmail[] {
  // New format: contactInfo.emails
  const ci = scrape.contactInfo;
  if (ci && typeof ci === 'object') {
    const c = ci as Record<string, unknown>;
    if (Array.isArray(c.emails)) {
      return c.emails.filter((e): e is ContactEmail => e && typeof e.email === 'string').slice(0, 5);
    }
  }
  // Legacy: emails at top level
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

  // From website scrape socialLinks
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

  // From Business.instagramHandle
  if (instagramHandle && !seen.has('instagram')) {
    seen.add('instagram');
    links.push({ platform: 'Instagram', url: `https://instagram.com/${instagramHandle}`, handle: instagramHandle });
  }

  // From Instagram scraper data — if we have IG data, ensure it shows
  if (instagramScrape && !seen.has('instagram')) {
    const handle = instagramScrape.username as string | undefined;
    if (handle) {
      seen.add('instagram');
      links.push({ platform: 'Instagram', url: `https://instagram.com/${handle}`, handle });
    }
  }

  return links;
}

function IntelligenceGathered({ data }: { data: BusinessScrapeData }) {
  const ws = data.websiteScrape;
  const ig = data.instagramScrape;

  const decisionMakers = ws ? extractBusinessDecisionMakers(ws) : [];
  const techStack = ws ? extractBusinessTechStack(ws) : [];
  const mergedSocialLinks = mergeSocialLinks(ws, data.instagramHandle, ig);
  const certs = ws ? extractBusinessCertifications(ws) : [];
  const emails = ws ? extractContactEmails(ws) : [];
  const phones = ws ? extractContactPhones(ws) : [];
  const addresses = ws ? extractContactAddresses(ws) : [];

  // Add Instagram business email/phone to contact methods
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

      {/* Contact Methods (D6: emails + phones at top) */}
      {(allEmails.length > 0 || allPhones.length > 0) && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 mb-2">
            <Mail className="mr-1 inline h-3 w-3" />Contact Methods
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {allEmails.map((e, i) => (
              <a
                key={i}
                href={`mailto:${e.email}`}
                className="flex items-center gap-2 rounded-lg border border-border/20 bg-zbooni-dark/30 px-3 py-2 text-xs text-zbooni-teal transition-colors hover:text-zbooni-green hover:border-border/40"
              >
                <Mail className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{e.email}</span>
                {e.context && <span className="ml-auto text-[10px] text-muted-foreground/40">{e.context}</span>}
              </a>
            ))}
            {allPhones.map((p, i) => (
              <a
                key={i}
                href={`tel:${p.number}`}
                className="flex items-center gap-2 rounded-lg border border-border/20 bg-zbooni-dark/30 px-3 py-2 text-xs text-zbooni-teal transition-colors hover:text-zbooni-green hover:border-border/40"
              >
                <Phone className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{p.number}</span>
                {p.type && <span className="ml-auto text-[10px] text-muted-foreground/40">{p.type}</span>}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Location (D6: addresses below) */}
      {addresses.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 mb-2">
            <MapPin className="mr-1 inline h-3 w-3" />Location
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {addresses.map((a, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-lg border border-border/20 bg-zbooni-dark/30 px-3 py-2 text-xs text-muted-foreground"
              >
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

      {/* Social Presence (D5: platform icons, D7: merged sources) */}
      {mergedSocialLinks.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 mb-2">
            <Globe className="mr-1 inline h-3 w-3" />Social Presence
          </p>
          <div className="flex flex-wrap gap-2">
            {mergedSocialLinks.map((sl, i) => (
              <a
                key={i}
                href={sl.url.startsWith('http') ? sl.url : `https://${sl.url}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-border/30 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-zbooni-teal hover:border-zbooni-teal/30"
              >
                <SocialLinkIcon platform={sl.platform} className="h-3 w-3" />
                {sl.platform}
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            ))}
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

  // Fetch linked Business scraper data via business_conversions → businesses
  const [businessData, setBusinessData] = useState<BusinessScrapeData | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<Array<{ id: string; fullName: string; jobTitle: string | null; email: string | null; phone: string | null; linkedinUrl: string | null; seniority: string | null; source: string | null }>>([]);
  const [instagramPosts, setInstagramPosts] = useState<Array<{
    caption: string;
    likes: number;
    comments: number;
    timestamp: string;
    url: string | null;
    thumbnailUrl: string | null;
  }>>([]);
  const [leadPhoneSource, setLeadPhoneSource] = useState<string | null>(null);
  const [leadBusinessEmail, setLeadBusinessEmail] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function fetchBusiness() {
      try {
        const supabase = getSupabaseBrowserClient();
        // Find business linked to this lead
        const { data: conversions } = await supabase
          .from('business_conversions')
          .select('businessId, icpProfileId')
          .eq('leadId', id)
          .limit(1);

        const bizId = conversions?.[0]?.businessId;
        const convIcpProfileId = conversions?.[0]?.icpProfileId as string | null | undefined;
        if (!bizId || cancelled) return;

        setBusinessId(bizId);
        if (convIcpProfileId) setLeadIcpProfileId(convIcpProfileId);

        const { data: biz } = await supabase
          .from('businesses')
          .select('name, website_domain, instagram_handle, rating, review_count, follower_count, category, country_code, city, apify_website_scrape_json, apify_instagram_scrape_json')
          .eq('id', bizId)
          .single();

        if (!biz || cancelled) return;

        setBusinessData({
          name: biz.name ?? '',
          websiteScrape: biz.apify_website_scrape_json as Record<string, unknown> | null,
          instagramScrape: biz.apify_instagram_scrape_json as Record<string, unknown> | null,
          websiteDomain: biz.website_domain,
          instagramHandle: biz.instagram_handle,
          rating: biz.rating,
          reviewCount: biz.review_count,
          followerCount: biz.follower_count,
          category: biz.category,
          countryCode: biz.country_code ?? null,
          city: biz.city ?? null,
        });

        // Fetch phoneSource and businessEmail from Lead table
        const { data: leadExtra } = await supabase
          .from('Lead')
          .select('phoneSource, businessEmail')
          .eq('id', id)
          .single();
        if (leadExtra && !cancelled) {
          setLeadPhoneSource((leadExtra.phoneSource as string) ?? null);
          setLeadBusinessEmail((leadExtra.businessEmail as string) ?? null);
        }

        // Fetch team members from business_contacts table
        const { data: contacts } = await supabase
          .from('business_contacts')
          .select('id, name, title, email, phone, linkedinUrl, seniority, positionRank, source')
          .eq('businessId', bizId)
          .order('createdAt', { ascending: false })
          .limit(10);

        if (contacts && contacts.length > 0 && !cancelled) {
          const mapped = contacts.map((c: { id: string; name: string; title: string | null; email: string | null; phone: string | null; linkedinUrl: string | null; seniority: string | null; source: string | null }) => ({
            id: c.id,
            fullName: c.name,
            jobTitle: c.title,
            email: c.email,
            phone: c.phone,
            linkedinUrl: c.linkedinUrl,
            seniority: c.seniority,
            source: (c.source as string) ?? null,
          }));
          setTeamMembers(mapped);
        } else if (!cancelled) {
          // Fallback: extract decision makers from website scrape data
          const websiteScrape = biz.apify_website_scrape_json as Record<string, unknown> | null;
          if (websiteScrape) {
            const dms = websiteScrape.decisionMakers as Array<Record<string, unknown>> | undefined;
            if (Array.isArray(dms) && dms.length > 0) {
              setTeamMembers(dms.slice(0, 10).map((dm, idx) => ({
                id: `dm-${idx}`,
                fullName: typeof dm.name === 'string' ? dm.name : 'Unknown',
                jobTitle: typeof dm.title === 'string' ? dm.title : null,
                email: typeof dm.email === 'string' ? dm.email : null,
                phone: null,
                linkedinUrl: typeof dm.linkedinUrl === 'string' ? dm.linkedinUrl : null,
                seniority: null,
                source: 'Website',
              })));
            }
          }
        }

        // Extract Instagram recent posts from scrape data
        const igScrape = biz.apify_instagram_scrape_json as Record<string, unknown> | null;
        if (igScrape && Array.isArray(igScrape.recentPosts) && !cancelled) {
          const posts = (igScrape.recentPosts as Array<Record<string, unknown>>)
            .slice(0, 6)
            .map((p) => ({
              caption: typeof p.caption === 'string' ? p.caption : '',
              likes: typeof p.likeCount === 'number'
                ? p.likeCount
                : (typeof p.likes === 'number' ? p.likes : (typeof p.likesCount === 'number' ? p.likesCount : 0)),
              comments: typeof p.commentCount === 'number'
                ? p.commentCount
                : (typeof p.comments === 'number' ? p.comments : (typeof p.commentsCount === 'number' ? p.commentsCount : 0)),
              timestamp: typeof p.timestamp === 'string' ? p.timestamp : (typeof p.takenAtTimestamp === 'string' ? p.takenAtTimestamp : ''),
              url: typeof p.url === 'string' ? p.url : (typeof p.shortCode === 'string' ? `https://instagram.com/p/${p.shortCode}` : null),
              thumbnailUrl: typeof p.thumbnailUrl === 'string'
                ? p.thumbnailUrl
                : (typeof p.displayUrl === 'string' ? p.displayUrl : null),
            }));
          setInstagramPosts(posts);
        }
      } catch {
        // Silently fail — business intel is supplementary
      }
    }
    void fetchBusiness();
    return () => { cancelled = true; };
  }, [id]);

  // Backup contact rotation
  const [leadIcpProfileId, setLeadIcpProfileId] = useState<string | null>(null);
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [backupSuccess, setBackupSuccess] = useState<string | null>(null);

  const backupContacts = useMemo(() => {
    if (!lead.data) return [];
    const currentEmail = lead.data.email?.toLowerCase();
    return sortTeamMembers(teamMembers, lead.data.email).ordered
      .filter((tm) => tm.email && tm.email.toLowerCase() !== currentEmail);
  }, [teamMembers, lead.data]);

  const maxFollowUpNumber = useMemo(() => {
    if (!sends.data?.items.length) return -1;
    return Math.max(...sends.data.items.map((s) => s.followUpNumber ?? 0));
  }, [sends.data]);

  const hasReply = sends.data?.items.some((s) => s.status === 'REPLIED') ?? false;
  const showBackupBanner = maxFollowUpNumber >= 3 && !hasReply && backupContacts.length > 0;
  const nextBackup = backupContacts[0];

  const handleStartBackupSequence = async (contact: typeof backupContacts[0]) => {
    if (!contact.email) return;
    setIsCreatingBackup(true);
    try {
      // Dedup check — don't create duplicate leads for same email
      const supabase = getSupabaseBrowserClient();
      const { data: existing } = await supabase
        .from('Lead')
        .select('id')
        .eq('email', contact.email.toLowerCase())
        .is('deletedAt', null)
        .limit(1);
      if (existing && existing.length > 0) {
        setBackupSuccess(`Lead already exists for ${contact.email}.`);
        return;
      }

      const nameParts = contact.fullName.split(' ');
      const firstName = nameParts[0] ?? contact.fullName;
      const lastName = nameParts.slice(1).join(' ') || 'Unknown';
      await apiClient.createLead({
        firstName,
        lastName,
        email: contact.email,
        source: 'BACKUP_CONTACT_ROTATION',
        ...(leadIcpProfileId ? { icpProfileId: leadIcpProfileId } : {}),
      });
      setBackupSuccess(`New lead created for ${contact.fullName}. Message generation will start automatically.`);
    } catch (err) {
      setBackupSuccess(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsCreatingBackup(false);
    }
  };

  const l = lead.data;
  const sortedTeamMembers = useMemo(
    () => (l ? sortTeamMembers(teamMembers, l.email).ordered : []),
    [teamMembers, l],
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
            {businessData ? (
              <button
                type="button"
                onClick={() => router.push(`/dashboard/leads/businesses?selected=${businessId ?? ''}`)}
                className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-zbooni-teal transition-colors hover:text-zbooni-green"
              >
                <Building2 className="h-3 w-3" />
                {businessData.name}
                <ExternalLink className="h-2.5 w-2.5" />
              </button>
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

        {/* D9: Phone with source label + D9 business email + LinkedIn */}
        {(enrichmentFields.some((f) => f.label === 'Phone') || leadBusinessEmail || primaryLinkedinUrl) && (
          <div className="mt-3 flex flex-wrap gap-3">
            {enrichmentFields.filter((f) => f.label === 'Phone').map((f) => (
              <div key="phone" className="flex items-center gap-2 text-sm">
                <Phone className="h-3.5 w-3.5 text-muted-foreground/50" />
                <a href={f.href ?? '#'} className="font-medium text-zbooni-teal hover:text-zbooni-green transition-colors">
                  {f.value}
                </a>
                {leadPhoneSource && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                    leadPhoneSource === 'APOLLO' || leadPhoneSource === 'HUNTER'
                      ? 'bg-zbooni-green/15 text-zbooni-green'
                      : 'bg-muted/20 text-muted-foreground/50'
                  }`}>
                    {leadPhoneSource === 'WEBSITE_SCRAPE' ? 'Website' : leadPhoneSource}
                  </span>
                )}
              </div>
            ))}
            {leadBusinessEmail && (
              <div className="flex items-center gap-2 text-sm">
                <Mail className="h-3.5 w-3.5 text-muted-foreground/50" />
                <a href={`mailto:${leadBusinessEmail}`} className="font-medium text-zbooni-teal hover:text-zbooni-green transition-colors">
                  {leadBusinessEmail}
                </a>
                <span className="rounded-full bg-muted/20 px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground/50">Business</span>
              </div>
            )}
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

      {/* About This Business (D1) */}
      {businessData ? (
        <AboutBusinessCard
          category={businessData.category}
          metaDescription={
            businessData.websiteScrape
              ? ((businessData.websiteScrape.metaDescription as string) ?? null)
              : null
          }
          instagramBio={
            businessData.instagramScrape
              ? ((businessData.instagramScrape.biography as string) ?? null)
              : null
          }
          countryCode={businessData.countryCode}
          city={businessData.city}
          rating={businessData.rating}
          reviewCount={businessData.reviewCount}
        />
      ) : null}

      {/* Scoring Breakdown (D3) */}
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

      {/* Intelligence Gathered (from Business scraper data) */}
      {businessData ? (
        <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-base font-bold tracking-tight flex items-center gap-2">
            <Building2 className="h-4 w-4 text-zbooni-teal" />
            Intelligence Gathered
            {businessData.name ? (
              <span className="ml-2 text-sm font-normal text-muted-foreground/60">— {businessData.name}</span>
            ) : null}
            {businessData.websiteDomain ? (
              <a
                href={`https://${businessData.websiteDomain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto text-xs text-zbooni-teal hover:text-zbooni-green transition-colors flex items-center gap-1"
              >
                {businessData.websiteDomain} <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </h2>
          <IntelligenceGathered data={businessData} />
        </div>
      ) : null}

      {/* Team Members (D8: Primary/Alternative badges + source labels) */}
      {sortedTeamMembers.length > 0 ? (
        <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-base font-bold tracking-tight flex items-center gap-2">
            <Users className="h-4 w-4 text-amber-400" />
            Team Members
            <span className="ml-1 rounded-full bg-muted/20 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">{sortedTeamMembers.length}</span>
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {sortedTeamMembers.map((tm, idx) => {
              const isPrimary = idx === 0;
              return (
                <div key={tm.id} className="flex items-center gap-3 rounded-lg border border-border/20 bg-zbooni-dark/30 px-3 py-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-[11px] font-bold text-amber-400">
                    {tm.fullName.charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-semibold truncate">{tm.fullName}</p>
                      {isPrimary ? (
                        <span className="shrink-0 rounded-full bg-zbooni-green/15 px-1.5 py-0.5 text-[9px] font-bold text-zbooni-green">Primary</span>
                      ) : (
                        <span className="shrink-0 rounded-full bg-muted/20 px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground/50">Alternative</span>
                      )}
                    {tm.seniority && tm.seniority !== 'other' ? (
                        <span className="shrink-0 rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-bold text-blue-400">
                          {tm.seniority.charAt(0).toUpperCase() + tm.seniority.slice(1)}
                        </span>
                      ) : null}
                    </div>
                    {tm.jobTitle ? <p className="text-[11px] text-muted-foreground/50 truncate">{tm.jobTitle}</p> : null}
                    {tm.email ? <p className="truncate font-mono text-[11px] text-foreground/75">{tm.email}</p> : null}
                    {tm.source ? <p className="text-[9px] text-muted-foreground/30">{tm.source}</p> : null}
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    {tm.email ? (
                      <a href={`mailto:${tm.email}`} title={tm.email} className="text-muted-foreground/40 hover:text-zbooni-teal transition-colors">
                        <Mail className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                    {tm.phone ? (
                      <a href={`tel:${tm.phone}`} title={tm.phone} className="text-muted-foreground/40 hover:text-zbooni-teal transition-colors">
                        <Phone className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                    {tm.linkedinUrl ? (
                      <a href={tm.linkedinUrl} target="_blank" rel="noopener noreferrer" title="LinkedIn" className="text-muted-foreground/40 hover:text-zbooni-teal transition-colors">
                        <Linkedin className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Instagram Recent Posts */}
      {instagramPosts.length > 0 ? (
        <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-base font-bold tracking-tight flex items-center gap-2">
            <Instagram className="h-4 w-4 text-pink-400" />
            Recent Instagram Posts
            <span className="ml-1 rounded-full bg-muted/20 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">{instagramPosts.length}</span>
          </h2>
          <div className="space-y-3">
            {instagramPosts.map((post, i) => (
              <div key={i} className="rounded-lg border border-border/20 bg-zbooni-dark/30 px-4 py-3">
                <div className="flex gap-3">
                  {post.thumbnailUrl ? (
                    <img
                      src={post.thumbnailUrl}
                      alt="Instagram post preview"
                      className="h-20 w-20 shrink-0 rounded-md border border-border/30 object-cover"
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-muted-foreground/80 line-clamp-3">{post.caption || 'No caption'}</p>
                    <div className="mt-2 flex items-center gap-4 text-[11px] text-muted-foreground/50">
                      <span>{post.likes.toLocaleString()} likes</span>
                      <span>{post.comments.toLocaleString()} comments</span>
                      {post.timestamp ? <span>{new Date(post.timestamp).toLocaleDateString()}</span> : null}
                      {post.url ? (
                        <a href={post.url} target="_blank" rel="noopener noreferrer" className="ml-auto flex items-center gap-1 text-pink-400 hover:text-pink-300 transition-colors">
                          View <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* D10: Instagram cookie expiry warning */}
      {businessData?.instagramHandle && (
        !businessData.instagramScrape ||
        (businessData.instagramScrape.isVerified == null && businessData.instagramScrape.businessCategory == null)
      ) ? (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>Instagram insights are partial right now. Session credentials likely need refresh.</span>
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
                  onClick={() => handleStartBackupSequence(nextBackup)}
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
