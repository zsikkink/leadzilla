export type ScoreTier = 'LOW' | 'MEDIUM' | 'HIGH';

export interface TierBands {
  low: number;
  high: number;
}

export const DEFAULT_TIER_BANDS: TierBands = { low: 0.34, high: 0.67 };

export function toScoreTier(score: number, bands: TierBands = DEFAULT_TIER_BANDS): ScoreTier {
  if (score >= bands.high) return 'HIGH';
  if (score >= bands.low) return 'MEDIUM';
  return 'LOW';
}

export function tierColor(tier: ScoreTier): string {
  switch (tier) {
    case 'HIGH':
      return 'text-zbooni-green bg-zbooni-green/10';
    case 'MEDIUM':
      return 'text-yellow-400 bg-yellow-400/10';
    case 'LOW':
      return 'text-red-400 bg-red-400/10';
  }
}

/**
 * Parse the `scoreTierBands` value from pipeline settings into TierBands.
 * The API stores `{ low, med, high }` but `med` and `high` are the same value
 * (the MEDIUM/HIGH boundary). Returns DEFAULT_TIER_BANDS if parsing fails.
 */
export function parseTierBands(
  value: unknown,
): TierBands {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const low = typeof obj.low === 'number' ? obj.low : undefined;
    const high = typeof obj.high === 'number' ? obj.high : (typeof obj.med === 'number' ? obj.med : undefined);
    if (low !== undefined && high !== undefined
        && Number.isFinite(low) && Number.isFinite(high)
        && low >= 0 && high >= low && high <= 1) {
      return { low, high };
    }
  }
  return DEFAULT_TIER_BANDS;
}
