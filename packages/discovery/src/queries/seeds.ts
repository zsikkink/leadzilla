import type { DiscoverySeedProfile } from '../config.js';
import type { DiscoveryLanguageCode } from '../providers/types.js';
import {
  CuratedCountryCitiesByCode,
  SerpApiSupportedCountryCitiesByCode,
  SupportedCountryCodeValues,
  countryDisplayName,
} from '@lead-flood/contracts';

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
  '{category} in {city} contact us WhatsApp',
  '{category} in {city} DM for orders Instagram',
  '{category} in {city} order now send payment link',
];

export const smallQueryTemplatesEN: string[] = ['{category} in {city} contact us WhatsApp'];

export const queryTemplatesAR: string[] = [
  '{category} في {city} تواصل معنا واتساب',
  '{category} في {city} اطلب عبر انستقرام',
  '{category} في {city} اطلب الآن رابط دفع',
];

export const smallQueryTemplatesAR: string[] = ['{category} في {city} تواصل معنا واتساب'];

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
export const queryTemplatesV2EN: string[] = ['{category} in {city}'];

/** V2 query templates (Arabic). Use with generateTasksV2. */
export const queryTemplatesV2AR: string[] = ['{category} في {city}'];

/** V2 query templates for SerpAPI-backed runs that benefit from contact-signal biasing. */
export const queryTemplatesV2SerpApiEN: string[] = [
  '{category} in {city}',
  '{category} in {city} official website',
  '{category} in {city} whatsapp',
  '{category} in {city} instagram',
];

/** V2 Arabic query templates for SerpAPI-backed runs that benefit from contact-signal biasing. */
export const queryTemplatesV2SerpApiAR: string[] = [
  '{category} في {city}',
  '{category} في {city} الموقع الرسمي',
  '{category} في {city} واتساب',
  '{category} في {city} انستقرام',
];

/** ISO 3166-1 alpha-2 → human-readable country name. */
export const COUNTRY_NAMES: Record<string, string> = Object.fromEntries(
  SupportedCountryCodeValues.map((code) => [code, countryDisplayName(code)]),
);

/** Curated default cities for countries with known good discovery coverage. */
export const defaultCitiesByCountry: Record<string, string[]> = CuratedCountryCitiesByCode;

/** SerpAPI-backed default search locations for countries where broad city lists are too noisy. */
export const serpApiSearchCitiesByCountry: Record<string, string[]> =
  SerpApiSupportedCountryCitiesByCode;
