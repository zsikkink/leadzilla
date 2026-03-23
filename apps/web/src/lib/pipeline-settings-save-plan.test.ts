import { describe, expect, it } from 'vitest';

import { buildPipelineSettingsSavePlan } from './pipeline-settings-save-plan.js';

const labels = {
  messagingRole: 'Messaging Role',
  auto_approve_score_min: 'Auto-Approve Min Score',
  auto_approve_score_max: 'Auto-Approve Max Score',
};

describe('buildPipelineSettingsSavePlan', () => {
  it('only returns changed settings', () => {
    const plan = buildPipelineSettingsSavePlan({
      currentValues: {
        messagingRole: '',
        auto_approve_score_min: 0.5,
        auto_approve_score_max: 1,
      },
      nextValues: {
        messagingRole: 'Closer',
        auto_approve_score_min: 0.5,
        auto_approve_score_max: 1,
      },
      labels,
    });

    expect(plan).toEqual([
      {
        key: 'messagingRole',
        value: 'Closer',
        label: 'Messaging Role',
      },
    ]);
  });

  it('saves max before min when both bounds move above the current max', () => {
    const plan = buildPipelineSettingsSavePlan({
      currentValues: {
        auto_approve_score_min: 0.2,
        auto_approve_score_max: 0.4,
      },
      nextValues: {
        auto_approve_score_min: 0.6,
        auto_approve_score_max: 0.8,
      },
      labels,
    });

    expect(plan.map((target) => target.key)).toEqual([
      'auto_approve_score_max',
      'auto_approve_score_min',
    ]);
  });

  it('saves min before max when both bounds move below the current min', () => {
    const plan = buildPipelineSettingsSavePlan({
      currentValues: {
        auto_approve_score_min: 0.7,
        auto_approve_score_max: 0.9,
      },
      nextValues: {
        auto_approve_score_min: 0.2,
        auto_approve_score_max: 0.4,
      },
      labels,
    });

    expect(plan.map((target) => target.key)).toEqual([
      'auto_approve_score_min',
      'auto_approve_score_max',
    ]);
  });

  it('preserves the default min-then-max order when the current range already overlaps the target', () => {
    const plan = buildPipelineSettingsSavePlan({
      currentValues: {
        auto_approve_score_min: 0.4,
        auto_approve_score_max: 0.8,
      },
      nextValues: {
        auto_approve_score_min: 0.5,
        auto_approve_score_max: 0.7,
      },
      labels,
    });

    expect(plan.map((target) => target.key)).toEqual([
      'auto_approve_score_min',
      'auto_approve_score_max',
    ]);
  });
});
