/**
 * Consolidated company profile — merges data from multiple scrape sources
 * (website, Instagram, SerpAPI) into a unified company profile.
 *
 * Used to determine if we already have enough data to skip PDL enrichment.
 */

export interface ConsolidatedCompanyProfile {
  companyName: string | null;
  industry: string | null;
  employeeCount: number | null;
  country: string | null;
  city: string | null;
  websiteDomain: string | null;
  phone: string | null;
  email: string | null;

  // Tech & social presence
  techStack: string[];
  socialPlatforms: string[];
  hasCrm: boolean;
  hasLiveChat: boolean;
  hasAnalytics: boolean;
  hasEcommerce: boolean;

  // Business signals
  certifications: string[];
  hasClientLogos: boolean;
  hasTestimonials: boolean;
  hasCaseStudies: boolean;
  rating: number | null;
  reviewCount: number | null;

  // Instagram signals
  instagramFollowerCount: number | null;
  instagramIsVerified: boolean;
  instagramIsBusinessAccount: boolean;
  instagramBusinessCategory: string | null;

  // Decision makers
  decisionMakerCount: number;
  hasExecutiveContact: boolean;

  // Completeness score (0-1) — higher means less need for PDL
  completenessScore: number;
}

interface WebsiteScrapeData {
  decisionMakers?: Array<{
    name: string;
    title: string | null;
    email: string | null;
    seniority: string;
  }>;
  contactInfo?: {
    emails?: Array<{ email: string }>;
    phones?: Array<{ number: string }>;
  };
  socialLinks?: Array<{
    platform: string;
    url: string;
  }>;
  technologies?: {
    analytics?: string[];
    crm?: string[];
    liveChat?: string[];
    emailMarketing?: string[];
    ecommerce?: string[];
    payments?: string[];
    cssFrameworks?: string[];
    hosting?: string[];
  };
  businessSignals?: {
    estimatedEmployeeCount?: number | null;
    certifications?: string[];
    hasClientLogos?: boolean;
    hasTestimonials?: boolean;
    hasCaseStudies?: boolean;
  };
}

interface InstagramScrapeData {
  followerCount?: number;
  isVerified?: boolean;
  isBusinessAccount?: boolean;
  businessCategory?: string | null;
  businessEmail?: string | null;
  businessPhone?: string | null;
  isProfessionalAccount?: boolean;
}

interface BusinessRecord {
  name: string;
  websiteDomain: string | null;
  category: string | null;
  countryCode: string | null;
  city: string | null;
  phoneE164: string | null;
  rating: number | null;
  reviewCount: number | null;
  apifyWebsiteScrapeJson: unknown;
  apifyInstagramScrapeJson: unknown;
}

/**
 * Merge data from website scrape, Instagram scrape, and the Business record
 * into a unified company profile.
 */
