import type { CSSProperties } from 'react';
import {
  Building2,
  Check,
  ExternalLink,
  Globe,
  Mail,
  MapPin,
  Monitor,
  Phone,
  Shield,
  Sparkles,
  Star,
  Tag,
  Wifi,
} from 'lucide-react';
import Link from 'next/link';

import { countryName } from '../lib/countries.js';
import {
  getSocialPlatformLabel,
  normalizeSocialPlatform,
  SOCIAL_BRAND_COLORS,
  SocialLinkIcon,
} from './social-link-icon.js';

interface SocialLink {
  platform: string;
  url: string;
  handle?: string | undefined;
}

interface TechCategory {
  category: string;
  technologies: string[];
}

interface ContactEmail {
  email: string;
  context?: string | undefined;
}

interface ContactPhone {
  number: string;
  type?: string | undefined;
}

export interface AboutBusinessCardProps {
  category: string | null;
  metaDescription: string | null;
  instagramBio: string | null;
  countryCode: string | null;
  city: string | null;
  address?: string | null | undefined;
  rating: number | null;
  reviewCount: number | null;
  /** AI-generated business insights from business_conversions.businessInsights */
  businessInsights?: string | null | undefined;
  websiteDomain?: string | null | undefined;
  phoneE164?: string | null | undefined;
  hasWhatsapp?: boolean | null | undefined;
  hasInstagram?: boolean | null | undefined;
  acceptsOnlinePayments?: boolean | null | undefined;
  followerCount?: number | null | undefined;
  recentActivity?: boolean | null | undefined;
  physicalAddressPresent?: boolean | null | undefined;
  socialLinks?: SocialLink[] | undefined;
  techStack?: TechCategory[] | undefined;
  certifications?: string[] | undefined;
  contactEmails?: ContactEmail[] | undefined;
  contactPhones?: ContactPhone[] | undefined;
  instagramHandle?: string | null | undefined;
  country?: string | null | undefined;
  icpProfileName?: string | null | undefined;
  businessId?: string | null | undefined;
}

function extractSocialLinks(
  websiteScrape: Record<string, unknown> | null,
  instagramHandle: string | null,
  instagramScrape: Record<string, unknown> | null,
): SocialLink[] {
  const links: SocialLink[] = [];
  const seen = new Set<string>();

  if (websiteScrape) {
    const raw = websiteScrape.socialLinks;
    if (Array.isArray(raw)) {
      for (const sl of raw) {
        if (sl && typeof sl === 'object' && typeof (sl as Record<string, unknown>).platform === 'string') {
          const link = sl as SocialLink;
          const key = link.platform.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            links.push(link);
          }
        }
      }
    }
  }

  if (instagramHandle && !seen.has('instagram')) {
    seen.add('instagram');
    links.push({ platform: 'Instagram', url: `https://instagram.com/${instagramHandle}`, handle: instagramHandle });
  }

  if (instagramScrape && !seen.has('instagram')) {
    const handle = (instagramScrape as Record<string, unknown>).username;
    if (typeof handle === 'string') {
      seen.add('instagram');
      links.push({ platform: 'Instagram', url: `https://instagram.com/${handle}`, handle });
    }
  }

  return links;
}

function extractTechStack(websiteScrape: Record<string, unknown> | null): TechCategory[] {
  if (!websiteScrape) return [];
  const techObj = websiteScrape.technologies;
  if (techObj && typeof techObj === 'object' && !Array.isArray(techObj)) {
    return Object.entries(techObj as Record<string, unknown>)
      .filter(([, techs]) => Array.isArray(techs) && techs.length > 0)
      .map(([category, techs]) => ({ category, technologies: techs as string[] }))
      .slice(0, 8);
  }
  const raw = websiteScrape.techStack;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((ts): ts is TechCategory => ts && typeof (ts as Record<string, unknown>).category === 'string')
    .slice(0, 8);
}

function extractCertifications(websiteScrape: Record<string, unknown> | null): string[] {
  if (!websiteScrape) return [];
  const signals = websiteScrape.businessSignals;
  if (signals && typeof signals === 'object') {
    const s = signals as Record<string, unknown>;
    if (Array.isArray(s.certifications) && s.certifications.length > 0) {
      return s.certifications.filter((c): c is string => typeof c === 'string').slice(0, 8);
    }
  }
  const raw = websiteScrape.certifications;
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is string => typeof c === 'string').slice(0, 8);
}

