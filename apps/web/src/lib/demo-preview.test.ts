import { describe, expect, it } from 'vitest';

import {
  DEMO_EMAIL,
  DEMO_PREVIEW_USER,
  shouldUsePublicPreviewSession,
} from './demo-preview.js';

describe('public demo preview', () => {
  it('keeps clean visitors and the shared demo identity in tokenless preview mode', () => {
    expect(shouldUsePublicPreviewSession(null)).toBe(true);
    expect(shouldUsePublicPreviewSession(undefined)).toBe(true);
    expect(shouldUsePublicPreviewSession('   ')).toBe(true);
    expect(shouldUsePublicPreviewSession(DEMO_EMAIL)).toBe(true);
    expect(shouldUsePublicPreviewSession(` ${DEMO_EMAIL.toUpperCase()} `)).toBe(true);
    expect(shouldUsePublicPreviewSession('operator@example.com')).toBe(false);
  });

  it('uses a non-privileged local preview identity', () => {
    expect(DEMO_PREVIEW_USER).toEqual({
      id: 'leadzilla-demo-preview',
      email: DEMO_EMAIL,
      firstName: 'Demo',
      lastName: 'User',
    });
  });
});
