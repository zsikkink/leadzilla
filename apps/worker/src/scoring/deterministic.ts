import { normalizeCountryCodeOrAlias } from '@lead-flood/contracts';

export const DETERMINISTIC_REASON_CODES = {
  hardFilterFailed: 'HARD_FILTER_FAILED',
  hardFilterPassed: 'HARD_FILTER_PASSED',
  noWeightedRules: 'NO_WEIGHTED_RULES',
  highWeightedMatch: 'HIGH_WEIGHTED_MATCH',
  mediumWeightedMatch: 'MEDIUM_WEIGHTED_MATCH',
  lowWeightedMatch: 'LOW_WEIGHTED_MATCH',
  noRuleMatches: 'NO_RULE_MATCHES',
} as const;

export type DeterministicReasonCode =
  (typeof DETERMINISTIC_REASON_CODES)[keyof typeof DETERMINISTIC_REASON_CODES];

export const QUALIFICATION_CATEGORIES = {
  SALES_MOTION_FIT: 'SALES_MOTION_FIT',
  PAYMENT_COMPLEXITY: 'PAYMENT_COMPLEXITY',
  RISK_URGENCY: 'RISK_URGENCY',
  OPERATIONAL_PAIN: 'OPERATIONAL_PAIN',
  SWITCHING_WILLINGNESS: 'SWITCHING_WILLINGNESS',
  GENERAL: 'GENERAL',
} as const;

export type QualificationCategory = (typeof QUALIFICATION_CATEGORIES)[keyof typeof QUALIFICATION_CATEGORIES];

/**
 * Maps feature field keys to Zbooni qualification categories.
 * Rules with fieldKeys not in this map fall under GENERAL.
 */
const FIELD_KEY_CATEGORY_MAP: Record<string, QualificationCategory> = {
  // Sales Motion Fit — "Deals closed via WhatsApp/chat, conversation-led, multi-person"
  has_whatsapp: QUALIFICATION_CATEGORIES.SALES_MOTION_FIT,
  has_instagram: QUALIFICATION_CATEGORIES.SALES_MOTION_FIT,
  custom_order_signals: QUALIFICATION_CATEGORIES.SALES_MOTION_FIT,
  apollo_has_direct_phone: QUALIFICATION_CATEGORIES.SALES_MOTION_FIT,
  decision_maker_count: QUALIFICATION_CATEGORIES.SALES_MOTION_FIT,

  // Payment Complexity — "High ticket, deposits, irregular amounts, international"
  apify_payment_widget_count: QUALIFICATION_CATEGORIES.PAYMENT_COMPLEXITY,
  apify_has_pricing_tiers: QUALIFICATION_CATEGORIES.PAYMENT_COMPLEXITY,
  high_ticket_signals: QUALIFICATION_CATEGORIES.PAYMENT_COMPLEXITY,

  // Risk & Urgency — "Failed payment kills deal, timing matters, reachability"
  recent_activity: QUALIFICATION_CATEGORIES.RISK_URGENCY,
  has_booking_or_contact_form: QUALIFICATION_CATEGORIES.RISK_URGENCY,
  website_email_count: QUALIFICATION_CATEGORIES.RISK_URGENCY,
  website_phone_count: QUALIFICATION_CATEGORIES.RISK_URGENCY,

  // Switching Willingness — "Growing business, engagement-focused, open to tools"
  follower_growth_signal: QUALIFICATION_CATEGORIES.SWITCHING_WILLINGNESS,
  high_engagement_signal: QUALIFICATION_CATEGORIES.SWITCHING_WILLINGNESS,
  social_link_count: QUALIFICATION_CATEGORIES.SWITCHING_WILLINGNESS,
  has_linkedin: QUALIFICATION_CATEGORIES.SWITCHING_WILLINGNESS,
  tech_stack_size: QUALIFICATION_CATEGORIES.SWITCHING_WILLINGNESS,

  // Disqualification signals (negative weight rules) — GENERAL
  pure_self_serve_ecom: QUALIFICATION_CATEGORIES.GENERAL,
  shopify_detected: QUALIFICATION_CATEGORIES.GENERAL,
  subscription_billing_detected: QUALIFICATION_CATEGORIES.GENERAL,
  // Match signals
  industry_match: QUALIFICATION_CATEGORIES.GENERAL,
  geo_match: QUALIFICATION_CATEGORIES.GENERAL,
  icp_segment_priority: QUALIFICATION_CATEGORIES.GENERAL,

  // v2 — Apify structured features (non-scored, for category tracking)
  apify_has_shopify: QUALIFICATION_CATEGORIES.GENERAL,
  apify_has_booking_form: QUALIFICATION_CATEGORIES.SALES_MOTION_FIT,
  apify_has_product_catalog: QUALIFICATION_CATEGORIES.GENERAL,

  // v2 — Instagram structured features
  instagram_follower_count: QUALIFICATION_CATEGORIES.SWITCHING_WILLINGNESS,
  instagram_engagement_rate: QUALIFICATION_CATEGORIES.SWITCHING_WILLINGNESS,
  instagram_is_business_account: QUALIFICATION_CATEGORIES.GENERAL,
  instagram_has_bio_link: QUALIFICATION_CATEGORIES.SWITCHING_WILLINGNESS,

  // v2 — Contact quality
  has_decision_maker_phone: QUALIFICATION_CATEGORIES.SALES_MOTION_FIT,
};

