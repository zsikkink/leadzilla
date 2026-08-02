import type { QualificationRuleResponse } from '@lead-flood/contracts';
import { describe, expect, it } from 'vitest';

import {
  extractIcpProfileMetadata,
  formatCompanySize,
  groupQualificationSignals,
  summarizeIcpDescription,
} from './page.helpers.js';

function buildRule(overrides: Partial<QualificationRuleResponse>): QualificationRuleResponse {
  return {
    id: 'rule-1',
    icpProfileId: 'icp-1',
    name: 'Matches target industry',
    ruleType: 'WEIGHTED',
    isRequired: false,
    fieldKey: 'industry',
    operator: 'IN',
    valueJson: ['Hospitality'],
    weight: 2,
    orderIndex: 1,
    isActive: true,
    priority: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ICP recruiter presentation helpers', () => {
  it('keeps the concise overview and removes generated strategy sections', () => {
    expect(summarizeIcpDescription(
      'Boutique hospitality operators with multi-location needs. Core Pain Points Manual reconciliation and fragmented reporting.',
    )).toBe('Boutique hospitality operators with multi-location needs.');
  });

  it('extracts only presentation-ready metadata', () => {
    expect(extractIcpProfileMetadata({
      hook: 'Unify payment operations without replacing the current stack.',
      angle: ['Faster reconciliation', 'Local payment methods'],
      avgTicket: '$18k ARR',
    })).toEqual({
      salesHook: 'Unify payment operations without replacing the current stack.',
      salesAngles: ['Faster reconciliation', 'Local payment methods'],
      averageTicket: '$18k ARR',
      volumePotential: null,
      salesCycle: null,
      revenuePotential: null,
    });
  });

  it('groups active signals without exposing inactive configuration', () => {
    const required = buildRule({ id: 'required', ruleType: 'HARD_FILTER', isRequired: true });
    const positive = buildRule({ id: 'positive', weight: 3, orderIndex: 2 });
    const antiFit = buildRule({ id: 'anti-fit', name: 'Subscription model (disqualify)', ruleType: 'HARD_FILTER', isRequired: true, weight: 0, orderIndex: 3 });
    const inactive = buildRule({ id: 'inactive', isActive: false, orderIndex: 4 });

    expect(groupQualificationSignals([antiFit, inactive, positive, required])).toEqual({
      required: [required],
      positive: [positive],
      antiFit: [antiFit],
    });
  });

  it('formats company-size guardrails', () => {
    expect(formatCompanySize(25, 250)).toBe('25–250 employees');
    expect(formatCompanySize(50, null)).toBe('50+ employees');
    expect(formatCompanySize(null, null)).toBeNull();
  });
});
