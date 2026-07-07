import { categoryTaxonomyEN } from './seeds.js';

/**
 * ICP Industry → Search Category Map
 *
 * Maps ICP target industry keys to Google Maps search categories.
 * Categories become queries like "{category} in {city}" — they must be terms
 * that real businesses use on Google Maps listings.
 *
 * CONSTRAINTS:
 * - Within each ICP profile, NO two industries may share a category (wastes
 *   SerpAPI credits and produces duplicate businesses). The dedup in
 *   mapIcpIndustriesToCategories handles runtime collisions, but the map
 *   should be structured to avoid them at source.
 * - Different ICPs CAN share categories — only intra-ICP uniqueness matters.
 *
 * KEY FORMAT: lowercase, spaces replaced with underscores. The lookup
 * normalises input so both "Luxury Services" and "luxury_services" resolve.
 *
 * COVERAGE: 53 industries mapped, ~200 unique categories across all ICPs.
 *
 * Mapping strategy:
 * 1. Each industry gets 3-6 specific, non-overlapping categories
 * 2. Categories are terms businesses actually list on Google Maps in UAE/MENA
 * 3. Generic categories (e.g., "store") avoided in favour of specific ones
 * 4. Previously unmapped industries now have direct mappings
 *
 * Last audited: 2026-03-06 — verified against 8 active ICP profiles in DB
 * and Leadzilla ICP & Offerings PDF (segments A-H).
 */
