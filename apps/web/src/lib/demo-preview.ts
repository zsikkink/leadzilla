export const DEMO_EMAIL = 'demo@example.com';

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

export function shouldUsePublicPreviewSession(email: string | null | undefined): boolean {
  const normalizedEmail = email?.trim().toLowerCase();
  return !normalizedEmail || normalizedEmail === DEMO_EMAIL;
}
