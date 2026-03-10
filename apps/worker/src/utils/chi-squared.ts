/**
 * Chi-squared test for 2x2 contingency tables (A/B testing).
 *
 * Tests whether two proportions (e.g., reply rates for variant A vs B) differ
 * significantly. Uses Yates' continuity correction for small samples.
 *
 * For very small samples (any cell < 5), returns p=1 (no significance).
 */

export interface ChiSquaredResult {
  /** Chi-squared statistic. */
  chiSquared: number;
  /** Approximate p-value (two-tailed). */
  pValue: number;
  /** Whether the result is statistically significant at alpha=0.05. */
  significant: boolean;
}

/**
 * Run a 2x2 chi-squared test with Yates' correction.
 *
 * @param successA - Successes in group A (e.g., replies)
 * @param totalA - Total observations in group A (e.g., sends)
 * @param successB - Successes in group B
 * @param totalB - Total observations in group B
 * @param alpha - Significance level (default 0.05)
 */
export function chiSquaredTest(
  successA: number,
  totalA: number,
  successB: number,
  totalB: number,
  alpha = 0.05,
): ChiSquaredResult {
  const failA = totalA - successA;
  const failB = totalB - successB;

  // Check minimum sample: all expected cells must be >= 5
  const totalSuccess = successA + successB;
  const totalFail = failA + failB;
  const grandTotal = totalA + totalB;

  if (grandTotal === 0) {
    return { chiSquared: 0, pValue: 1, significant: false };
  }

  const expectedASuccess = (totalA * totalSuccess) / grandTotal;
  const expectedAFail = (totalA * totalFail) / grandTotal;
  const expectedBSuccess = (totalB * totalSuccess) / grandTotal;
  const expectedBFail = (totalB * totalFail) / grandTotal;

  // If any expected cell < 5, the chi-squared approximation is unreliable
  if (
    expectedASuccess < 5 ||
    expectedAFail < 5 ||
    expectedBSuccess < 5 ||
    expectedBFail < 5
  ) {
    return { chiSquared: 0, pValue: 1, significant: false };
  }

  // Chi-squared with Yates' continuity correction
  const chiSquared =
    grandTotal *
    Math.pow(
      Math.max(0, Math.abs(successA * failB - successB * failA) - grandTotal / 2),
      2,
    ) /
    (totalA * totalB * totalSuccess * totalFail);

  // Approximate p-value using the chi-squared survival function (1 df)
  const pValue = chiSquaredSurvival(chiSquared, 1);

  return {
    chiSquared: Math.round(chiSquared * 10000) / 10000,
    pValue: Math.round(pValue * 10000) / 10000,
    significant: pValue < alpha,
  };
}

/**
 * Approximate chi-squared survival function P(X > x) for df=1.
 * Uses the complementary error function approximation.
 */
function chiSquaredSurvival(x: number, _df: number): number {
  if (x <= 0) return 1;
  // For df=1, P(X > x) = erfc(sqrt(x/2))
  return erfc(Math.sqrt(x / 2));
}

/**
 * Complementary error function approximation (Abramowitz & Stegun 7.1.26).
 * Accurate to ~1.5e-7.
 */
function erfc(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const poly =
    t *
    (0.254829592 +
      t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const result = poly * Math.exp(-x * x);
  return x >= 0 ? result : 2 - result;
}