export function consolidateCompanyProfile(
  business: BusinessRecord,
): ConsolidatedCompanyProfile {
  const websiteData = (business.apifyWebsiteScrapeJson ?? {}) as WebsiteScrapeData;
  const igData = (business.apifyInstagramScrapeJson ?? {}) as InstagramScrapeData;

  // Company name — use business name
  const companyName = business.name || null;

  // Industry — from SerpAPI category or Instagram business category
  const industry = business.category ?? igData.businessCategory ?? null;

  // Employee count — from website scrape signals
  const employeeCount = websiteData.businessSignals?.estimatedEmployeeCount ?? null;

  // Location
  const country = business.countryCode ?? null;
  const city = business.city ?? null;

  // Contact info
  const websiteEmails = websiteData.contactInfo?.emails ?? [];
  const websitePhones = websiteData.contactInfo?.phones ?? [];
  const email = websiteEmails[0]?.email ?? igData.businessEmail ?? null;
  const phone = business.phoneE164 ?? websitePhones[0]?.number ?? igData.businessPhone ?? null;

  // Tech stack
  const tech = websiteData.technologies;
  const techStack: string[] = [];
  if (tech) {
    for (const [, tools] of Object.entries(tech)) {
      if (Array.isArray(tools)) {
        techStack.push(...tools);
      }
    }
  }
  const hasCrm = Boolean(tech?.crm && tech.crm.length > 0);
  const hasLiveChat = Boolean(tech?.liveChat && tech.liveChat.length > 0);
  const hasAnalytics = Boolean(tech?.analytics && tech.analytics.length > 0);
  const hasEcommerce = Boolean(tech?.ecommerce && tech.ecommerce.length > 0);

  // Social presence
  const socialLinks = websiteData.socialLinks ?? [];
  const socialPlatforms = [...new Set(socialLinks.map((s) => s.platform))];

  // Business signals
  const certifications = websiteData.businessSignals?.certifications ?? [];
  const hasClientLogos = websiteData.businessSignals?.hasClientLogos ?? false;
  const hasTestimonials = websiteData.businessSignals?.hasTestimonials ?? false;
  const hasCaseStudies = websiteData.businessSignals?.hasCaseStudies ?? false;

  // Instagram
  const instagramFollowerCount = igData.followerCount ?? null;
  const instagramIsVerified = igData.isVerified ?? false;
  const instagramIsBusinessAccount = igData.isBusinessAccount ?? igData.isProfessionalAccount ?? false;
  const instagramBusinessCategory = igData.businessCategory ?? null;

  // Decision makers
  const decisionMakers = websiteData.decisionMakers ?? [];
  const decisionMakerCount = decisionMakers.length;
  const hasExecutiveContact = decisionMakers.some(
    (dm) => dm.seniority === 'executive' || dm.seniority === 'director',
  );

  // Completeness score — weighted sum of available data fields
  let completenessScore = 0;
  if (companyName) completenessScore += 0.10;
  if (industry) completenessScore += 0.15;
  if (employeeCount !== null) completenessScore += 0.15;
  if (country) completenessScore += 0.05;
  if (email) completenessScore += 0.10;
  if (phone) completenessScore += 0.05;
  if (techStack.length > 0) completenessScore += 0.10;
  if (socialPlatforms.length > 0) completenessScore += 0.05;
  if (certifications.length > 0) completenessScore += 0.05;
  if (instagramFollowerCount !== null) completenessScore += 0.05;
  if (decisionMakerCount > 0) completenessScore += 0.10;
  if (business.reviewCount !== null && business.reviewCount > 0) completenessScore += 0.05;
  completenessScore = Math.min(1, completenessScore);

  return {
    companyName,
    industry,
    employeeCount,
    country,
    city,
    websiteDomain: business.websiteDomain,
    phone,
    email,
    techStack,
    socialPlatforms,
    hasCrm,
    hasLiveChat,
    hasAnalytics,
    hasEcommerce,
    certifications,
    hasClientLogos,
    hasTestimonials,
    hasCaseStudies,
    rating: business.rating,
    reviewCount: business.reviewCount,
    instagramFollowerCount,
    instagramIsVerified,
    instagramIsBusinessAccount,
    instagramBusinessCategory,
    decisionMakerCount,
    hasExecutiveContact,
    completenessScore,
  };
}

/**
 * Check if a consolidated profile is complete enough to skip PDL enrichment.
 * Requires: industry + employee count + company name (the key fields PDL provides).
 */
export function isProfileSufficientForEnrichment(profile: ConsolidatedCompanyProfile): boolean {
  return Boolean(
    profile.industry &&
    profile.employeeCount !== null &&
    profile.companyName,
  );
}

/**
 * Convert a consolidated profile to a NormalizedEnrichmentPayload shape.
 * This allows skipping PDL and using scraped data directly for enrichment.
 */
export function profileToEnrichmentPayload(
  profile: ConsolidatedCompanyProfile,
): {
  email: string | null;
  phone: string | null;
  domain: string | null;
  companyName: string | null;
  industry: string | null;
  employeeCount: number | null;
  country: string | null;
  city: string | null;
  linkedinUrl: string | null;
  website: string | null;
} {
  return {
    email: profile.email,
    phone: profile.phone,
    domain: profile.websiteDomain,
    companyName: profile.companyName,
    industry: profile.industry,
    employeeCount: profile.employeeCount,
    country: profile.country,
    city: profile.city,
    linkedinUrl: null,
    website: profile.websiteDomain ? `https://${profile.websiteDomain}` : null,
  };
}
