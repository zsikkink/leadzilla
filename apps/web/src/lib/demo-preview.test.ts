import { describe, expect, it } from 'vitest';

import {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  DEMO_PREVIEW_USER,
  isDemoPreviewCredentials,
  shouldFallbackPersistedDemoSession,
  toLoginErrorMessage,
} from './demo-preview.js';

describe('demo preview credentials', () => {
  it('accepts only the published demo credentials', () => {
    expect(isDemoPreviewCredentials(DEMO_EMAIL, DEMO_PASSWORD)).toBe(true);
    expect(isDemoPreviewCredentials(` ${DEMO_EMAIL.toUpperCase()} `, DEMO_PASSWORD)).toBe(true);
    expect(isDemoPreviewCredentials(DEMO_EMAIL, 'wrong-password')).toBe(false);
    expect(isDemoPreviewCredentials('someone@example.com', DEMO_PASSWORD)).toBe(false);
  });

  it('falls back when a persisted demo session resolves with an error or no session', () => {
    expect(
      shouldFallbackPersistedDemoSession({
        email: DEMO_EMAIL,
        hasSession: false,
        hasSessionError: true,
      }),
    ).toBe(true);
    expect(
      shouldFallbackPersistedDemoSession({
        email: DEMO_EMAIL,
        hasSession: false,
        hasSessionError: false,
      }),
    ).toBe(true);
    expect(
      shouldFallbackPersistedDemoSession({
        email: DEMO_EMAIL,
        hasSession: true,
        hasSessionError: false,
      }),
    ).toBe(false);
    expect(
      shouldFallbackPersistedDemoSession({
        email: 'operator@example.com',
        hasSession: false,
        hasSessionError: true,
      }),
    ).toBe(false);
  });

  it('uses a non-privileged local preview identity', () => {
    expect(DEMO_PREVIEW_USER).toEqual({
      id: 'leadzilla-demo-preview',
      email: DEMO_EMAIL,
      firstName: 'Demo',
      lastName: 'User',
    });
  });

  it('never exposes raw browser transport errors on the login form', () => {
    expect(toLoginErrorMessage(new TypeError('Load failed'))).toBe(
      'Live sign-in is temporarily unavailable. Use the demo credentials shown below.',
    );
    expect(toLoginErrorMessage(new TypeError('Failed to fetch'))).toBe(
      'Live sign-in is temporarily unavailable. Use the demo credentials shown below.',
    );
    expect(toLoginErrorMessage(new Error('Invalid login credentials'))).toBe(
      'The demo credentials were not accepted. Please try again.',
    );
    expect(toLoginErrorMessage(new Error('Database query failed for app_admins'))).toBe(
      'Sign-in is taking longer than expected. Please try the demo credentials again.',
    );
  });
});
