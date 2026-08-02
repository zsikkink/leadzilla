import { describe, expect, it } from 'vitest';

import {
  collapseRepeatedErrorMessage,
  isGenericDatabaseErrorMessage,
  LIVE_DATA_REFRESH_MESSAGE,
  toDiscoveryRunNotice,
  toSafeApiErrorMessage,
  toSafeDisplayErrorMessage,
  uniqueDiscoveryRunNotices,
  uniqueCollapsedErrorMessages,
} from './error-messages.js';

describe('error message helpers', () => {
  it('collapses repeated semicolon-separated fragments', () => {
    expect(
      collapseRepeatedErrorMessage(
        'Database query failed; Database query failed; Database query failed',
      ),
    ).toBe('Database query failed');
  });

  it('keeps distinct fragments while normalizing whitespace', () => {
    expect(
      collapseRepeatedErrorMessage(
        ' Database query failed for businesses ; Database query failed for costs ; Database query failed for businesses ',
      ),
    ).toBe('Database query failed for businesses; Database query failed for costs');
  });

  it('returns unique collapsed messages', () => {
    expect(
      uniqueCollapsedErrorMessages([
        null,
        'Database query failed; Database query failed',
        'database query failed',
        'SerpAPI request failed',
      ]),
    ).toEqual(['Database query failed', 'SerpAPI request failed']);
  });

  it('detects generic database errors after duplicate collapsing', () => {
    expect(isGenericDatabaseErrorMessage('Database query failed; Database query failed')).toBe(true);
    expect(isGenericDatabaseErrorMessage('Database query failed for businesses (400)')).toBe(false);
  });

  it('never displays raw database, provider, or transport details', () => {
    expect(
      toSafeDisplayErrorMessage(
        'Database query failed for businesses (409): duplicate key value violates unique constraint "businesses_phone_idx"',
      ),
    ).toBe(LIVE_DATA_REFRESH_MESSAGE);
    expect(toSafeDisplayErrorMessage('SerpAPI request failed with status 400')).toBe(
      LIVE_DATA_REFRESH_MESSAGE,
    );
    expect(toSafeDisplayErrorMessage(new TypeError('Load failed'))).toBe(
      LIVE_DATA_REFRESH_MESSAGE,
    );
  });

  it('preserves safe action guidance and normalizes common auth states', () => {
    expect(toSafeDisplayErrorMessage('Choose one or more active ICPs before starting discovery')).toBe(
      'Choose one or more active ICPs before starting discovery',
    );
    expect(toSafeDisplayErrorMessage('Invalid login credentials')).toBe(
      'The demo credentials were not accepted. Please try again.',
    );
    expect(toSafeDisplayErrorMessage('Session expired — please log in again')).toBe(
      'Your demo session expired. Please sign in again.',
    );
    expect(
      toSafeDisplayErrorMessage('Company size fields must be positive whole numbers.'),
    ).toBe('Company size fields must be positive whole numbers.');
    expect(toSafeDisplayErrorMessage('Select at least one country.')).toBe(
      'Select at least one country.',
    );
    expect(toSafeDisplayErrorMessage('SELECT "credential" FROM "workspace_secrets"')).toBe(
      LIVE_DATA_REFRESH_MESSAGE,
    );
    expect(
      toSafeDisplayErrorMessage('CREATE POLICY recruiter_demo_access USING (true)'),
    ).toBe(LIVE_DATA_REFRESH_MESSAGE);
    expect(
      toSafeDisplayErrorMessage('Create lead failed for internal_identifier=workspace_123'),
    ).toBe(LIVE_DATA_REFRESH_MESSAGE);
    expect(toSafeDisplayErrorMessage('SELECT a FROM workspace_secrets')).toBe(
      LIVE_DATA_REFRESH_MESSAGE,
    );
    expect(
      toSafeDisplayErrorMessage('This lead contains internal_identifier=workspace_123'),
    ).toBe(LIVE_DATA_REFRESH_MESSAGE);
  });

  it('maps API statuses without exposing response bodies', () => {
    expect(toSafeApiErrorMessage(409, 'duplicate key value violates unique constraint')).toBe(
      'This item changed while you were working. Refresh and try again.',
    );
    expect(toSafeApiErrorMessage(502, 'OpenAI request failed: invalid key')).toBe(
      LIVE_DATA_REFRESH_MESSAGE,
    );
    expect(toSafeApiErrorMessage(400, 'Choose at least one country')).toBe(
      'Choose at least one country',
    );
  });

  it('turns persisted run failures into concise operational notes', () => {
    expect(
      toDiscoveryRunNotice(
        'duplicate key value violates unique constraint businesses_phone_e164_unique_not_null_idx',
      ),
    ).toBe('Existing businesses were detected and skipped during deduplication.');
    expect(toDiscoveryRunNotice('SerpAPI request failed with status 400')).toBe(
      'A search source returned fewer usable results than expected.',
    );
    expect(
      uniqueDiscoveryRunNotices([
        'Database query failed',
        'database relation unavailable',
        'SerpAPI request failed',
      ]),
    ).toEqual([
      'Some results could not be saved during this run.',
      'A search source returned fewer usable results than expected.',
    ]);
  });
});
