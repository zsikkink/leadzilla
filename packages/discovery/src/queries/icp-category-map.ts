import { categoryTaxonomyEN } from './seeds.js';

/**
 * Mapping from ICP target industry keys to relevant search categories.
 */
export const ICP_INDUSTRY_CATEGORY_MAP: Record<string, string[]> = {
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
  professional_services: [
    'accounting firm',
    'law firm',
    'consulting agency',
    'recruitment agency',
  ],
};

/**
 * Fuzzy-match an unknown industry key against the category taxonomy.
 * Splits the industry on `_` and returns any taxonomy entry whose words
 * overlap with the industry tokens.
 */
function fuzzyMatchCategories(industry: string): string[] {
  const tokens = industry.toLowerCase().split('_').filter((t) => t.length > 0);
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
