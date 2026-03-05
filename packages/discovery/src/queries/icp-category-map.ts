import { categoryTaxonomyEN } from './seeds.js';

/**
 * Mapping from ICP target industry keys to relevant search categories.
 * Keys must be lowercase. Includes both generic keys (luxury_retail)
 * and the actual ICP targetIndustry strings from seed data (luxury services).
 */
export const ICP_INDUSTRY_CATEGORY_MAP: Record<string, string[]> = {
  // Generic keys
  luxury_retail: ['fashion boutique', 'jewelry store', 'home decor', 'watch store', 'luxury goods'],
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

  // Segment A: Luxury & High-Ticket Services
  'luxury services': ['fashion boutique', 'home decor', 'flower shop'],
  'yacht charter': ['yacht charter', 'luxury boat rental'],
  'private aviation': ['private jet charter'],
  'luxury travel': ['luxury travel agency', 'boutique hotel'],
  'personal shopping': ['fashion boutique', 'personal stylist'],

  // Segment B: Gifting & Seasonal Commerce
  'corporate gifting': ['gift shop', 'corporate gifting'],
  'florists': ['flower shop'],
  'gift boxes': ['gift shop', 'gift boxes'],
  'experience platforms': ['event planner', 'experience platform'],
  'bespoke events': ['event planner', 'catering service'],

  // Segment C: Events & Experiences
  'wedding planning': ['event planner', 'wedding planner', 'catering service'],
  'event production': ['event planner', 'event production'],
  'exhibitions': ['event planner', 'exhibition organizer'],
  'pop-up markets': ['event planner', 'pop-up market'],
  'festivals': ['event planner', 'catering service', 'festival organizer'],

  // Segment D: Home & Design Projects
  'interior design': ['interior design', 'home decor', 'furniture store'],
  'renovation': ['renovation contractor', 'home decor'],
  'architecture': ['architecture firm', 'interior design'],
  'contracting': ['contractor', 'renovation contractor'],
  'landscape design': ['landscaping', 'garden design'],

  // Segment E: Hospitality & Accommodation
  'boutique hotels': ['boutique hotel', 'hotel'],
  'holiday homes': ['holiday home rental', 'serviced apartment'],
  'serviced residences': ['serviced apartment'],
  'property management': ['property management', 'real estate'],
  // 'hospitality' already mapped above

  // Segment F: Health & Wellness Premium
  'wellness clinics': ['wellness clinic', 'beauty salon', 'medical clinic'],
  'aesthetic medicine': ['aesthetic clinic', 'beauty salon', 'medical clinic'],
  'longevity': ['wellness clinic', 'medical clinic'],
  'iv therapy': ['wellness clinic', 'medical clinic'],
  'medical tourism': ['medical clinic', 'dental clinic'],

  // Segment G: Coaching & Advisory
  'executive coaching': ['business coaching', 'consulting'],
  'business advisory': ['consulting', 'business advisory'],
  'masterminds': ['business coaching', 'training institute'],
  'memberships': ['gym', 'membership club'],
  'consulting': ['consulting', 'business advisory'],

  // Segment H: Education & Training
  'private education': ['private school', 'training institute'],
  'professional training': ['training institute', 'professional training'],
  'bootcamps': ['coding bootcamp', 'training institute'],
  'certifications': ['training institute', 'certification center'],
  'cohort programs': ['training institute', 'online course'],
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
    const key = industry.toLowerCase().trim();
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
