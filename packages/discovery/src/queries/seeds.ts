import type { DiscoverySeedProfile } from '../config.js';
import type { DiscoveryLanguageCode } from '../providers/types.js';

export const categoryTaxonomyEN: string[] = [
  'bakery',
  'coffee shop',
  'restaurant',
  'beauty salon',
  'barbershop',
  'gym',
  'dental clinic',
  'medical clinic',
  'fashion boutique',
  'grocery store',
  'electronics store',
  'bookstore',
  'home decor',
  'flower shop',
  'cleaning service',
  'moving service',
  'car repair',
  'auto accessories',
  'pet shop',
  'event planner',
  'catering service',
  'furniture store',
  'kids clothing',
  'optical store',
];

export const smallCategoryTaxonomyEN: string[] = [
  'bakery',
  'coffee shop',
  'restaurant',
  'beauty salon',
  'barbershop',
  'gym',
  'dental clinic',
  'fashion boutique',
];

export const categoryTaxonomyAR: string[] = [
  'مخبز',
  'مقهى',
  'مطعم',
  'صالون تجميل',
  'حلاق',
  'نادي رياضي',
  'عيادة أسنان',
  'عيادة طبية',
  'بوتيك أزياء',
  'بقالة',
  'متجر إلكترونيات',
  'مكتبة',
  'ديكور منزلي',
  'محل ورد',
  'خدمات تنظيف',
  'خدمات نقل',
  'صيانة سيارات',
  'إكسسوارات سيارات',
  'متجر حيوانات',
  'منظم فعاليات',
  'خدمات ضيافة',
  'متجر أثاث',
  'ملابس أطفال',
  'محل نظارات',
];

export const smallCategoryTaxonomyAR: string[] = [
  'مخبز',
  'مقهى',
  'مطعم',
  'صالون تجميل',
  'حلاق',
  'نادي رياضي',
  'عيادة أسنان',
  'بوتيك أزياء',
];

export const queryTemplatesEN: string[] = [
  '{category} in {city} {country} contact us WhatsApp',
  '{category} in {city} {country} DM for orders Instagram',
  '{category} in {city} {country} order now send payment link',
];

export const smallQueryTemplatesEN: string[] = [
  '{category} in {city} {country} contact us WhatsApp',
];

export const queryTemplatesAR: string[] = [
  '{category} في {city} {country} تواصل معنا واتساب',
  '{category} في {city} {country} اطلب عبر انستقرام',
  '{category} في {city} {country} اطلب الآن رابط دفع',
];

export const smallQueryTemplatesAR: string[] = [
  '{category} في {city} {country} تواصل معنا واتساب',
];

export function getCategoryTaxonomy(
  language: DiscoveryLanguageCode,
  profile: DiscoverySeedProfile = 'default',
): string[] {
  if (profile === 'small') {
    return language === 'ar' ? smallCategoryTaxonomyAR : smallCategoryTaxonomyEN;
  }
  return language === 'ar' ? categoryTaxonomyAR : categoryTaxonomyEN;
}

export function getQueryTemplates(
  language: DiscoveryLanguageCode,
  profile: DiscoverySeedProfile = 'default',
): string[] {
  if (profile === 'small') {
    return language === 'ar' ? smallQueryTemplatesAR : smallQueryTemplatesEN;
  }
  return language === 'ar' ? queryTemplatesAR : queryTemplatesEN;
}

/* ------------------------------------------------------------------ */
/* V2 additions — ICP-driven discovery                                */
/* ------------------------------------------------------------------ */

/** V2 query templates (English). Use with generateTasksV2. */
export const queryTemplatesV2EN: string[] = [
  '{category} in {city} {country}',
  '{category} in {city} {country} order online',
  '{category} in {city} {country} request quote custom',
];

/** ISO 3166-1 alpha-2 → human-readable country name. */
export const COUNTRY_NAMES: Record<string, string> = {
  AE: 'United Arab Emirates',
  SA: 'Saudi Arabia',
  JO: 'Jordan',
  EG: 'Egypt',
  QA: 'Qatar',
  BH: 'Bahrain',
  KW: 'Kuwait',
  OM: 'Oman',
  LB: 'Lebanon',
  IQ: 'Iraq',
  MA: 'Morocco',
  TN: 'Tunisia',
  DZ: 'Algeria',
  LY: 'Libya',
  YE: 'Yemen',
  SY: 'Syria',
  PS: 'Palestine',
  SD: 'Sudan',
  US: 'United States',
  GB: 'United Kingdom',
};

/**
 * Common country name/abbreviation → ISO alpha-2 code.
 * Used to normalize ICP targetCountries (which may contain "UAE", "KSA", etc.)
 * into the ISO codes expected by generateTasksV2.
 */
export const COUNTRY_NAME_TO_ISO: Record<string, string> = {
  uae: 'AE',
  ksa: 'SA',
  egypt: 'EG',
  jordan: 'JO',
  bahrain: 'BH',
  kuwait: 'KW',
  oman: 'OM',
  qatar: 'QA',
  lebanon: 'LB',
  iraq: 'IQ',
  morocco: 'MA',
  tunisia: 'TN',
  algeria: 'DZ',
  libya: 'LY',
  yemen: 'YE',
  'united arab emirates': 'AE',
  'saudi arabia': 'SA',
  // Already ISO codes (passthrough)
  ae: 'AE',
  sa: 'SA',
  eg: 'EG',
  jo: 'JO',
  bh: 'BH',
  kw: 'KW',
  om: 'OM',
  qa: 'QA',
  lb: 'LB',
  iq: 'IQ',
};

/** Default cities per country code for V2 discovery. */
export const defaultCitiesByCountry: Record<string, string[]> = {
  AE: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman'],
  SA: ['Riyadh', 'Jeddah', 'Dammam', 'Mecca'],
  JO: ['Amman', 'Irbid', 'Zarqa', 'Aqaba'],
  EG: ['Cairo', 'Alexandria', 'Giza', 'Mansoura'],
  QA: ['Doha'],
  BH: ['Manama'],
  KW: ['Kuwait City'],
  OM: ['Muscat'],
  LB: ['Beirut'],
  IQ: ['Baghdad', 'Erbil', 'Basra'],
  MA: ['Casablanca', 'Rabat', 'Marrakech'],
  TN: ['Tunis', 'Sfax'],
  DZ: ['Algiers', 'Oran'],
  LY: ['Tripoli', 'Benghazi'],
  YE: ['Sanaa', 'Aden'],
  SY: ['Damascus', 'Aleppo'],
  PS: ['Ramallah', 'Gaza'],
  SD: ['Khartoum'],
};