function extractContactEmails(websiteScrape: Record<string, unknown> | null): ContactEmail[] {
  if (!websiteScrape) return [];
  const ci = websiteScrape.contactInfo;
  if (ci && typeof ci === 'object') {
    const c = ci as Record<string, unknown>;
    if (Array.isArray(c.emails)) {
      return c.emails.filter((e): e is ContactEmail => e && typeof (e as Record<string, unknown>).email === 'string').slice(0, 5);
    }
  }
  if (Array.isArray(websiteScrape.emails)) {
    return websiteScrape.emails.filter((e): e is ContactEmail => e && typeof (e as Record<string, unknown>).email === 'string').slice(0, 5);
  }
  return [];
}

function extractContactPhones(websiteScrape: Record<string, unknown> | null): ContactPhone[] {
  if (!websiteScrape) return [];
  const ci = websiteScrape.contactInfo;
  if (ci && typeof ci === 'object') {
    const c = ci as Record<string, unknown>;
    if (Array.isArray(c.phones)) {
      return c.phones.filter((p): p is ContactPhone => p && typeof (p as Record<string, unknown>).number === 'string').slice(0, 5);
    }
  }
  if (Array.isArray(websiteScrape.phones)) {
    return websiteScrape.phones.filter((p): p is ContactPhone => p && typeof (p as Record<string, unknown>).number === 'string').slice(0, 5);
  }
  return [];
}

function extractMetaDescription(
  websiteScrape: Record<string, unknown> | null,
  _instagramScrape: Record<string, unknown> | null,
): string | null {
  if (websiteScrape) {
    const meta = websiteScrape.metaDescription;
    if (typeof meta === 'string' && meta.trim().length > 0) return meta.trim();
    const about = websiteScrape.aboutPageText;
    if (typeof about === 'string' && about.trim().length > 50) {
      return about.trim().slice(0, 300) + (about.trim().length > 300 ? '...' : '');
    }
  }
  return null;
}

function extractInstagramBio(instagramScrape: Record<string, unknown> | null): string | null {
  if (!instagramScrape) return null;
  const bio = instagramScrape.biography ?? instagramScrape.bio;
  return typeof bio === 'string' && bio.trim().length > 0 ? bio.trim() : null;
}

/**
 * Parse raw business data from Supabase into structured AboutBusinessCardProps.
 * Keeps parsing logic in one place so the lead detail page stays clean.
 */
export function parseBusinessDataForCard(raw: Record<string, unknown>): AboutBusinessCardProps {
  const readRecord = (value: unknown): Record<string, unknown> | null => (
    value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  );
  const readString = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = raw[key];
      if (typeof value === 'string') {
        return value;
      }
    }
    return null;
  };
  const readNumber = (...keys: string[]): number | null => {
    for (const key of keys) {
      const value = raw[key];
      if (typeof value === 'number') {
        return value;
      }
    }
    return null;
  };
  const readBoolean = (...keys: string[]): boolean | null => {
    for (const key of keys) {
      const value = raw[key];
      if (typeof value === 'boolean') {
        return value;
      }
    }
    return null;
  };

  const websiteScrape = readRecord(raw.apifyWebsiteScrapeJson ?? raw.apify_website_scrape_json);
  const instagramScrape = readRecord(raw.apifyInstagramScrapeJson ?? raw.apify_instagram_scrape_json);
  const instagramHandle = readString('instagramHandle', 'instagram_handle');

  const socialLinks = extractSocialLinks(websiteScrape, instagramHandle, instagramScrape);
  const techStack = extractTechStack(websiteScrape);
  const certifications = extractCertifications(websiteScrape);
  const contactEmails = extractContactEmails(websiteScrape);
  const contactPhones = extractContactPhones(websiteScrape);

  // Add IG business email/phone to contact methods
  const igBizEmail = instagramScrape && typeof (instagramScrape as Record<string, unknown>).businessEmail === 'string'
    ? (instagramScrape as Record<string, unknown>).businessEmail as string
    : null;
  const igBizPhone = instagramScrape && typeof (instagramScrape as Record<string, unknown>).businessPhone === 'string'
    ? (instagramScrape as Record<string, unknown>).businessPhone as string
    : null;
  if (igBizEmail && !contactEmails.some((e) => e.email === igBizEmail)) {
    contactEmails.push({ email: igBizEmail, context: 'Instagram' });
  }
  if (igBizPhone && !contactPhones.some((p) => p.number === igBizPhone)) {
    contactPhones.push({ number: igBizPhone, type: 'Instagram' });
  }

  return {
    category: readString('category'),
    metaDescription: extractMetaDescription(websiteScrape, instagramScrape),
    instagramBio: extractInstagramBio(instagramScrape),
    countryCode: readString('countryCode', 'country_code'),
    city: readString('city'),
    address: readString('address'),
    rating: readNumber('rating'),
    reviewCount: readNumber('reviewCount', 'review_count'),
    websiteDomain: readString('websiteDomain', 'website_domain'),
    phoneE164: readString('phoneE164', 'phone_e164'),
    hasWhatsapp: readBoolean('hasWhatsapp', 'has_whatsapp'),
    hasInstagram: readBoolean('hasInstagram', 'has_instagram'),
    acceptsOnlinePayments: readBoolean('acceptsOnlinePayments', 'accepts_online_payments'),
    followerCount: readNumber('followerCount', 'follower_count'),
    recentActivity: readBoolean('recentActivity', 'recent_activity'),
    physicalAddressPresent: readBoolean('physicalAddressPresent', 'physical_address_present'),
    socialLinks,
    techStack,
    certifications,
    contactEmails,
    contactPhones,
    instagramHandle,
    country: readString('country'),
  };
}

