import { describe, expect, it } from 'vitest';

import {
  getLeadCompanyLabel,
  getLeadContactName,
  getLeadEmailLabel,
  isPlaceholderLeadEmail,
} from './page.helpers.js';

describe('lead recruiter presentation helpers', () => {
  it('recognizes internal placeholder and malformed emails', () => {
    expect(isPlaceholderLeadEmail('no-email+123@lead-flood.invalid')).toBe(true);
    expect(isPlaceholderLeadEmail('info@example.com%20')).toBe(true);
    expect(isPlaceholderLeadEmail('maya@aster-stone.example')).toBe(false);
  });

  it('replaces missing contacts with the company without inventing a person', () => {
    expect(getLeadContactName({
      firstName: 'Unknown',
      lastName: 'Contact',
      companyName: 'Aster & Stone Design',
    })).toBe('Aster & Stone Design');
  });

  it('hides placeholder emails and retains usable addresses', () => {
    expect(getLeadEmailLabel('no-email+123@lead-flood.invalid')).toBeNull();
    expect(getLeadEmailLabel('maya@aster-stone.example')).toBe('maya@aster-stone.example');
  });

  it('normalizes and truncates scraped company labels', () => {
    const label = getLeadCompanyLabel('  Aster   & Stone Design with an exceptionally long scraped suffix that should not dominate the table  ');
    expect(label).toMatch(/^Aster & Stone Design/);
    expect(label?.endsWith('…')).toBe(true);
  });
});
