import { z } from 'zod';

export const SupportedCountryCodeValues = [
  'AD',
  'AE',
  'AF',
  'AG',
  'AI',
  'AL',
  'AM',
  'AO',
  'AQ',
  'AR',
  'AS',
  'AT',
  'AU',
  'AW',
  'AX',
  'AZ',
  'BA',
  'BB',
  'BD',
  'BE',
  'BF',
  'BG',
  'BH',
  'BI',
  'BJ',
  'BL',
  'BM',
  'BN',
  'BO',
  'BQ',
  'BR',
  'BS',
  'BT',
  'BV',
  'BW',
  'BY',
  'BZ',
  'CA',
  'CC',
  'CD',
  'CF',
  'CG',
  'CH',
  'CI',
  'CK',
  'CL',
  'CM',
  'CN',
  'CO',
  'CR',
  'CU',
  'CV',
  'CW',
  'CX',
  'CY',
  'CZ',
  'DE',
  'DJ',
  'DK',
  'DM',
  'DO',
  'DZ',
  'EC',
  'EE',
  'EG',
  'EH',
  'ER',
  'ES',
  'ET',
  'FI',
  'FJ',
  'FK',
  'FM',
  'FO',
  'FR',
  'GA',
  'GB',
  'GD',
  'GE',
  'GF',
  'GG',
  'GH',
  'GI',
  'GL',
  'GM',
  'GN',
  'GP',
  'GQ',
  'GR',
  'GS',
  'GT',
  'GU',
  'GW',
  'GY',
  'HK',
  'HM',
  'HN',
  'HR',
  'HT',
  'HU',
  'ID',
  'IE',
  'IL',
  'IM',
  'IN',
  'IO',
  'IQ',
  'IR',
  'IS',
  'IT',
  'JE',
  'JM',
  'JO',
  'JP',
  'KE',
  'KG',
  'KH',
  'KI',
  'KM',
  'KN',
  'KP',
  'KR',
  'KW',
  'KY',
  'KZ',
  'LA',
  'LB',
  'LC',
  'LI',
  'LK',
  'LR',
  'LS',
  'LT',
  'LU',
  'LV',
  'LY',
  'MA',
  'MC',
  'MD',
  'ME',
  'MF',
  'MG',
  'MH',
  'MK',
  'ML',
  'MM',
  'MN',
  'MO',
  'MP',
  'MQ',
  'MR',
  'MS',
  'MT',
  'MU',
  'MV',
  'MW',
  'MX',
  'MY',
  'MZ',
  'NA',
  'NC',
  'NE',
  'NF',
  'NG',
  'NI',
  'NL',
  'NO',
  'NP',
  'NR',
  'NU',
  'NZ',
  'OM',
  'PA',
  'PE',
  'PF',
  'PG',
  'PH',
  'PK',
  'PL',
  'PM',
  'PN',
  'PR',
  'PS',
  'PT',
  'PW',
  'PY',
  'QA',
  'RE',
  'RO',
  'RS',
  'RU',
  'RW',
  'SA',
  'SB',
  'SC',
  'SD',
  'SE',
  'SG',
  'SH',
  'SI',
  'SJ',
  'SK',
  'SL',
  'SM',
  'SN',
  'SO',
  'SR',
  'SS',
  'ST',
  'SV',
  'SX',
  'SY',
  'SZ',
  'TC',
  'TD',
  'TF',
  'TG',
  'TH',
  'TJ',
  'TK',
  'TL',
  'TM',
  'TN',
  'TO',
  'TR',
  'TT',
  'TV',
  'TW',
  'TZ',
  'UA',
  'UG',
  'UM',
  'US',
  'UY',
  'UZ',
  'VA',
  'VC',
  'VE',
  'VG',
  'VI',
  'VN',
  'VU',
  'WF',
  'WS',
  'YE',
  'YT',
  'ZA',
  'ZM',
  'ZW',
] as const;

export const SupportedCountryCodeSchema = z.enum(SupportedCountryCodeValues);