function SignalBadge({ label, active }: { label: string; active: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
      active ? 'bg-zbooni-green/10 text-zbooni-green' : 'bg-muted/20 text-muted-foreground/40'
    }`}>
      {active ? <Check className="h-2.5 w-2.5" /> : null}
      {label}
    </span>
  );
}

export function AboutBusinessCard(props: AboutBusinessCardProps) {
  const {
    category,
    metaDescription,
    instagramBio,
    countryCode,
    city,
    address = null,
    rating,
    reviewCount,
    businessInsights,
    websiteDomain = null,
    phoneE164 = null,
    hasWhatsapp = null,
    acceptsOnlinePayments = null,
    followerCount = null,
    recentActivity = null,
    physicalAddressPresent = null,
    socialLinks = [],
    techStack = [],
    certifications = [],
    contactEmails = [],
    contactPhones = [],
    country = null,
    icpProfileName = null,
    businessId = null,
  } = props;

  const locationParts = [
    address,
    city,
    country ?? (countryCode ? countryName(countryCode) : null),
  ].filter(Boolean);
  const locationText = locationParts.join(', ');

  // Prefer AI insights over raw scraped description
  const hasAiInsights = businessInsights && businessInsights.trim().length > 0;
  const descriptionText = hasAiInsights
    ? businessInsights.trim()
    : (metaDescription ?? 'No description available');

  return (
    <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
      <h2 className="mb-4 flex items-center gap-2 text-base font-bold tracking-tight">
        <Building2 className="h-4 w-4 text-zbooni-teal" />
        About This Business
      </h2>

      <div className="space-y-4">
        {/* Inline pills: Category + ICP + Website + Business Intel */}
        {(category || icpProfileName || websiteDomain || businessId) && (
          <div className="flex flex-wrap items-center gap-2">
            {category && (
              <span className="rounded-full bg-zbooni-teal/10 px-2.5 py-0.5 text-[11px] font-semibold text-zbooni-teal">
                {category}
              </span>
            )}
            {icpProfileName && (
              <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-purple-300">
                <Tag className="h-3 w-3" />
                {icpProfileName}
              </span>
            )}
            {websiteDomain && (
              <a
                href={`https://${websiteDomain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-border/30 px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-zbooni-teal"
              >
                <ExternalLink className="h-3 w-3" />
                {websiteDomain}
              </a>
            )}
            {businessId && (
              <Link
                href={`/dashboard/leads/businesses?selected=${businessId}`}
                className="inline-flex items-center gap-1 rounded-full border border-border/30 px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-zbooni-teal"
              >
                <Building2 className="h-3 w-3" />
                Business Intel
              </Link>
            )}
          </div>
        )}

        {/* Overview: Description / AI Insights */}
        <div className="space-y-2">
          {hasAiInsights ? (
            <div className="flex items-start gap-2">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
              <p className="text-sm text-foreground/80 leading-relaxed">
                {descriptionText}
              </p>
            </div>
          ) : metaDescription ? (
            <p className="text-sm text-muted-foreground/70 leading-relaxed">{metaDescription}</p>
          ) : (
            <p className="text-sm text-muted-foreground/40 italic">No description available</p>
          )}
          {instagramBio && !hasAiInsights && (
            <p className="text-xs italic text-muted-foreground/60 leading-relaxed">
              &ldquo;{instagramBio}&rdquo;
            </p>
          )}
        </div>

        {/* Contact Info */}
        {(phoneE164 || contactEmails.length > 0 || contactPhones.length > 0 || hasWhatsapp) && (
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
              <Mail className="mr-1 inline h-3 w-3" />
              Contact Info
            </p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {phoneE164 && (
                <a
                  href={`tel:${phoneE164}`}
                  className="flex items-center gap-2 rounded-lg border border-border/20 bg-zbooni-dark/30 px-3 py-2 text-xs text-zbooni-teal transition-colors hover:text-zbooni-green hover:border-border/40"
                >
                  <Phone className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{phoneE164}</span>
                  {hasWhatsapp && (
                    <span className="ml-auto rounded-full bg-green-500/15 px-1.5 py-0.5 text-[9px] font-bold text-green-400">
                      WhatsApp
                    </span>
                  )}
                </a>
              )}
              {contactEmails.map((e) => (
                <a
                  key={`biz-email-${e.email}`}
                  href={`mailto:${e.email}`}
                  className="flex items-center gap-2 rounded-lg border border-border/20 bg-zbooni-dark/30 px-3 py-2 text-xs text-zbooni-teal transition-colors hover:text-zbooni-green hover:border-border/40"
                >
                  <Mail className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{e.email}</span>
                  {e.context && <span className="ml-auto text-[10px] text-muted-foreground/40">{e.context}</span>}
                </a>
              ))}
              {contactPhones.map((p) => (
                <a
                  key={`biz-phone-${p.number}`}
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

        {/* AI Insights and Instagram Bio are now shown in the Overview section above */}

        {/* Location */}
        {locationText && (
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
              <MapPin className="mr-1 inline h-3 w-3" />
              Location
            </p>
            <p className="text-sm text-muted-foreground/70">{locationText}</p>
          </div>
        )}

        {/* Online Presence: Social links + Instagram */}
        {socialLinks.length > 0 && (
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
              <Globe className="mr-1 inline h-3 w-3" />
              Online Presence
              {followerCount !== null && (
                <span className="ml-2 text-muted-foreground/30">
                  {followerCount.toLocaleString()} followers
                </span>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {socialLinks.map((sl) => {
                const platform = normalizeSocialPlatform(sl.platform);
                const brandColor = SOCIAL_BRAND_COLORS[platform] ?? '#6366F1';
                const label = getSocialPlatformLabel(sl.platform);
                const isGradient = brandColor.startsWith('linear-gradient');
                const hoverStyle = {
                  '--social-brand-color': isGradient ? '#DD2A7B' : brandColor,
                  '--social-brand-shadow': isGradient ? '#DD2A7B40' : `${brandColor}40`,
                } as CSSProperties;

                return (
                  <a
                    key={`social-${platform}-${sl.url}`}
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

        {/* Business Signals */}
        {(rating !== null || acceptsOnlinePayments !== null || recentActivity !== null || physicalAddressPresent !== null) && (
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
              <Wifi className="mr-1 inline h-3 w-3" />
              Business Signals
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {rating !== null && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground/60">
                  <Star className="h-3 w-3 text-yellow-400" />
                  {rating}/5
                  {reviewCount !== null && reviewCount > 0 && (
                    <span className="text-muted-foreground/40">
                      ({reviewCount.toLocaleString()} reviews)
                    </span>
                  )}
                </span>
              )}
              {acceptsOnlinePayments !== null && (
                <SignalBadge label="Online Payments" active={acceptsOnlinePayments} />
              )}
              {recentActivity !== null && (
                <SignalBadge label="Recent Activity" active={recentActivity} />
              )}
              {physicalAddressPresent !== null && (
                <SignalBadge label="Physical Location" active={physicalAddressPresent} />
              )}
            </div>
          </div>
        )}

        {/* Tech Stack */}
        {techStack.length > 0 && (
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
              <Monitor className="mr-1 inline h-3 w-3" />
              Technology Stack
            </p>
            <div className="space-y-2">
              {techStack.map((cat) => (
                <div key={`tech-${cat.category}`}>
                  <p className="text-[10px] font-semibold text-muted-foreground/50">{cat.category}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {cat.technologies.map((tech) => (
                      <span key={`tech-${cat.category}-${tech}`} className="rounded-full bg-purple-500/10 px-2 py-0.5 text-[10px] font-semibold text-purple-300">
                        {tech}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Certifications */}
        {certifications.length > 0 && (
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
              <Shield className="mr-1 inline h-3 w-3" />
              Certifications
            </p>
            <div className="flex flex-wrap gap-1.5">
              {certifications.map((cert) => (
                <span key={`cert-${cert}`} className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                  {cert}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
