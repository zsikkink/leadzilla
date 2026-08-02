import { describe, expect, it } from 'vitest';

import { DEMO_SETTINGS_SNAPSHOT } from './demo-settings-snapshot.js';

describe('demo settings snapshot', () => {
  it('defines a three-step follow-up sequence across fourteen days', () => {
    expect(DEMO_SETTINGS_SNAPSHOT.followUps.map(({ label, timing }) => ({ label, timing }))).toEqual([
      { label: 'Follow-up 1', timing: 'Day 3' },
      { label: 'Follow-up 2', timing: 'Day 7' },
      { label: 'Final follow-up', timing: 'Day 14' },
    ]);
  });

  it('stops follow-ups for every terminal contact outcome', () => {
    expect(DEMO_SETTINGS_SNAPSHOT.stopConditions).toEqual([
      'Reply received',
      'Meeting booked',
      'Unsubscribed',
      'Hard bounce',
    ]);
  });

  it('keeps the workspace policy organized into distinct operator sections', () => {
    expect(DEMO_SETTINGS_SNAPSHOT.sections.map(({ id }) => id)).toEqual([
      'outreach-schedule',
      'review-routing',
      'contact-safety',
      'discovery-scoring',
    ]);
    expect(DEMO_SETTINGS_SNAPSHOT.sections.every(({ items }) => items.length === 4)).toBe(true);
  });

  it('does not expose removed engineering-console language', () => {
    const serialized = JSON.stringify(DEMO_SETTINGS_SNAPSHOT);

    expect(serialized).not.toMatch(/DLQ|AUC|WhatsApp|jitter|provider capabilities/i);
  });
});