export type SupportedCountryCode = z.infer<typeof SupportedCountryCodeSchema>;

export type CountryCitiesMap = Partial<Record<SupportedCountryCode, string[]>>;

const SUPPORTED_COUNTRY_CODE_SET = new Set<SupportedCountryCode>(SupportedCountryCodeValues);

const REGION_DISPLAY_NAMES =
  typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames(['en'], { type: 'region' })
    : null;

const DISPLAY_NAME_OVERRIDES: Partial<Record<SupportedCountryCode, string>> = {
  GB: 'United Kingdom',
  PS: 'Palestine',
  SZ: 'Eswatini',
  TL: 'Timor-Leste',
};

const CUSTOM_ALIAS_TO_CODE: Record<string, SupportedCountryCode> = {
  uae: 'AE',
  ksa: 'SA',
  uk: 'GB',
  usa: 'US',
  us: 'US',
  'u s': 'US',
  'u s a': 'US',
  'united states of america': 'US',
  'great britain': 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  'northern ireland': 'GB',
  'britain uk': 'GB',
  'united arab emirates': 'AE',
  'saudi arabia': 'SA',
  'palestinian territories': 'PS',
  'south korea': 'KR',
  'north korea': 'KP',
  czechia: 'CZ',
  turkey: 'TR',
  turkiye: 'TR',
  türkiye: 'TR',
  myanmar: 'MM',
  burma: 'MM',
  laos: 'LA',
  russia: 'RU',
  moldova: 'MD',
  taiwan: 'TW',
  vietnam: 'VN',
  syria: 'SY',
  tanzania: 'TZ',
  venezuela: 'VE',
};

function normalizeCountryAliasKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupeCities(values: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = value.trim();
    if (normalized.length === 0) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function buildCountryAliasMap(): Record<string, SupportedCountryCode> {
  const aliases: Record<string, SupportedCountryCode> = {};

  for (const code of SupportedCountryCodeValues) {
    aliases[normalizeCountryAliasKey(code)] = code;
    aliases[normalizeCountryAliasKey(countryDisplayName(code))] = code;
  }

  return {
    ...aliases,
    ...CUSTOM_ALIAS_TO_CODE,
  };
}

function buildCountryAliasesByCode(): Partial<Record<SupportedCountryCode, string[]>> {
  const grouped: Partial<Record<SupportedCountryCode, string[]>> = {};

  for (const [alias, code] of Object.entries(CUSTOM_ALIAS_TO_CODE)) {
    grouped[code] = [...(grouped[code] ?? []), alias];
  }

  return grouped;
}

const COUNTRY_ALIAS_TO_CODE = buildCountryAliasMap();
const COUNTRY_ALIASES_BY_CODE = buildCountryAliasesByCode();

export const CuratedCountryCitiesByCode: CountryCitiesMap = {
  AE: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Fujairah', 'Umm Al Quwain', 'Al Ain'],
  SA: ['Riyadh', 'Jeddah', 'Mecca', 'Medina', 'Dammam', 'Khobar', 'Tabuk', 'Abha'],
  EG: ['Cairo', 'Alexandria', 'Giza', 'Sharm El Sheikh'],
  JO: ['Amman', 'Irbid', 'Zarqa', 'Aqaba'],
  BH: ['Manama', 'Riffa', 'Muharraq', 'Hamad Town'],
  KW: ['Kuwait City', 'Hawalli', 'Salmiya', 'Jahra'],
  OM: ['Muscat', 'Salalah', 'Nizwa', 'Sohar'],
  QA: ['Doha', 'Al Wakrah', 'Al Khor', 'Lusail'],
  LB: ['Beirut', 'Tripoli', 'Sidon', 'Jounieh'],
  IQ: ['Baghdad', 'Basra', 'Erbil', 'Sulaymaniyah'],
  MA: ['Casablanca', 'Rabat', 'Marrakech', 'Fez', 'Tangier'],
  TN: ['Tunis', 'Sfax', 'Sousse', 'Kairouan'],
  DZ: ['Algiers', 'Oran', 'Constantine', 'Annaba'],
  LY: ['Tripoli', 'Benghazi', 'Misrata', 'Sabha'],
  YE: ['Sanaa', 'Aden', 'Taiz', 'Hodeidah'],
  SY: ['Damascus', 'Aleppo', 'Homs', 'Latakia'],
  PS: ['Ramallah', 'Gaza', 'Hebron', 'Bethlehem', 'Nablus'],
  SD: ['Khartoum', 'Omdurman', 'Port Sudan', 'Kassala'],
};

export const SupportedCountryOptions = SupportedCountryCodeValues
  .map((code) => ({
    code,
    label: countryDisplayName(code),
    searchText: [
      code,
      countryDisplayName(code),
      ...(COUNTRY_ALIASES_BY_CODE[code] ?? []),
    ]
      .map((entry) => normalizeCountryAliasKey(entry))
      .join(' '),
  }))
  .sort((a, b) => a.label.localeCompare(b.label));

export function isSupportedCountryCode(value: string | null | undefined): value is SupportedCountryCode {
  if (!value) {
    return false;
  }
  return SUPPORTED_COUNTRY_CODE_SET.has(value.trim().toUpperCase() as SupportedCountryCode);
}

export function countryDisplayName(code: string): string {
  const normalized = code.trim().toUpperCase();
  if (!normalized) {
    return code;
  }

  if (isSupportedCountryCode(normalized)) {
    return DISPLAY_NAME_OVERRIDES[normalized] ?? REGION_DISPLAY_NAMES?.of(normalized) ?? normalized;
  }

  return code;
}

export function normalizeCountryCodeOrAlias(
  value: string | null | undefined,
): SupportedCountryCode | null {
  if (!value) {
    return null;
  }

  const upper = value.trim().toUpperCase();
  if (isSupportedCountryCode(upper)) {
    return upper;
  }

  return COUNTRY_ALIAS_TO_CODE[normalizeCountryAliasKey(value)] ?? null;
}

export function normalizeCountryCodes(
  values: readonly (string | null | undefined)[],
): SupportedCountryCode[] {
  const result: SupportedCountryCode[] = [];
  const seen = new Set<SupportedCountryCode>();

  for (const value of values) {
    const normalized = normalizeCountryCodeOrAlias(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

export function normalizeCountryCitiesMap(value: unknown): CountryCitiesMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const normalized: CountryCitiesMap = {};

  for (const [rawCountry, rawCities] of Object.entries(value as Record<string, unknown>)) {
    const code = normalizeCountryCodeOrAlias(rawCountry);
    if (!code) {
      continue;
    }

    const cities =
      Array.isArray(rawCities)
        ? rawCities.filter((entry): entry is string => typeof entry === 'string')
        : [];

    normalized[code] = dedupeCities([
      ...(normalized[code] ?? []),
      ...cities,
    ]);
  }

  return normalized;
}

export function buildCountryCitiesMap(
  value: unknown,
  options?: { includeCuratedDefaults?: boolean | undefined },
): CountryCitiesMap {
  const includeCuratedDefaults = options?.includeCuratedDefaults ?? false;
  const normalized = normalizeCountryCitiesMap(value);

  if (!includeCuratedDefaults) {
    return normalized;
  }

  const merged: CountryCitiesMap = {};

  for (const [code, cities] of Object.entries(CuratedCountryCitiesByCode) as Array<
    [SupportedCountryCode, string[]]
  >) {
    merged[code] = dedupeCities(cities);
  }

  for (const [code, cities] of Object.entries(normalized) as Array<
    [SupportedCountryCode, string[]]
  >) {
    merged[code] = dedupeCities([...(merged[code] ?? []), ...cities]);
  }

  return merged;
}

export function findCountriesMissingCities(
  countries: readonly (string | null | undefined)[],
  countryCities: CountryCitiesMap,
): SupportedCountryCode[] {
  return normalizeCountryCodes(countries).filter((code) => (countryCities[code] ?? []).length === 0);
}
