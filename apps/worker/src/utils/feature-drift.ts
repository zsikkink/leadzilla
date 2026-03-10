export interface DriftResult {
  feature: string;
  previousRate: number;
  currentRate: number;
}

/**
 * Detect features that have drifted: previously populated above `thresholdPct`
 * but now at 0% in the current batch.
 *
 * @param previousRates - Feature population rates from historical data (0-1 scale)
 * @param currentRates - Feature population rates from current batch (0-1 scale)
 * @param thresholdPct - Minimum previous rate to consider (0-1 scale, e.g. 0.3 = 30%)
 * @returns Array of drifted features with their rates
 */
export function detectFeatureDrift(
  previousRates: Record<string, number>,
  currentRates: Record<string, number>,
  thresholdPct: number,
): DriftResult[] {
  const drifted: DriftResult[] = [];

  for (const [feature, previousRate] of Object.entries(previousRates)) {
    if (previousRate <= thresholdPct) {
      continue;
    }

    const currentRate = currentRates[feature];
    if (currentRate === undefined || currentRate !== 0) {
      continue;
    }

    drifted.push({ feature, previousRate, currentRate: 0 });
  }

  return drifted.sort((a, b) => b.previousRate - a.previousRate);
}

/**
 * Compute population rate for each feature key across a batch of feature snapshots.
 * A feature is "populated" if its value is truthy (non-null, non-empty, non-zero, non-false).
 */
export function computePopulationRates(
  featureSnapshots: Record<string, unknown>[],
  featureKeys: readonly string[],
): Record<string, number> {
  const total = featureSnapshots.length;
  if (total === 0) {
    return {};
  }

  const rates: Record<string, number> = {};

  for (const key of featureKeys) {
    let populated = 0;

    for (const snapshot of featureSnapshots) {
      const value = snapshot[key];
      if (isPopulated(value)) {
        populated++;
      }
    }

    rates[key] = populated / total;
  }

  return rates;
}

function isPopulated(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  return true;
}