export interface DeterministicRule {
  id: string;
  name: string;
  ruleType: 'WEIGHTED' | 'HARD_FILTER';
  isRequired?: boolean;
  fieldKey: string;
  operator: 'EQ' | 'NEQ' | 'GT' | 'GTE' | 'LT' | 'LTE' | 'IN' | 'NOT_IN' | 'CONTAINS';
  valueJson: unknown;
  weight: number | null;
  isActive: boolean;
  orderIndex?: number;
  priority: number;
}

export interface RuleEvaluationResult {
  ruleId: string;
  fieldKey: string;
  operator: DeterministicRule['operator'];
  ruleType: DeterministicRule['ruleType'];
  matched: boolean;
  weightApplied: number;
  contribution: number;
  reasonCode: string;
}

export interface CategoryScore {
  matched: number;
  total: number;
  rate: number;
}

export interface DeterministicScoreResult {
  qualificationScore: number;
  hardFilterPassed: boolean;
  ruleMatchCount: number;
  reasonCodes: string[];
  ruleEvaluation: RuleEvaluationResult[];
  categoryScores: Record<string, CategoryScore>;
  qualificationPath: 'PROCEED' | 'SELECTIVE' | 'DISQUALIFY' | 'HARD_FILTERED';
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function isCountryFieldKey(fieldKey: string): boolean {
  const normalized = fieldKey.trim().toLowerCase();
  return (
    normalized === 'country' ||
    normalized.endsWith('_country') ||
    normalized.endsWith('.country') ||
    normalized.includes('country_code')
  );
}

function normalizeComparable(value: unknown, fieldKey?: string | undefined): unknown {
  if (fieldKey && isCountryFieldKey(fieldKey)) {
    const asString = normalizeString(value);
    if (asString !== null) {
      return normalizeCountryCodeOrAlias(asString) ?? asString.toLowerCase();
    }
  }

  const asString = normalizeString(value);
  if (asString !== null) {
    return asString.toLowerCase();
  }

  const asNumeric = asNumber(value);
  if (asNumeric !== null) {
    return asNumeric;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  return value;
}

function getFeatureValue(features: Record<string, unknown>, fieldKey: string): unknown {
  if (fieldKey.includes('.')) {
    const path = fieldKey.split('.');
    let current: unknown = features;
    for (const segment of path) {
      if (!current || typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[segment];
    }
    return current;
  }

  return features[fieldKey];
}

function sanitizeFieldKey(fieldKey: string): string {
  return fieldKey
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

export function evaluateRuleMatch(rule: DeterministicRule, featureValue: unknown): boolean {
  const ruleValue = rule.valueJson;

  switch (rule.operator) {
    case 'EQ':
      return normalizeComparable(featureValue, rule.fieldKey) === normalizeComparable(ruleValue, rule.fieldKey);
    case 'NEQ':
      return normalizeComparable(featureValue, rule.fieldKey) !== normalizeComparable(ruleValue, rule.fieldKey);
    case 'GT': {
      const left = asNumber(featureValue);
      const right = asNumber(ruleValue);
      return left !== null && right !== null && left > right;
    }
    case 'GTE': {
      const left = asNumber(featureValue);
      const right = asNumber(ruleValue);
      return left !== null && right !== null && left >= right;
    }
    case 'LT': {
      const left = asNumber(featureValue);
      const right = asNumber(ruleValue);
      return left !== null && right !== null && left < right;
    }
    case 'LTE': {
      const left = asNumber(featureValue);
      const right = asNumber(ruleValue);
      return left !== null && right !== null && left <= right;
    }
    case 'IN': {
      if (!Array.isArray(ruleValue)) {
        return false;
      }
      const normalizedFeature = normalizeComparable(featureValue, rule.fieldKey);
      const normalizedSet = ruleValue.map((value) => normalizeComparable(value, rule.fieldKey));
      return normalizedSet.includes(normalizedFeature);
    }
    case 'NOT_IN': {
      if (!Array.isArray(ruleValue)) {
        return false;
      }
      const normalizedFeature = normalizeComparable(featureValue, rule.fieldKey);
      const normalizedSet = ruleValue.map((value) => normalizeComparable(value, rule.fieldKey));
      return !normalizedSet.includes(normalizedFeature);
    }
    case 'CONTAINS': {
      const normalizedRule = normalizeComparable(ruleValue, rule.fieldKey);
      if (Array.isArray(featureValue)) {
        return featureValue.map((value) => normalizeComparable(value, rule.fieldKey)).includes(normalizedRule);
      }
      const normalizedFeature = normalizeComparable(featureValue, rule.fieldKey);
      if (typeof normalizedFeature !== 'string' || typeof normalizedRule !== 'string') {
        return false;
      }
      return normalizedFeature.includes(normalizedRule);
    }
    default:
      return false;
  }
}

function classifyWeightedReason(score: number): DeterministicReasonCode {
  if (score >= 0.75) {
    return DETERMINISTIC_REASON_CODES.highWeightedMatch;
  }
  if (score >= 0.4) {
    return DETERMINISTIC_REASON_CODES.mediumWeightedMatch;
  }
  return DETERMINISTIC_REASON_CODES.lowWeightedMatch;
}

export function toScoreBand(
  score: number,
  bands?: { low: number; high: number } | undefined,
): 'LOW' | 'MEDIUM' | 'HIGH' {
  const lowThreshold = bands?.low ?? 0.34;
  const highThreshold = bands?.high ?? 0.67;
  if (score < lowThreshold) {
    return 'LOW';
  }
  if (score < highThreshold) {
    return 'MEDIUM';
  }
  return 'HIGH';
}

export function evaluateDeterministicScore(
  rules: DeterministicRule[],
  features: Record<string, unknown>,
): DeterministicScoreResult {
  const activeRules = rules
    .filter((rule) => rule.isActive)
    .sort((a, b) => {
      const orderA = a.orderIndex ?? a.priority;
      const orderB = b.orderIndex ?? b.priority;
      if (orderA === orderB) {
        return a.id.localeCompare(b.id);
      }
      return orderA - orderB;
    });

  const reasonCodes: string[] = [];
  const ruleEvaluation: RuleEvaluationResult[] = [];
  let hardFilterPassed = true;
  let weightedPositiveMatched = 0;
  let weightedPositiveTotal = 0;
  let weightedNegativeMatched = 0;
  let weightedNegativeTotal = 0;
  let ruleMatchCount = 0;

  for (const rule of activeRules) {
    const featureValue = getFeatureValue(features, rule.fieldKey);
    const matched = evaluateRuleMatch(rule, featureValue);
    const effectiveRuleType: DeterministicRule['ruleType'] =
      rule.ruleType === 'HARD_FILTER' || rule.isRequired === true
        ? 'HARD_FILTER'
        : 'WEIGHTED';
    const weightApplied =
      effectiveRuleType === 'WEIGHTED'
        ? (rule.weight ?? 1)
        : 0;
    const contribution = matched ? weightApplied : 0;

    if (matched) {
      ruleMatchCount += 1;
    }

    if (effectiveRuleType === 'HARD_FILTER' && !matched) {
      hardFilterPassed = false;
      reasonCodes.push(`HARD_FILTER_FAILED_${sanitizeFieldKey(rule.fieldKey)}`);
    }

    if (effectiveRuleType === 'WEIGHTED') {
      if (weightApplied >= 0) {
        weightedPositiveTotal += weightApplied;
        if (matched) {
          weightedPositiveMatched += weightApplied;
        }
      } else {
        const penalty = Math.abs(weightApplied);
        weightedNegativeTotal += penalty;
        if (matched) {
          weightedNegativeMatched += penalty;
        }
      }
    }

    ruleEvaluation.push({
      ruleId: rule.id,
      fieldKey: rule.fieldKey,
      operator: rule.operator,
      ruleType: effectiveRuleType,
      matched,
      weightApplied,
      contribution,
      reasonCode: matched ? 'RULE_MATCHED' : 'RULE_NOT_MATCHED',
    });
  }

  // --- Category-based scoring (Zbooni qualification checklist) ---
  const categoryBuckets = new Map<string, { matched: number; total: number }>();

  for (const evaluation of ruleEvaluation) {
    if (evaluation.ruleType === 'HARD_FILTER') continue;

    const category = FIELD_KEY_CATEGORY_MAP[evaluation.fieldKey] ?? QUALIFICATION_CATEGORIES.GENERAL;
    const existing = categoryBuckets.get(category) ?? { matched: 0, total: 0 };
    existing.total += 1;
    if (evaluation.matched) {
      existing.matched += 1;
    }
    categoryBuckets.set(category, existing);
  }

  const categoryScores: Record<string, CategoryScore> = {};
  for (const [category, bucket] of categoryBuckets) {
    categoryScores[category] = {
      matched: bucket.matched,
      total: bucket.total,
      rate: bucket.total > 0 ? bucket.matched / bucket.total : 0,
    };
  }

  // Count categories that pass (>=50% match rate, at least 1 rule matched)
  const CATEGORY_PASS_THRESHOLD = 0.5;
  const passedCategories = new Set<string>();
  for (const [category, score] of Object.entries(categoryScores)) {
    if (category === QUALIFICATION_CATEGORIES.GENERAL) continue;
    if (score.rate >= CATEGORY_PASS_THRESHOLD && score.matched >= 1) {
      passedCategories.add(category);
    }
  }

  const hasSalesMotion = passedCategories.has(QUALIFICATION_CATEGORIES.SALES_MOTION_FIT);
  const hasPaymentComplexity = passedCategories.has(QUALIFICATION_CATEGORIES.PAYMENT_COMPLEXITY);

  // Zbooni Decision Guide:
  // PROCEED: Sales + Payment + 1 other -> base 0.75
  // SELECTIVE: 2+ categories passed -> base 0.50
  // DISQUALIFY: < 2 categories -> base 0.25
  let qualificationPath: 'PROCEED' | 'SELECTIVE' | 'DISQUALIFY' | 'HARD_FILTERED';
  let categoryBonus = 0;

  if (!hardFilterPassed) {
    qualificationPath = 'HARD_FILTERED';
  } else if (hasSalesMotion && hasPaymentComplexity && passedCategories.size >= 3) {
    qualificationPath = 'PROCEED';
    categoryBonus = 0.10;
  } else if (passedCategories.size >= 2) {
    qualificationPath = 'SELECTIVE';
    categoryBonus = 0.05;
  } else {
    qualificationPath = 'DISQUALIFY';
    categoryBonus = -0.05;
  }

  // --- Weighted-average scoring (Option D: base 0.10 + weighted ratio * 0.90 + category) ---
  const BASE_SCORE = 0.10;
  let qualificationScore = 0;
  if (hardFilterPassed) {
    if (weightedPositiveTotal > 0 || weightedNegativeTotal > 0) {
      const matchRatio =
        weightedPositiveTotal > 0
          ? (weightedPositiveMatched + 1) / (weightedPositiveTotal + 1)
          : 1;
      const penaltyFactor =
        weightedNegativeTotal > 0
          ? 1 - (weightedNegativeMatched / weightedNegativeTotal) * 0.8
          : 1;
      const boundedPenaltyFactor = Math.max(0.2, Math.min(1, penaltyFactor));
      qualificationScore = BASE_SCORE + matchRatio * boundedPenaltyFactor * 0.90;

      // Apply category bonus/penalty
      qualificationScore = Math.max(0, Math.min(1, qualificationScore + categoryBonus));
    } else {
      qualificationScore = 1;
      reasonCodes.push(DETERMINISTIC_REASON_CODES.noWeightedRules);
    }
    reasonCodes.push(DETERMINISTIC_REASON_CODES.hardFilterPassed);
    reasonCodes.push(classifyWeightedReason(qualificationScore));
  } else {
    qualificationScore = 0;
    reasonCodes.push(DETERMINISTIC_REASON_CODES.hardFilterFailed);
  }

  if (ruleMatchCount === 0) {
    reasonCodes.push(DETERMINISTIC_REASON_CODES.noRuleMatches);
  }

  const normalizedScore = Math.max(0, Math.min(1, Number(qualificationScore.toFixed(6))));
  const uniqueReasonCodes = Array.from(new Set(reasonCodes));

  return {
    qualificationScore: normalizedScore,
    hardFilterPassed,
    ruleMatchCount,
    reasonCodes: uniqueReasonCodes,
    ruleEvaluation,
    categoryScores,
    qualificationPath,
  };
}
