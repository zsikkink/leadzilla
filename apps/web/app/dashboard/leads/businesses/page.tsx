'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Globe,
  Instagram,
  Loader2,
  Mail,
  MapPin,
  Monitor,
  Phone,
  Search,
  Shield,
  Star,
  Users,
  X,
} from 'lucide-react';

import { cn } from '@/lib/utils.js';
import { getSupabaseBrowserClient } from '@/lib/supabase-client.js';
import { countryName } from '@/lib/countries.js';

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
  const raw = scrape.techStack;
  if (!Array.isArray(raw)) return [];
  return raw.filter((ts): ts is { category: string; technologies: string[] } => ts && typeof ts.category === 'string').slice(0, 10);
}

function extractCertifications(scrape: Record<string, unknown>): string[] {
  const raw = scrape.certifications;
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is string => typeof c === 'string').slice(0, 10);
}

function extractContactInfo(scrape: Record<string, unknown>): { emails: string[]; phones: string[]; addresses: string[] } {
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

// ── Score badge ──────────────────────────────────────────────────────────────

function ScoreBadge({ score, band }: { score: number; band: string | null }) {
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
          <p className="text-sm font-bold tracking-tight truncate">{biz.name}</p>
          <p className="text-[11px] text-muted-foreground/60">{biz.category ?? 'Uncategorized'}</p>
        </div>
        <ScoreBadge score={biz.deterministic_score} band={biz.score_band} />
      </div>
      <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground/40">
        <span className="flex items-center gap-1"><Globe className="h-3 w-3" />{countryName(biz.country_code)}{biz.city ? ` / ${biz.city}` : ''}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {biz.has_whatsapp && <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">WA</span>}
        {biz.has_instagram && <span className="rounded-full bg-pink-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-pink-400">IG</span>}
        {biz.website_domain && <span className="rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-blue-400">Web</span>}
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

function BusinessDetailPanel({ biz, onClose }: { biz: BusinessRow; onClose: () => void }) {
  const websiteScrape = biz.apify_website_scrape_json;
  const instagramScrape = biz.apify_instagram_scrape_json;

  const decisionMakers = websiteScrape ? extractDecisionMakers(websiteScrape) : [];
  const socialLinks = websiteScrape ? extractSocialLinks(websiteScrape) : [];
  const techStack = websiteScrape ? extractTechStack(websiteScrape) : [];
  const certifications = websiteScrape ? extractCertifications(websiteScrape) : [];
  const contactInfo = websiteScrape ? extractContactInfo(websiteScrape) : { emails: [], phones: [], addresses: [] };
  const igData = instagramScrape ? extractInstagramData(instagramScrape) : null;

  return (
    <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b border-border/30 pb-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-zbooni-teal" />
            <h2 className="text-lg font-extrabold tracking-tight truncate">{biz.name}</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground/60">{biz.category ?? 'Uncategorized'} &middot; {countryName(biz.country_code)}{biz.city ? `, ${biz.city}` : ''}</p>
        </div>
        <div className="flex items-center gap-3">
          <ScoreBadge score={biz.deterministic_score} band={biz.score_band} />
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-muted-foreground/40 hover:bg-muted/10 hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
      </div>

      {/* Quick stats */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-border/20 bg-slate-800 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Rating</p>
          <p className="mt-0.5 flex items-center gap-1 text-sm font-bold"><Star className="h-3 w-3 text-yellow-400" />{biz.rating ? `${biz.rating}/5` : 'N/A'}</p>
        </div>
        <div className="rounded-lg border border-border/20 bg-slate-800 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Reviews</p>
          <p className="mt-0.5 text-sm font-bold">{biz.review_count ?? 0}</p>
        </div>
        <div className="rounded-lg border border-border/20 bg-slate-800 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Followers</p>
          <p className="mt-0.5 text-sm font-bold">{biz.follower_count ? biz.follower_count.toLocaleString() : 'N/A'}</p>
        </div>
        <div className="rounded-lg border border-border/20 bg-slate-800 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Qualification</p>
          <p className={cn('mt-0.5 text-sm font-bold', biz.pre_qualified ? 'text-zbooni-green' : biz.pre_qualified === false ? 'text-red-400' : 'text-muted-foreground/60')}>
            {biz.pre_qualified ? 'Qualified' : biz.pre_qualified === false ? 'Disqualified' : 'Pending'}
          </p>
        </div>
      </div>

      {biz.disqualification_reason ? (
        <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">{biz.disqualification_reason}</div>
      ) : null}

      {/* Contact info */}
      <div className="mt-4 flex flex-wrap gap-3 text-xs">
        {biz.website_domain && (
          <span className="flex items-center gap-1 rounded-full border border-border/30 px-2.5 py-1 text-muted-foreground">
            <Globe className="h-3 w-3" />{biz.website_domain}
          </span>
        )}
        {biz.phone_e164 && (
          <span className="flex items-center gap-1 rounded-full border border-border/30 px-2.5 py-1 text-muted-foreground">
            <Phone className="h-3 w-3" />{biz.phone_e164}
          </span>
        )}
        {biz.instagram_handle && (
          <span className="flex items-center gap-1 rounded-full border border-border/30 px-2.5 py-1 text-muted-foreground">
            <Instagram className="h-3 w-3" />@{biz.instagram_handle}
          </span>
        )}
      </div>

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

        {/* Social Links */}
        {socialLinks.length > 0 && (
          <Section title="Social Media" icon={ExternalLink} iconColor="text-cyan-400" count={socialLinks.length}>
            <div className="space-y-1.5">
              {socialLinks.map((sl, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="w-20 text-[11px] font-semibold uppercase text-muted-foreground/50">{sl.platform}</span>
                  <span className="truncate font-mono text-xs text-foreground/70">{sl.url}</span>
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

        {/* Website Contact Info */}
        {(contactInfo.emails.length > 0 || contactInfo.phones.length > 0 || contactInfo.addresses.length > 0) && (
          <Section title="Website Contact Info" icon={Mail} iconColor="text-blue-400" count={contactInfo.emails.length + contactInfo.phones.length}>
            <div className="space-y-2 text-xs">
              {contactInfo.emails.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground/40">Emails</p>
                  {contactInfo.emails.map((e) => <p key={e} className="font-mono text-foreground/70">{e}</p>)}
                </div>
              )}
              {contactInfo.phones.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground/40">Phones</p>
                  {contactInfo.phones.map((p) => <p key={p} className="font-mono text-foreground/70">{p}</p>)}
                </div>
              )}
              {contactInfo.addresses.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground/40">Addresses</p>
                  {contactInfo.addresses.map((a) => <p key={a} className="text-foreground/70">{a}</p>)}
                </div>
              )}
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
              {igData.businessEmail && (
                <div>
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground/40">Business Email</p>
                  <p className="font-mono text-xs text-foreground/70">{igData.businessEmail}</p>
                </div>
              )}
              {igData.businessPhone && (
                <div>
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground/40">Business Phone</p>
                  <p className="font-mono text-xs text-foreground/70">{igData.businessPhone}</p>
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
  const [businesses, setBusinesses] = useState<BusinessRow[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 30;

  const fetchBusinesses = useCallback(async (pageNum: number) => {
    setIsLoading(true);
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const from = (pageNum - 1) * pageSize;
      const to = from + pageSize - 1;

      const { data, error: fetchError, count } = await supabase
        .from('businesses')
        .select(
          'id,name,country_code,country,city,category,rating,review_count,follower_count,deterministic_score,score_band,has_whatsapp,has_instagram,accepts_online_payments,recent_activity,website_domain,phone_e164,instagram_handle,pre_qualified,disqualification_reason,apify_website_scrape_json,apify_instagram_scrape_json,website_scraped_at,instagram_scraped_at,created_at,updated_at',
          { count: 'exact' },
        )
        .order('deterministic_score', { ascending: false })
        .order('updated_at', { ascending: false })
        .range(from, to);

      if (fetchError) throw new Error(fetchError.message);
      setBusinesses((data ?? []) as BusinessRow[]);
      setTotal(count ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load businesses');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchBusinesses(page);
  }, [page, fetchBusinesses]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return businesses;
    const q = searchQuery.toLowerCase();
    return businesses.filter((b) =>
      b.name.toLowerCase().includes(q) ||
      (b.category ?? '').toLowerCase().includes(q) ||
      (b.city ?? '').toLowerCase().includes(q) ||
      (b.website_domain ?? '').toLowerCase().includes(q) ||
      (b.instagram_handle ?? '').toLowerCase().includes(q),
    );
  }, [businesses, searchQuery]);

  const selected = selectedId ? businesses.find((b) => b.id === selectedId) ?? null : null;
  const totalPages = Math.ceil(total / pageSize);

  const withScrapeData = businesses.filter((b) => b.apify_website_scrape_json || b.apify_instagram_scrape_json).length;

  return (
    <div className="space-y-4">
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
        <div className="space-y-3">
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
          <BusinessDetailPanel biz={selected} onClose={() => setSelectedId(null)} />
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
