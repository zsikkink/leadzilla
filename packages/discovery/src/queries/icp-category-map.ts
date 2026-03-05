import { categoryTaxonomyEN } from './seeds.js';

/**
 * Mapping from ICP target industry keys to relevant search categories.
 *
 * Keys should be lowercase. The lookup normalises input by lowercasing and
 * replacing spaces with underscores so both "Luxury Services" and
 * "luxury_services" resolve correctly.
 */
export const ICP_INDUSTRY_CATEGORY_MAP: Record<string, string[]> = {
  // Underscore-separated canonical keys
  luxury_retail: ['fashion boutique', 'jewelry store', 'home decor', 'watch store', 'luxury goods'],
  luxury_services: ['fashion boutique', 'jewelry store', 'home decor', 'watch store', 'luxury goods', 'event planner', 'spa'],
  food_beverage: ['restaurant', 'coffee shop', 'bakery', 'catering service'],
  beauty_wellness: ['beauty salon', 'barbershop', 'spa', 'nail salon'],
  health_medical: ['dental clinic', 'medical clinic', 'pharmacy', 'optical store'],
  fitness: ['gym', 'fitness center', 'yoga studio', 'personal trainer'],
  events: ['event planner', 'wedding venue', 'catering service', 'party supplies'],
  automotive: ['car repair', 'auto accessories', 'car wash', 'car dealership'],
  education: ['tutoring center', 'language school', 'training institute', 'nursery'],
  home_services: ['cleaning service', 'moving service', 'plumber', 'electrician'],
  pets: ['pet shop', 'veterinary clinic', 'pet grooming'],
  retail: ['grocery store', 'electronics store', 'bookstore', 'furniture store', 'kids clothing'],
  hospitality: ['hotel', 'resort', 'serviced apartment', 'guest house'],
  ecommerce: ['online store', 'dropshipping', 'marketplace seller'],
  professional_services: ['accounting firm', 'law firm', 'consulting agency', 'recruitment agency'],

  // ICP profile industry names (underscore-canonical, auto-matched from DB values)
  yacht_charter: ['yacht charter', 'boat rental', 'luxury travel', 'marina'],
  private_aviation: ['private jet charter', 'aviation services', 'luxury travel'],
  luxury_travel: ['luxury travel agency', 'travel agency', 'hotel', 'resort', 'serviced apartment'],
  personal_shopping: ['fashion boutique', 'personal stylist', 'luxury goods', 'jewelry store'],
  corporate_gifting: ['gift shop', 'corporate gifting'],
  florists: ['flower shop'],
  gift_boxes: ['gift shop', 'gift boxes'],
  experience_platforms: ['event planner', 'experience platform'],
  bespoke_events: ['event planner', 'catering service'],
  wedding_planning: ['event planner', 'wedding planner', 'catering service'],
  event_production: ['event planner', 'event production'],
  exhibitions: ['event planner', 'exhibition organizer'],
  interior_design: ['interior design', 'home decor', 'furniture store'],
  renovation: ['renovation contractor', 'home decor'],
  architecture: ['architecture firm', 'interior design'],
  landscape_design: ['landscaping', 'garden design'],
  boutique_hotels: ['boutique hotel', 'hotel'],
  holiday_homes: ['holiday home rental', 'serviced apartment'],
  serviced_residences: ['serviced apartment'],
  property_management: ['property management', 'real estate'],
  wellness_clinics: ['wellness clinic', 'beauty salon', 'medical clinic'],
  aesthetic_medicine: ['aesthetic clinic', 'beauty salon', 'medical clinic'],
  medical_tourism: ['medical clinic', 'dental clinic'],
  executive_coaching: ['business coaching', 'consulting'],
  business_advisory: ['consulting', 'business advisory'],
  private_education: ['private school', 'training institute'],
  professional_training: ['training institute', 'professional training'],
  bootcamps: ['coding bootcamp', 'training institute'],
  certifications: ['training institute', 'certification center'],
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
    // Normalise: lowercase, trim, and replace spaces with underscores
    // so "Luxury Services" matches the "luxury_services" key.
    const key = industry.toLowerCase().trim().replaceAll(' ', '_');
    const mapped = ICP_INDUSTRY_CATEGORY_MAP[key];

    const categories = mapped ?? fuzzyMatchCategories(key);

    for (const cat of categories) {
      if (!seen.has(cat)) {
        seen.add(cat);
        result.push(cat);
      }
    }
  }

  return result;
}
