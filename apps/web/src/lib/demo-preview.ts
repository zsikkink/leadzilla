import { toSafeDisplayErrorMessage } from './error-messages.js';

export const DEMO_EMAIL = 'demo@example.com';
export const DEMO_PASSWORD = 'password';

export type DemoPreviewUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
};

export const DEMO_PREVIEW_USER: DemoPreviewUser = {
  id: 'leadzilla-demo-preview',
  email: DEMO_EMAIL,
  firstName: 'Demo',
  lastName: 'User',
};

export function isDemoPreviewCredentials(email: string, password: string): boolean {
  return email.trim().toLowerCase() === DEMO_EMAIL && password === DEMO_PASSWORD;
}

export function shouldFallbackPersistedDemoSession(input: {
  email: string | null | undefined;
  hasSession: boolean;
  hasSessionError: boolean;
}): boolean {
  return (
    input.email?.trim().toLowerCase() === DEMO_EMAIL &&
    (input.hasSessionError || !input.hasSession)
  );
}

export function toLoginErrorMessage(error: unknown): string {
  if (
    error instanceof Error &&
    /failed to fetch|load failed|network(?:error| request failed)|unable to reach/i.test(
      error.message,
    )
  ) {
    return 'Live sign-in is temporarily unavailable. Use the demo credentials shown below.';
  }

  return toSafeDisplayErrorMessage(
    error,
    'Sign-in is taking longer than expected. Please try the demo credentials again.',
  );
}
