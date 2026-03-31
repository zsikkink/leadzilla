'use client';

import type { GetLeadResponse } from '@lead-flood/contracts';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Brain,
  Briefcase,
  Building2,
  Crown,
  Edit2,
  ExternalLink,
  Globe,
  Inbox,
  Linkedin,
  Loader2,
  Mail,
  MapPin,
  Monitor,
  Phone,
  RefreshCw,
  Save,
  Shield,
  Tag,
  Trash2,
  TrendingUp,
  User,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useMemo, useState, type CSSProperties } from 'react';

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
import { getTeamMemberTier, sortTeamMembers } from '../../../../src/lib/team-members.js';

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
interface _InstagramPost {
  caption: string;
  likes: number;
  comments: number;
  timestamp: string;
  url: string | null;
  thumbnailUrl: string | null;
  postType: 'image' | 'video' | 'carousel';
}

/** Extended lead response with extra fields injected by the API beyond the contract schema */
interface ExtendedLeadResponse extends GetLeadResponse {
  businessId?: string | null | undefined;
  websiteDomain?: string | null | undefined;
  icpProfileName?: string | null | undefined;
  businessContacts?: Array<{
    id: string;
    name: string;
    title: string | null;
    email: string | null;
    phone: string | null;
    linkedinUrl: string | null;
    seniority: string;
    positionRank: number;
    source: string;
  }> | undefined;
}

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
                  <SocialLinkIcon
                    platform={sl.platform}
                    className="h-3 w-3"
                  />
                  <span>
                    {label}
                  </span>
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
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [backupSuccess, setBackupSuccess] = useState<string | null>(null);

  // ── Team member CRUD state ──────────────────────────────────────
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ name: string; title: string; email: string; phone: string }>({ name: '', title: '', email: '', phone: '' });
  const [contactSaving, setContactSaving] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);

  const startEditContact = useCallback((contact: { id: string; name: string; title: string | null; email: string | null; phone: string | null }) => {
    setEditingContactId(contact.id);
    setEditForm({
      name: contact.name,
      title: contact.title ?? '',
      email: contact.email ?? '',
      phone: contact.phone ?? '',
    });
    setContactError(null);
  }, []);

  const cancelEditContact = useCallback(() => {
    setEditingContactId(null);
    setContactError(null);
  }, []);

  const saveEditContact = useCallback(async () => {
    if (!editingContactId) return;
    setContactSaving(true);
    setContactError(null);
    try {
      await apiClient.updateBusinessContact(editingContactId, {
        name: editForm.name,
        title: editForm.title || null,
        email: editForm.email || null,
        phone: editForm.phone || null,
      });
      setEditingContactId(null);
      lead.refetch();
    } catch (err) {
      setContactError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setContactSaving(false);
    }
  }, [editingContactId, editForm, apiClient, lead]);

  const deleteContact = useCallback(async (contactId: string) => {
    setContactSaving(true);
    setContactError(null);
    try {
      await apiClient.deleteBusinessContact(contactId);
      lead.refetch();
    } catch (err) {
      setContactError(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setContactSaving(false);
    }
  }, [apiClient, lead]);

  const setPrimaryContact = useCallback(async (contactId: string, businessId: string) => {
    setContactSaving(true);
    setContactError(null);
    try {
      await apiClient.setBusinessContactPrimary(contactId, businessId);
      lead.refetch();
    } catch (err) {
      setContactError(err instanceof Error ? err.message : 'Failed to set primary');
    } finally {
      setContactSaving(false);
    }
  }, [apiClient, lead]);

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

  const l = lead.data as ExtendedLeadResponse | null;
  const businessName = useMemo(() => getBusinessNameFromLead(l ?? null), [l]);
  const contactDiscoveryMembers = useMemo(() => buildTeamMembersFromLead(l ?? null), [l]);

  // Merge business_contacts (from API, editable) with contactDiscovery candidates (read-only)
  const teamMembers = useMemo(() => {
    const dbContacts: TeamMember[] = (l?.businessContacts ?? []).map((bc) => ({
      id: bc.id,
      fullName: bc.name,
      jobTitle: bc.title,
      email: bc.email,
      phone: bc.phone,
      linkedinUrl: bc.linkedinUrl,
      seniority: bc.seniority,
      positionRank: bc.positionRank,
      source: bc.source,
      fromBusinessContacts: true,
    }));
    // Only include contactDiscovery candidates that aren't already in business_contacts (by email match)
    const dbEmails = new Set(dbContacts.map((c) => c.email?.toLowerCase()).filter(Boolean));
    const discoveryOnly = contactDiscoveryMembers.filter(
      (dm) => !dm.email || !dbEmails.has(dm.email.toLowerCase()),
    );
    return [...dbContacts, ...discoveryOnly];
  }, [l, contactDiscoveryMembers]);
  const businessSummary = useMemo(() => {
    if (!l) {
      return null;
    }

    if (!businessName && !l.businessCategory && !l.businessCountryCode && !l.businessCity) {
      return null;
    }

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
  const sortedTeamMembers = useMemo(
    () => (l ? sortTeamMembers(teamMembers, l.email).ordered : []),
    [teamMembers, l],
  );
  const leadEmailNormalized = normalizeEmail(l?.email);
  const leadTitle = getLeadTitleFromEnrichment(l?.enrichmentData);
  const leadMatchedTeamMember = leadEmailNormalized
    ? sortedTeamMembers.find((member) => normalizeEmail(member.email) === leadEmailNormalized) ?? null
    : null;
  const fallbackLeadTier = getTeamMemberTier(
    null,
    leadTitle,
  );
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

        {/* D9: Phone + LinkedIn */}
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

      {/* ICP Profile pill + Website / Business Intel links */}
      {(l.icpProfileName || l.websiteDomain || l.businessId) ? (
        <div className="flex flex-wrap items-center gap-3">
          {l.icpProfileName ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-400/30 bg-purple-500/10 px-3 py-1 text-xs font-semibold text-purple-300">
              <Tag className="h-3 w-3" />
              {l.icpProfileName}
            </span>
          ) : null}
          {l.websiteDomain ? (
            <a
              href={`https://${l.websiteDomain.replace(/^https?:\/\//, '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/40 bg-card/60 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-zbooni-teal/40 hover:text-zbooni-teal"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {l.websiteDomain}
            </a>
          ) : null}
          {l.businessId ? (
            <Link
              href={`/dashboard/leads/businesses?selected=${l.businessId}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/40 bg-card/60 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-amber-400/40 hover:text-amber-300"
            >
              <Building2 className="h-3.5 w-3.5" />
              Business Intel
            </Link>
          ) : null}
        </div>
      ) : null}

      {/* About This Business (D1) */}
      {businessSummary ? (
        <AboutBusinessCard
          category={businessSummary.category}
          metaDescription={null}
          instagramBio={null}
          countryCode={businessSummary.countryCode}
          city={businessSummary.city}
          rating={null}
          reviewCount={null}
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

      {/* Team Members */}
      {sortedTeamMembers.length > 0 ? (
        <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-base font-bold tracking-tight flex items-center gap-2">
            <Users className="h-4 w-4 text-amber-400" />
            Team Members
            <span className="ml-1 rounded-full bg-muted/20 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">{sortedTeamMembers.length}</span>
          </h2>
          {contactError ? (
            <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {contactError}
            </div>
          ) : null}
          <div className="grid gap-2.5 sm:grid-cols-2">
            {sortedTeamMembers.map((tm, idx) => {
              const isPrimary = tm.fromBusinessContacts
                ? tm.positionRank === 0
                : leadEmailNormalized
                  ? normalizeEmail(tm.email) === leadEmailNormalized
                  : idx === 0;
              const isDecisionMaker = isExecutiveOrDirector(tm);
              const seniorityLabel = tm.seniority ? tm.seniority.charAt(0).toUpperCase() + tm.seniority.slice(1) : null;
              const isEditing = editingContactId === tm.id;

              return (
                <div
                  key={tm.id}
                  className="rounded-lg border border-border/25 bg-zbooni-dark/35 p-3"
                >
                  {/* Inline edit form for business_contacts records */}
                  {isEditing ? (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={editForm.name}
                        onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                        placeholder="Full name"
                        className="w-full rounded-md border border-border/40 bg-zbooni-dark/60 px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:border-zbooni-teal/60 focus:outline-none"
                      />
                      <input
                        type="text"
                        value={editForm.title}
                        onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                        placeholder="Job title"
                        className="w-full rounded-md border border-border/40 bg-zbooni-dark/60 px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:border-zbooni-teal/60 focus:outline-none"
                      />
                      <input
                        type="email"
                        value={editForm.email}
                        onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                        placeholder="Email"
                        className="w-full rounded-md border border-border/40 bg-zbooni-dark/60 px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:border-zbooni-teal/60 focus:outline-none"
                      />
                      <input
                        type="tel"
                        value={editForm.phone}
                        onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                        placeholder="Phone"
                        className="w-full rounded-md border border-border/40 bg-zbooni-dark/60 px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:border-zbooni-teal/60 focus:outline-none"
                      />
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={saveEditContact}
                          disabled={contactSaving || !editForm.name.trim()}
                          className="inline-flex items-center gap-1 rounded-md bg-zbooni-teal/20 px-2.5 py-1 text-[11px] font-semibold text-zbooni-teal transition-colors hover:bg-zbooni-teal/30 disabled:opacity-50"
                        >
                          {contactSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={cancelEditContact}
                          disabled={contactSaving}
                          className="inline-flex items-center gap-1 rounded-md bg-muted/20 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted/30 disabled:opacity-50"
                        >
                          <X className="h-3 w-3" />
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
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
                          {tm.source ? (
                            <span className="rounded-full bg-muted/20 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                              {tm.source}
                            </span>
                          ) : null}
                        </div>
                        {tm.jobTitle ? (
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground/60">{tm.jobTitle}</p>
                        ) : null}

                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
                          {tm.email ? (
                            <a
                              href={`mailto:${tm.email}`}
                              className="inline-flex items-center gap-1 text-zbooni-teal transition-colors hover:text-zbooni-green"
                            >
                              <Mail className="h-3.5 w-3.5" />
                              <span className="font-mono">{tm.email}</span>
                            </a>
                          ) : (
                            <span className="rounded-full bg-muted/20 px-2 py-0.5 text-[10px] font-medium text-muted-foreground/60">
                              No email found
                            </span>
                          )}

                          {tm.phone ? (
                            <a
                              href={`tel:${tm.phone}`}
                              className="inline-flex items-center gap-1 text-muted-foreground/80 transition-colors hover:text-foreground"
                            >
                              <Phone className="h-3.5 w-3.5" />
                              {tm.phone}
                            </a>
                          ) : null}

                          {tm.linkedinUrl ? (
                            <a
                              href={tm.linkedinUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-zbooni-teal transition-colors hover:text-zbooni-green"
                            >
                              <Linkedin className="h-3.5 w-3.5" />
                              LinkedIn
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : null}
                        </div>

                        {/* CRUD actions — only for business_contacts records */}
                        {tm.fromBusinessContacts ? (
                          <div className="mt-2 flex items-center gap-2 border-t border-border/15 pt-2">
                            <button
                              type="button"
                              onClick={() => startEditContact({ id: tm.id, name: tm.fullName, title: tm.jobTitle, email: tm.email, phone: tm.phone })}
                              disabled={contactSaving}
                              className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground/60 transition-colors hover:text-zbooni-teal disabled:opacity-50"
                            >
                              <Edit2 className="h-3 w-3" />
                              Edit
                            </button>
                            {!isPrimary && l.businessId ? (
                              <button
                                type="button"
                                onClick={() => setPrimaryContact(tm.id, l.businessId!)}
                                disabled={contactSaving}
                                className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground/60 transition-colors hover:text-zbooni-green disabled:opacity-50"
                              >
                                <Crown className="h-3 w-3" />
                                Set Primary
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => deleteContact(tm.id)}
                              disabled={contactSaving}
                              className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground/60 transition-colors hover:text-red-400 disabled:opacity-50"
                            >
                              <Trash2 className="h-3 w-3" />
                              Delete
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
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