export const ICP_INDUSTRY_CATEGORY_MAP: Record<string, string[]> = {
  // ── ICP A: Luxury & High-Ticket Services ────────────────────────────
  // Industries: Luxury Services, Yacht Charter, Private Aviation, Luxury Travel, Personal Shopping
  luxury_services: ['jewelry store', 'watch store', 'luxury goods store', 'spa', 'concierge service', 'luxury car rental'],
  yacht_charter: ['yacht charter', 'boat rental', 'marina', 'yacht broker'],
  private_aviation: ['private jet charter', 'aviation services', 'helicopter tour'],
  luxury_travel: ['luxury travel agency', 'travel agency', 'tour operator'],
  personal_shopping: ['fashion boutique', 'personal stylist', 'designer clothing store', 'luxury boutique'],

  // ── ICP B: Gifting, Corporate & Bespoke Experiences ─────────────────
  // Industries: Corporate Gifting, Florists, Gift Boxes, Experience Platforms, Bespoke Events
  corporate_gifting: ['corporate gifting', 'gift shop', 'gift hamper'],
  florists: ['flower shop', 'flower delivery', 'wedding florist'],
  gift_boxes: ['chocolate shop', 'gift basket store', 'gourmet food store', 'custom gift shop'],
  experience_platforms: ['experience gift shop', 'activity center', 'adventure tour operator'],
  bespoke_events: ['event planner', 'catering service', 'party planner', 'event decorator'],

  // ── ICP C: Events, Weddings & Experiential Operators ────────────────
  // Industries: Wedding Planning, Event Production, Exhibitions, Pop-up Markets, Festivals
  wedding_planning: ['wedding planner', 'wedding venue', 'bridal shop', 'destination wedding planner'],
  event_production: ['event management company', 'event rental', 'AV rental', 'stage design'],
  exhibitions: ['exhibition organizer', 'convention center', 'trade show organizer', 'expo organizer'],
  'pop-up_markets': ['pop-up shop', 'artisan market', 'weekend market', 'flea market'],
  festivals: ['festival organizer', 'outdoor event venue', 'concert venue', 'event agency'],

  // ── ICP D: Home, Design & High-Value Contracting ────────────────────
  // Industries: Interior Design, Renovation, Architecture, Contracting, Landscape Design
  interior_design: ['interior designer', 'home decor store', 'furniture showroom', 'kitchen design', 'lighting showroom'],
  renovation: ['renovation contractor', 'fit-out company', 'tiling store', 'flooring store', 'painting contractor'],
  architecture: ['architecture firm', 'architectural consultant'],
  contracting: ['general contractor', 'construction company', 'maintenance company', 'MEP contractor'],
  landscape_design: ['landscaping company', 'garden center', 'garden design', 'outdoor furniture store'],

  // ── ICP E: Boutique Hospitality & Short-Stay Operators ──────────────
  // Industries: Boutique Hotels, Holiday Homes, Serviced Residences, Property Management, Hospitality
  boutique_hotels: ['boutique hotel', 'bed and breakfast', 'heritage hotel'],
  holiday_homes: ['holiday home rental', 'vacation rental', 'villa rental', 'chalet rental'],
  serviced_residences: ['serviced apartment', 'furnished apartment', 'aparthotel'],
  property_management: ['property management company', 'real estate agency', 'facilities management'],
  hospitality: ['hotel', 'resort', 'guest house', 'hostel'],

  // ── ICP F: Premium Wellness & Longevity Clinics ─────────────────────
  // Industries: Wellness Clinics, Aesthetic Medicine, Longevity, IV Therapy, Medical Tourism
  wellness_clinics: ['wellness clinic', 'wellness center', 'holistic health center', 'physiotherapy clinic'],
  aesthetic_medicine: ['aesthetic clinic', 'cosmetic clinic', 'dermatology clinic', 'laser clinic', 'med spa', 'beauty salon'],
  longevity: ['anti-aging clinic', 'regenerative medicine clinic', 'longevity clinic', 'functional medicine clinic'],
  iv_therapy: ['IV drip clinic', 'IV therapy clinic', 'vitamin infusion clinic'],
  medical_tourism: ['medical clinic', 'dental clinic', 'medical center', 'health tourism agency'],

  // ── ICP G: High-Ticket Coaching & Advisory ──────────────────────────
  // Industries: Executive Coaching, Business Advisory, Masterminds, Memberships, Consulting
  executive_coaching: ['executive coach', 'life coach', 'leadership coach', 'career coach', 'business coach'],
  business_advisory: ['business advisory firm', 'financial advisor', 'management consultant', 'strategy consultant'],
  masterminds: ['coworking space', 'business center', 'startup accelerator', 'innovation hub'],
  memberships: ['private members club', 'country club', 'social club', 'business club'],
  consulting: ['consulting firm', 'consulting agency', 'IT consultant', 'HR consultant'],

  // ── ICP H: Education & Training Providers ───────────────────────────
  // Industries: Private Education, Professional Training, Bootcamps, Certifications, Cohort Programs
  private_education: ['private school', 'international school', 'nursery', 'preschool', 'kindergarten'],
  professional_training: ['training institute', 'training center', 'corporate training center', 'professional development center'],
  bootcamps: ['coding bootcamp', 'tech academy', 'programming school'],
  certifications: ['certification center', 'test prep center', 'exam center'],
  cohort_programs: ['learning center', 'education center', 'workshop space', 'tutoring center', 'language school'],

  // ── General categories (for custom/UI-created ICPs) ─────────────────
  luxury_retail: ['luxury boutique', 'designer store', 'high-end fashion store', 'jewelry store', 'watch store'],
  food_beverage: ['restaurant', 'coffee shop', 'bakery', 'catering service', 'juice bar', 'ice cream shop', 'food truck'],
  beauty_wellness: ['beauty salon', 'barbershop', 'spa', 'nail salon', 'massage center', 'lash studio'],
  health_medical: ['dental clinic', 'medical clinic', 'pharmacy', 'optical store', 'laboratory'],
  fitness: ['gym', 'fitness center', 'yoga studio', 'personal trainer', 'Pilates studio', 'CrossFit gym', 'martial arts studio'],
  events: ['event planner', 'wedding venue', 'catering service', 'party supplies', 'DJ service', 'photography studio'],
  automotive: ['car repair', 'auto accessories', 'car wash', 'car dealership', 'tire shop', 'car detailing'],
  education: ['tutoring center', 'language school', 'training institute', 'nursery', 'driving school', 'music school', 'art school'],
  home_services: ['cleaning service', 'moving service', 'plumber', 'electrician', 'pest control', 'handyman', 'locksmith'],
  pets: ['pet shop', 'veterinary clinic', 'pet grooming', 'pet boarding', 'dog trainer'],
  retail: ['grocery store', 'electronics store', 'bookstore', 'furniture store', 'kids clothing', 'toy store', 'sports store', 'stationery store'],
  ecommerce: ['online store', 'dropshipping', 'marketplace seller'],
  professional_services: ['accounting firm', 'law firm', 'consulting agency', 'recruitment agency'],
};

