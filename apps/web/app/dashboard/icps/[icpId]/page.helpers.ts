import type { QualificationRuleResponse } from '@lead-flood/contracts';

export interface IcpProfileMetadata {
  salesHook: string | null;
  salesAngles: string[];
  averageTicket: string | null;
  volumePotential: string | null;
  salesCycle: string | null;
  revenuePotential: string | null;
}

export interface QualificationSignalGroups {
  required: QualificationRuleResponse[];
  positive: QualificationRuleResponse[];
  antiFit: QualificationRuleResponse[];
}

function readString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function readStringArray(record: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean);
    }
    if (typeof value === 'string' && value.trim()) {
      return value.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

export function extractIcpProfileMetadata(metadata: Record<string, unknown> | null): IcpProfileMetadata {
  const value = metadata ?? {};
  return {
    salesHook: readString(value, ['salesHook', 'hook']),
    salesAngles: readStringArray(value, ['angle', 'salesAngles']),
    averageTicket: readString(value, ['avgTicket', 'averageTicket']),
    volumePotential: readString(value, ['volumePotential']),
    salesCycle: readString(value, ['salesCycle']),
    revenuePotential: readString(value, ['revenuePotential']),
  };
}

export function summarizeIcpDescription(description: string | null, maxLength = 360): string {
  if (!description) {
    return 'A focused customer segment used for discovery, qualification, and personalized outreach.';
  }

  const firstSection = description
    .split(/\b(?:Core Pain Points|Why (?:this ICP|the platform)|Buying Triggers|Objections to Overcome|Deal Structure)\b/i)[0]
    ?.replace(/^#+\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!firstSection) {
    return 'A focused customer segment used for discovery, qualification, and personalized outreach.';
  }
  if (firstSection.length <= maxLength) {
    return firstSection;
  }

  const truncated = firstSection.slice(0, maxLength + 1);
  const finalWordBoundary = truncated.lastIndexOf(' ');
  return `${truncated.slice(0, finalWordBoundary > maxLength * 0.75 ? finalWordBoundary : maxLength).trim()}…`;
}

export function groupQualificationSignals(
  rules: readonly QualificationRuleResponse[] | undefined,
): QualificationSignalGroups {
  const activeRules = (rules ?? [])
    .filter((rule) => rule.isActive)
    .sort((left, right) => left.orderIndex - right.orderIndex);
  const isAntiFitRule = (rule: QualificationRuleResponse) =>
    (rule.weight ?? 0) < 0 || /\b(?:anti-fit|disqualif\w*|exclud\w*|self-serve|subscription)\b/i.test(rule.name);

  return {
    required: activeRules.filter(
      (rule) => (rule.ruleType === 'HARD_FILTER' || rule.isRequired) && !isAntiFitRule(rule),
    ),
    positive: activeRules.filter(
      (rule) => rule.ruleType !== 'HARD_FILTER' && !rule.isRequired && !isAntiFitRule(rule),
    ),
    antiFit: activeRules.filter(isAntiFitRule),
  };
}

export function formatCompanySize(minimum: number | null, maximum: number | null): string | null {
  if (minimum !== null && maximum !== null) return `${minimum.toLocaleString()}–${maximum.toLocaleString()} employees`;
  if (minimum !== null) return `${minimum.toLocaleString()}+ employees`;
  if (maximum !== null) return `Up to ${maximum.toLocaleString()} employees`;
  return null;
}