/**
 * Fuzzy-match an unknown industry key against the category taxonomy.
 * Splits the industry on `_` and returns any taxonomy entry whose words
 * overlap with the industry tokens.
 */
function fuzzyMatchCategories(industry: string): string[] {
  const tokens = industry.toLowerCase().split(/[_\s]+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return [];

  return categoryTaxonomyEN.filter((category) => {
    const categoryWords = category.toLowerCase().split(/\s+/);
    return tokens.some((token) => categoryWords.includes(token));
  });
}

/**
 * Convert ICP target industries to search categories.
 *
 * - Known industries are mapped via `ICP_INDUSTRY_CATEGORY_MAP`.
 * - Unknown industries fall back to fuzzy matching against the full taxonomy.
 * - If fuzzy matching also fails, the raw industry name is used as a search category.
 * - Empty or missing input returns the full `categoryTaxonomyEN`.
 * - Results are deduplicated.
 */
export function mapIcpIndustriesToCategories(targetIndustries: string[]): string[] {
  if (targetIndustries.length === 0) {
    return [...categoryTaxonomyEN];
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const industry of targetIndustries) {
    const key = industry.toLowerCase().trim().replaceAll(' ', '_');
    const mapped = ICP_INDUSTRY_CATEGORY_MAP[key];

    if (mapped) {
      for (const cat of mapped) {
        if (!seen.has(cat)) {
          seen.add(cat);
          result.push(cat);
        }
      }
      continue;
    }

    const fuzzy = fuzzyMatchCategories(key);
    if (fuzzy.length > 0) {
      for (const cat of fuzzy) {
        if (!seen.has(cat)) {
          seen.add(cat);
          result.push(cat);
        }
      }
      continue;
    }

    // No match — use the raw industry name as a search category.
    // "kite surfing" becomes a query: "kite surfing in Dubai"
    const rawCategory = industry.trim();
    if (rawCategory.length > 0 && !seen.has(rawCategory.toLowerCase())) {
      seen.add(rawCategory.toLowerCase());
      result.push(rawCategory);
      console.warn(
        `[icp-category-map] No mapping for industry "${industry}" — using as direct search category`,
      );
    }
  }

  return result;
}

// ── Preview & Override helpers ────────────────────────────────────────

export interface IndustryMappingPreview {
  industry: string;
  categories: string[];
  source: 'mapped' | 'fuzzy' | 'direct';
}

/**
 * Preview the category mapping for each industry individually.
 * Used by the UI to show what each industry expands to.
 */
export function previewIndustryMappings(targetIndustries: string[]): IndustryMappingPreview[] {
  return targetIndustries.map((industry) => {
    const key = industry.toLowerCase().trim().replaceAll(' ', '_');
    const mapped = ICP_INDUSTRY_CATEGORY_MAP[key];

    if (mapped) {
      return { industry, categories: [...mapped], source: 'mapped' as const };
    }

    const fuzzy = fuzzyMatchCategories(key);
    if (fuzzy.length > 0) {
      return { industry, categories: fuzzy, source: 'fuzzy' as const };
    }

    return { industry, categories: [industry.trim()], source: 'direct' as const };
  });
}

/**
 * Apply user overrides (added/removed categories per industry) on top of
 * the base industry→category mapping. Used at discovery seed time.
 */
export function mapIcpIndustriesWithOverrides(
  targetIndustries: string[],
  overrides?: Record<string, { add?: string[]; remove?: string[] }> | undefined,
): string[] {
  const previews = previewIndustryMappings(targetIndustries);
  const seen = new Set<string>();
  const result: string[] = [];

  for (const preview of previews) {
    const key = preview.industry.toLowerCase().trim().replaceAll(' ', '_');
    const override = overrides?.[key];
    let categories = [...preview.categories];

    if (override?.remove) {
      const removeSet = new Set(override.remove.map((r) => r.toLowerCase()));
      categories = categories.filter((c) => !removeSet.has(c.toLowerCase()));
    }
    if (override?.add) {
      categories.push(...override.add);
    }

    for (const cat of categories) {
      const lower = cat.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        result.push(cat);
      }
    }
  }

  return result;
}
