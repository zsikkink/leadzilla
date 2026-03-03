# Phase 6: Frontend Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the complete Zbooni Sales OS dashboard so the sales team can operate the pipeline through a browser UI — login, explore leads, approve messages, manage ICPs, and view analytics.

**Architecture:** Next.js 15 App Router with route groups. `(dashboard)` group wraps all authenticated pages in a sidebar/header shell. A typed API client class handles all backend communication with JWT auth. React Context manages auth state with localStorage persistence.

**Tech Stack:** Next.js 15, React 19, Tailwind CSS 4, shadcn/ui (Radix-based), Recharts, @lead-flood/contracts (Zod schemas)

---

## Route Structure

```
app/
├── layout.tsx                    ← root: AuthProvider + Toaster
├── page.tsx                      ← redirect → /login or /dashboard
├── login/
│   └── page.tsx                  ← login form
├── (dashboard)/
│   ├── layout.tsx                ← sidebar + header shell
│   ├── page.tsx                  ← pipeline funnel (home)
│   ├── leads/
│   │   ├── page.tsx              ← lead explorer table
│   │   └── [id]/
│   │       └── page.tsx          ← lead detail
│   ├── messages/
│   │   └── page.tsx              ← message approval queue
│   ├── icps/
│   │   ├── page.tsx              ← ICP profile list
│   │   └── [icpId]/
│   │       └── page.tsx          ← ICP detail + rules editor
│   └── analytics/
│       └── page.tsx              ← score distribution + model metrics
```

---

### Task 1: Tailwind CSS + shadcn/ui + Recharts Setup

Install and configure all frontend dependencies. After this task the app builds with Tailwind, shadcn components are available, and Recharts is importable.

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/tailwind.config.ts`
- Create: `apps/web/postcss.config.mjs`
- Create: `apps/web/components.json`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/app/layout.tsx`
- Create: `apps/web/src/lib/utils.ts`

**Step 1: Install dependencies**

```bash
cd apps/web
pnpm add tailwindcss @tailwindcss/postcss postcss recharts lucide-react class-variance-authority clsx tailwind-merge
pnpm add -D @types/node
```

**Step 2: Install shadcn/ui**

```bash
cd apps/web
npx shadcn@latest init -d
```

Select: New York style, Zinc base color, CSS variables: yes.

If interactive prompt fails (non-TTY), create the files manually:

Create `apps/web/components.json`:
```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "app/globals.css",
    "baseColor": "zinc",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

Create `apps/web/src/lib/utils.ts`:
```typescript
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

**Step 3: Configure Tailwind**

Create `apps/web/postcss.config.mjs`:
```javascript
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
export default config;
```

**Step 4: Update globals.css**

Replace `apps/web/app/globals.css` with Tailwind directives + shadcn CSS variables:
```css
@import 'tailwindcss';

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 240 10% 3.9%;
    --card: 0 0% 100%;
    --card-foreground: 240 10% 3.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 240 10% 3.9%;
    --primary: 240 5.9% 10%;
    --primary-foreground: 0 0% 98%;
    --secondary: 240 4.8% 95.9%;
    --secondary-foreground: 240 5.9% 10%;
    --muted: 240 4.8% 95.9%;
    --muted-foreground: 240 3.8% 46.1%;
    --accent: 240 4.8% 95.9%;
    --accent-foreground: 240 5.9% 10%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 0 0% 98%;
    --border: 240 5.9% 90%;
    --input: 240 5.9% 90%;
    --ring: 240 5.9% 10%;
    --radius: 0.5rem;
    --chart-1: 12 76% 61%;
    --chart-2: 173 58% 39%;
    --chart-3: 197 37% 24%;
    --chart-4: 43 74% 66%;
    --chart-5: 27 87% 67%;
  }

  .dark {
    --background: 240 10% 3.9%;
    --foreground: 0 0% 98%;
    --card: 240 10% 3.9%;
    --card-foreground: 0 0% 98%;
    --popover: 240 10% 3.9%;
    --popover-foreground: 0 0% 98%;
    --primary: 0 0% 98%;
    --primary-foreground: 240 5.9% 10%;
    --secondary: 240 3.7% 15.9%;
    --secondary-foreground: 0 0% 98%;
    --muted: 240 3.7% 15.9%;
    --muted-foreground: 240 5% 64.9%;
    --accent: 240 3.7% 15.9%;
    --accent-foreground: 0 0% 98%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 0 0% 98%;
    --border: 240 3.7% 15.9%;
    --input: 240 3.7% 15.9%;
    --ring: 240 4.9% 83.9%;
    --chart-1: 220 70% 50%;
    --chart-2: 160 60% 45%;
    --chart-3: 30 80% 55%;
    --chart-4: 280 65% 60%;
    --chart-5: 340 75% 55%;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

**Step 5: Add path aliases to tsconfig**

Modify `apps/web/tsconfig.json` — add `paths` to `compilerOptions`:
```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"],
      "@/components/*": ["./src/components/*"],
      "@/lib/*": ["./src/lib/*"],
      "@/hooks/*": ["./src/hooks/*"]
    }
  }
}
```

**Step 6: Install base shadcn components**

```bash
cd apps/web
npx shadcn@latest add button card input label badge table dialog dropdown-menu select tabs separator skeleton avatar scroll-area toast sonner
```

**Step 7: Verify build**

```bash
cd /Users/os_architect/Desktop/OS_Architect/Projects/lead-flood
export PATH="/Users/os_architect/.nvm/versions/node/v22.22.0/bin:$PATH"
pnpm --filter @lead-flood/web build
```

Expected: Build succeeds with no errors.

**Step 8: Commit**

```bash
git add apps/web/
git commit -m "feat(web): add Tailwind CSS, shadcn/ui, and Recharts"
```

---

### Task 2: API Client with Auth Headers

Create a typed fetch wrapper that adds JWT auth headers to all requests. Uses contract types from `@lead-flood/contracts` for type safety.

**Files:**
- Create: `apps/web/src/lib/api-client.ts`
- Create: `apps/web/src/lib/api-client.test.ts`

**Step 1: Create API client**

Create `apps/web/src/lib/api-client.ts`:
```typescript
import type {
  CreateLeadRequest,
  CreateLeadResponse,
  FeedbackSummaryResponse,
  FunnelQuery,
  FunnelResponse,
  GetLeadResponse,
  IcpProfileResponse,
  LeadInspectionResponse,
  ListIcpProfilesQuery,
  ListIcpProfilesResponse,
  ListLeadsQuery,
  ListLeadsResponse,
  ListMessageDraftsQuery,
  ListMessageDraftsResponse,
  ListMessageSendsQuery,
  ListMessageSendsResponse,
  LoginRequest,
  LoginResponse,
  MessageDraftResponse,
  ModelMetricsResponse,
  QualificationRuleResponse,
  RetrainStatusResponse,
  ScoreDistributionResponse,
} from '@lead-flood/contracts';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly requestId?: string | undefined,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function toSearchParams(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  }
  return params.toString();
}

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => string | null,
  ) {}

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const token = this.getToken();
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    };

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: { ...headers, ...(options?.headers as Record<string, string> | undefined) },
    });

    if (response.status === 401) {
      throw new ApiError(401, 'Session expired — please log in again');
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new ApiError(
        response.status,
        (body as { error?: string }).error ?? 'Request failed',
        (body as { requestId?: string }).requestId,
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  // ── Auth ──────────────────────────────────────────
  login(data: LoginRequest): Promise<LoginResponse> {
    return this.request('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ── Leads ─────────────────────────────────────────
  listLeads(query: ListLeadsQuery): Promise<ListLeadsResponse> {
    return this.request(`/v1/leads?${toSearchParams(query as Record<string, unknown>)}`);
  }

  getLead(id: string): Promise<GetLeadResponse> {
    return this.request(`/v1/leads/${id}`);
  }

  createLead(data: CreateLeadRequest): Promise<CreateLeadResponse> {
    return this.request('/v1/leads', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ── ICPs ──────────────────────────────────────────
  listIcps(query?: ListIcpProfilesQuery): Promise<ListIcpProfilesResponse> {
    const qs = query ? `?${toSearchParams(query as Record<string, unknown>)}` : '';
    return this.request(`/v1/icps${qs}`);
  }

  getIcp(icpId: string): Promise<IcpProfileResponse> {
    return this.request(`/v1/icps/${icpId}`);
  }

  getIcpRules(icpId: string): Promise<{ items: QualificationRuleResponse[] }> {
    return this.request(`/v1/icps/${icpId}/rules`);
  }

  // ── Messaging ─────────────────────────────────────
  listDrafts(query?: ListMessageDraftsQuery): Promise<ListMessageDraftsResponse> {
    const qs = query ? `?${toSearchParams(query as Record<string, unknown>)}` : '';
    return this.request(`/v1/messaging/drafts${qs}`);
  }

  getDraft(draftId: string): Promise<MessageDraftResponse> {
    return this.request(`/v1/messaging/drafts/${draftId}`);
  }

  approveDraft(draftId: string, data: { approvedByUserId: string; selectedVariantId?: string | undefined }): Promise<MessageDraftResponse> {
    return this.request(`/v1/messaging/drafts/${draftId}/approve`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  rejectDraft(draftId: string, data: { rejectedByUserId: string; rejectedReason: string }): Promise<MessageDraftResponse> {
    return this.request(`/v1/messaging/drafts/${draftId}/reject`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  sendMessage(data: { messageDraftId: string; messageVariantId: string; idempotencyKey: string }): Promise<unknown> {
    return this.request('/v1/messaging/sends', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  listSends(query?: ListMessageSendsQuery): Promise<ListMessageSendsResponse> {
    const qs = query ? `?${toSearchParams(query as Record<string, unknown>)}` : '';
    return this.request(`/v1/messaging/sends${qs}`);
  }

  // ── Analytics ─────────────────────────────────────
  getFunnel(query?: FunnelQuery): Promise<FunnelResponse> {
    const qs = query ? `?${toSearchParams(query as Record<string, unknown>)}` : '';
    return this.request(`/v1/analytics/funnel${qs}`);
  }

  getScoreDistribution(query?: Record<string, unknown>): Promise<ScoreDistributionResponse> {
    const qs = query ? `?${toSearchParams(query)}` : '';
    return this.request(`/v1/analytics/score-distribution${qs}`);
  }

  getModelMetrics(query?: Record<string, unknown>): Promise<ModelMetricsResponse> {
    const qs = query ? `?${toSearchParams(query)}` : '';
    return this.request(`/v1/analytics/model-metrics${qs}`);
  }

  getRetrainStatus(): Promise<RetrainStatusResponse> {
    return this.request('/v1/analytics/retrain-status');
  }

  // ── Feedback ──────────────────────────────────────
  getFeedbackSummary(query?: Record<string, unknown>): Promise<FeedbackSummaryResponse> {
    const qs = query ? `?${toSearchParams(query)}` : '';
    return this.request(`/v1/feedback/summary${qs}`);
  }
}
```

**Step 2: Write tests for API client**

Create `apps/web/src/lib/api-client.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ApiClient, ApiError } from './api-client.js';

describe('ApiClient', () => {
  const baseUrl = 'http://localhost:5050';
  let getToken: () => string | null;
  let client: ApiClient;

  beforeEach(() => {
    getToken = vi.fn(() => 'test-token');
    client = new ApiClient(baseUrl, getToken);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends authorization header when token is present', async () => {
    const mockResponse = { items: [], page: 1, pageSize: 20, total: 0 };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    await client.listLeads({ page: 1, pageSize: 20 });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/leads'),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer test-token',
        }),
      }),
    );
  });

  it('omits authorization header when no token', async () => {
    (getToken as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const mockResponse = { tokenType: 'Bearer', accessToken: 'x', refreshToken: 'y', expiresInSeconds: 3600, user: { id: '1', email: 'a@b.com', firstName: 'A', lastName: 'B' } };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    await client.login({ email: 'a@b.com', password: 'pass' });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/auth/login'),
      expect.objectContaining({
        headers: expect.not.objectContaining({
          authorization: expect.any(String),
        }),
      }),
    );
  });

  it('throws ApiError with status and message on non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Not found', requestId: 'req-1' }), { status: 404 }),
    );

    await expect(client.getLead('bad-id')).rejects.toThrow(ApiError);
    await expect(client.getLead('bad-id')).rejects.toThrow(); // fetch already consumed
  });

  it('throws specific message on 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    );

    await expect(client.listLeads({ page: 1, pageSize: 20 })).rejects.toThrow(
      'Session expired',
    );
  });

  it('builds query params correctly', async () => {
    const mockResponse = { items: [], page: 1, pageSize: 10, total: 0 };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    await client.listLeads({ page: 2, pageSize: 10, status: 'enriched' });

    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('page=2');
    expect(calledUrl).toContain('pageSize=10');
    expect(calledUrl).toContain('status=enriched');
  });
});
```

**Step 3: Run tests**

```bash
cd /Users/os_architect/Desktop/OS_Architect/Projects/lead-flood
export PATH="/Users/os_architect/.nvm/versions/node/v22.22.0/bin:$PATH"
pnpm --filter @lead-flood/web test:unit
```

Expected: All tests pass.

**Step 4: Commit**

```bash
git add apps/web/src/lib/api-client.ts apps/web/src/lib/api-client.test.ts
git commit -m "feat(web): typed API client with auth headers"
```

---

### Task 3: Auth Context + Login Page

Create React Context for authentication, a `useAuth` hook, a login page, and a redirect on the root page.

**Files:**
- Create: `apps/web/src/lib/auth-context.tsx`
- Create: `apps/web/src/hooks/use-auth.ts`
- Modify: `apps/web/app/layout.tsx` — wrap with AuthProvider
- Create: `apps/web/app/login/page.tsx`
- Modify: `apps/web/app/page.tsx` — redirect to /login or dashboard

**Step 1: Create auth context**

Create `apps/web/src/lib/auth-context.tsx`:
```tsx
'use client';

import type { LoginResponse } from '@lead-flood/contracts';
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { ApiClient } from './api-client.js';
import { getWebEnv } from './env.js';

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  apiClient: ApiClient;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = 'lf_access_token';
const USER_KEY = 'lf_user';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Hydrate from localStorage on mount
  useEffect(() => {
    const storedToken = localStorage.getItem(TOKEN_KEY);
    const storedUser = localStorage.getItem(USER_KEY);

    if (storedToken && storedUser) {
      try {
        setToken(storedToken);
        setUser(JSON.parse(storedUser) as AuthUser);
      } catch {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
      }
    }

    setIsLoading(false);
  }, []);

  const apiClient = useMemo(() => {
    const env = getWebEnv();
    return new ApiClient(env.NEXT_PUBLIC_API_BASE_URL, () => token);
  }, [token]);

  const login = useCallback(
    async (email: string, password: string) => {
      const response: LoginResponse = await apiClient.login({ email, password });
      localStorage.setItem(TOKEN_KEY, response.accessToken);
      localStorage.setItem(USER_KEY, JSON.stringify(response.user));
      setToken(response.accessToken);
      setUser(response.user);
    },
    [apiClient],
  );

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isAuthenticated: !!token,
      isLoading,
      login,
      logout,
      apiClient,
    }),
    [user, token, isLoading, login, logout, apiClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
```

**Step 2: Create useAuth hook**

Create `apps/web/src/hooks/use-auth.ts`:
```typescript
'use client';

import { useContext } from 'react';

import { AuthContext, type AuthContextValue } from '../lib/auth-context.js';

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
```

**Step 3: Update root layout**

Replace `apps/web/app/layout.tsx`:
```tsx
import type { ReactNode } from 'react';

import { AuthProvider } from '../src/lib/auth-context.js';

import './globals.css';

export const metadata = {
  title: 'Lead Flood — Zbooni Sales OS',
  description: 'AI-powered sales pipeline for Zbooni',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
```

**Step 4: Create login page**

Create `apps/web/app/login/page.tsx`:
```tsx
'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '../../src/hooks/use-auth.js';
import { ApiError } from '../../src/lib/api-client.js';

export default function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Redirect if already authenticated
  if (isAuthenticated) {
    router.replace('/');
    return null;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await login(email, password);
      router.replace('/');
    } catch (submitError: unknown) {
      if (submitError instanceof ApiError) {
        setError(submitError.message);
      } else {
        setError('Login failed — please try again');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40">
      <div className="w-full max-w-sm rounded-xl border bg-card p-8 shadow-lg">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight">Lead Flood</h1>
          <p className="text-sm text-muted-foreground">Zbooni Sales OS</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="you@zbooni.com"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="••••••••"
            />
          </div>

          {error ? (
            <p className="text-sm font-medium text-destructive">{error}</p>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
          >
            {isSubmitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
```

**Step 5: Update root page to redirect**

Replace `apps/web/app/page.tsx`:
```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useAuth } from '../src/hooks/use-auth.js';

export default function RootPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (isAuthenticated) {
      router.replace('/dashboard');
    } else {
      router.replace('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-muted-foreground">Loading...</p>
    </div>
  );
}
```

**Step 6: Verify build**

```bash
pnpm --filter @lead-flood/web build
```

Expected: Build succeeds. Login page renders at `/login`.

**Step 7: Commit**

```bash
git add apps/web/
git commit -m "feat(web): auth context, login page, root redirect"
```

---

### Task 4: Dashboard Shell — Sidebar + Header Layout

Create the authenticated layout with sidebar navigation, header with user info, and a protected route guard that redirects to `/login` if not authenticated.

**Files:**
- Create: `apps/web/app/(dashboard)/layout.tsx`
- Create: `apps/web/src/components/sidebar.tsx`
- Create: `apps/web/src/components/header.tsx`

**Step 1: Create sidebar component**

Create `apps/web/src/components/sidebar.tsx`:
```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  GitBranch,
  LayoutDashboard,
  MessageSquare,
  Target,
  Users,
} from 'lucide-react';

import { cn } from '../lib/utils.js';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Pipeline', icon: LayoutDashboard },
  { href: '/dashboard/leads', label: 'Leads', icon: Users },
  { href: '/dashboard/messages', label: 'Messages', icon: MessageSquare },
  { href: '/dashboard/icps', label: 'ICP Profiles', icon: Target },
  { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart3 },
] as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 border-r bg-card lg:block">
      <div className="flex h-14 items-center border-b px-6">
        <GitBranch className="mr-2 h-5 w-5 text-primary" />
        <span className="text-lg font-semibold tracking-tight">Lead Flood</span>
      </div>

      <nav className="flex flex-col gap-1 p-4">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive =
            href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname.startsWith(href);

          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
```

**Step 2: Create header component**

Create `apps/web/src/components/header.tsx`:
```tsx
'use client';

import { LogOut, Menu } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { useAuth } from '../hooks/use-auth.js';
import { cn } from '../lib/utils.js';

const MOBILE_NAV = [
  { href: '/dashboard', label: 'Pipeline' },
  { href: '/dashboard/leads', label: 'Leads' },
  { href: '/dashboard/messages', label: 'Messages' },
  { href: '/dashboard/icps', label: 'ICP Profiles' },
  { href: '/dashboard/analytics', label: 'Analytics' },
] as const;

export function Header() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b bg-card">
      <div className="flex h-14 items-center justify-between px-4 lg:px-6">
        <button
          type="button"
          className="rounded-md p-2 text-muted-foreground hover:bg-muted lg:hidden"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="flex-1" />

        <div className="flex items-center gap-4">
          {user ? (
            <span className="text-sm text-muted-foreground">
              {user.firstName} {user.lastName}
            </span>
          ) : null}
          <button
            type="button"
            onClick={logout}
            className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Mobile nav */}
      {mobileMenuOpen ? (
        <nav className="border-t p-4 lg:hidden">
          {MOBILE_NAV.map(({ href, label }) => {
            const isActive =
              href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  'block rounded-lg px-3 py-2 text-sm font-medium',
                  isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
                )}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      ) : null}
    </header>
  );
}
```

**Step 3: Create dashboard layout with auth guard**

Create `apps/web/app/(dashboard)/layout.tsx`:
```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { Header } from '../../src/components/header.js';
import { Sidebar } from '../../src/components/sidebar.js';
import { useAuth } from '../../src/hooks/use-auth.js';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <Header />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
```

**Step 4: Create dashboard home placeholder**

Create `apps/web/app/(dashboard)/page.tsx`:
```tsx
export default function DashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Pipeline Overview</h1>
      <p className="text-muted-foreground">Pipeline funnel coming in Task 5.</p>
    </div>
  );
}
```

**Step 5: Verify build and manual test**

```bash
pnpm --filter @lead-flood/web build
```

Expected: Build succeeds. `/dashboard` shows sidebar + header. Unauthenticated users redirect to `/login`.

**Step 6: Commit**

```bash
git add apps/web/
git commit -m "feat(web): dashboard shell with sidebar, header, and auth guard"
```

---

### Task 5: Pipeline Funnel Page (Dashboard Home)

Build the main dashboard page showing the pipeline conversion funnel as a Recharts bar chart, ICP filter, and KPI summary cards.

**Files:**
- Modify: `apps/web/app/(dashboard)/page.tsx`
- Create: `apps/web/src/components/funnel-chart.tsx`
- Create: `apps/web/src/components/kpi-card.tsx`
- Create: `apps/web/src/hooks/use-api-query.ts`

**Step 1: Create useApiQuery hook**

A generic hook for data fetching with loading/error states. Create `apps/web/src/hooks/use-api-query.ts`:
```typescript
'use client';

import { useCallback, useEffect, useState } from 'react';

interface UseApiQueryResult<T> {
  data: T | null;
  error: string | null;
  isLoading: boolean;
  refetch: () => void;
}

export function useApiQuery<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
): UseApiQueryResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refetchCounter, setRefetchCounter] = useState(0);

  const refetch = useCallback(() => {
    setRefetchCounter((c) => c + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    fetcher()
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setIsLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Request failed');
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetchCounter, ...deps]);

  return { data, error, isLoading, refetch };
}
```

**Step 2: Create KPI card component**

Create `apps/web/src/components/kpi-card.tsx`:
```tsx
interface KpiCardProps {
  label: string;
  value: number;
  sublabel?: string | undefined;
}

export function KpiCard({ label, value, sublabel }: KpiCardProps) {
  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-bold tracking-tight">{value.toLocaleString()}</p>
      {sublabel ? (
        <p className="mt-1 text-xs text-muted-foreground">{sublabel}</p>
      ) : null}
    </div>
  );
}
```

**Step 3: Create funnel chart component**

Create `apps/web/src/components/funnel-chart.tsx`:
```tsx
'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { FunnelResponse } from '@lead-flood/contracts';

interface FunnelChartProps {
  data: FunnelResponse;
}

export function FunnelChart({ data }: FunnelChartProps) {
  const chartData = [
    { stage: 'Discovered', count: data.discoveredCount, fill: 'hsl(var(--chart-1))' },
    { stage: 'Qualified', count: data.qualifiedCount, fill: 'hsl(var(--chart-2))' },
    { stage: 'Enriched', count: data.enrichedCount, fill: 'hsl(var(--chart-3))' },
    { stage: 'Scored', count: data.scoredCount, fill: 'hsl(var(--chart-4))' },
    { stage: 'Messaged', count: data.messagesSentCount, fill: 'hsl(var(--chart-5))' },
    { stage: 'Replied', count: data.repliesCount, fill: 'hsl(var(--chart-1))' },
    { stage: 'Meetings', count: data.meetingsCount, fill: 'hsl(var(--chart-2))' },
    { stage: 'Deals Won', count: data.dealsWonCount, fill: 'hsl(var(--chart-3))' },
  ];

  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">Pipeline Funnel</h2>
      <ResponsiveContainer width="100%" height={400}>
        <BarChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="stage" className="text-xs" tick={{ fontSize: 12 }} />
          <YAxis className="text-xs" tick={{ fontSize: 12 }} />
          <Tooltip
            contentStyle={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '0.5rem',
            }}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

**Step 4: Build the dashboard page**

Replace `apps/web/app/(dashboard)/page.tsx`:
```tsx
'use client';

import { useCallback, useState } from 'react';

import { FunnelChart } from '../../src/components/funnel-chart.js';
import { KpiCard } from '../../src/components/kpi-card.js';
import { useAuth } from '../../src/hooks/use-auth.js';
import { useApiQuery } from '../../src/hooks/use-api-query.js';

export default function DashboardPage() {
  const { apiClient } = useAuth();
  const [icpFilter, setIcpFilter] = useState<string | undefined>(undefined);

  const icps = useApiQuery(
    useCallback(() => apiClient.listIcps(), [apiClient]),
  );

  const funnel = useApiQuery(
    useCallback(
      () => apiClient.getFunnel(icpFilter ? { icpProfileId: icpFilter } : undefined),
      [apiClient, icpFilter],
    ),
    [icpFilter],
  );

  const feedback = useApiQuery(
    useCallback(
      () => apiClient.getFeedbackSummary(icpFilter ? { icpProfileId: icpFilter } : undefined),
      [apiClient, icpFilter],
    ),
    [icpFilter],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Pipeline Overview</h1>

        <select
          value={icpFilter ?? ''}
          onChange={(e) => setIcpFilter(e.target.value || undefined)}
          className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">All ICPs</option>
          {icps.data?.items.map((icp) => (
            <option key={icp.id} value={icp.id}>
              {icp.name}
            </option>
          ))}
        </select>
      </div>

      {funnel.error ? (
        <p className="text-sm text-destructive">{funnel.error}</p>
      ) : null}

      {/* KPI Cards */}
      {funnel.data ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <KpiCard label="Discovered" value={funnel.data.discoveredCount} />
          <KpiCard label="Messaged" value={funnel.data.messagesSentCount} />
          <KpiCard label="Replies" value={funnel.data.repliesCount} />
          <KpiCard
            label="Reply Rate"
            value={
              funnel.data.messagesSentCount > 0
                ? Math.round((funnel.data.repliesCount / funnel.data.messagesSentCount) * 100)
                : 0
            }
            sublabel="%"
          />
        </div>
      ) : null}

      {/* Funnel Chart */}
      {funnel.data ? <FunnelChart data={funnel.data} /> : null}

      {/* Feedback Summary */}
      {feedback.data ? (
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">Feedback Summary</h2>
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
            <div>
              <p className="text-xs text-muted-foreground">Replied</p>
              <p className="text-xl font-bold">{feedback.data.repliedCount}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Meetings</p>
              <p className="text-xl font-bold">{feedback.data.meetingBookedCount}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Deals Won</p>
              <p className="text-xl font-bold">{feedback.data.dealWonCount}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Deals Lost</p>
              <p className="text-xl font-bold">{feedback.data.dealLostCount}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Unsubscribed</p>
              <p className="text-xl font-bold">{feedback.data.unsubscribedCount}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Bounced</p>
              <p className="text-xl font-bold">{feedback.data.bouncedCount}</p>
            </div>
          </div>
        </div>
      ) : null}

      {funnel.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading pipeline data...</p>
      ) : null}
    </div>
  );
}
```

**Step 5: Verify build**

```bash
pnpm --filter @lead-flood/web build
```

**Step 6: Commit**

```bash
git add apps/web/
git commit -m "feat(web): pipeline funnel dashboard with KPI cards and Recharts"
```

---

### Task 6: Lead Explorer Page

Data table showing all leads with status, score band, ICP profile filters, and pagination. Click a row to navigate to lead detail.

**Files:**
- Create: `apps/web/app/(dashboard)/leads/page.tsx`
- Create: `apps/web/src/components/lead-status-badge.tsx`
- Create: `apps/web/src/components/score-band-badge.tsx`
- Create: `apps/web/src/components/pagination.tsx`

**Step 1: Create status badges**

Create `apps/web/src/components/lead-status-badge.tsx`:
```tsx
import type { LeadStatus } from '@lead-flood/contracts';

import { cn } from '../lib/utils.js';

const STATUS_STYLES: Record<LeadStatus, string> = {
  new: 'bg-blue-100 text-blue-700',
  processing: 'bg-yellow-100 text-yellow-700',
  enriched: 'bg-purple-100 text-purple-700',
  failed: 'bg-red-100 text-red-700',
  messaged: 'bg-green-100 text-green-700',
  replied: 'bg-emerald-100 text-emerald-800',
  cold: 'bg-gray-100 text-gray-600',
};

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        STATUS_STYLES[status],
      )}
    >
      {status}
    </span>
  );
}
```

Create `apps/web/src/components/score-band-badge.tsx`:
```tsx
import type { LeadScoreBand } from '@lead-flood/contracts';

import { cn } from '../lib/utils.js';

const BAND_STYLES: Record<LeadScoreBand, string> = {
  LOW: 'bg-red-100 text-red-700',
  MEDIUM: 'bg-yellow-100 text-yellow-700',
  HIGH: 'bg-green-100 text-green-700',
};

export function ScoreBandBadge({ band }: { band: LeadScoreBand }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        BAND_STYLES[band],
      )}
    >
      {band}
    </span>
  );
}
```

**Step 2: Create pagination component**

Create `apps/web/src/components/pagination.tsx`:
```tsx
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="flex items-center justify-between border-t pt-4">
      <p className="text-sm text-muted-foreground">
        Showing {Math.min((page - 1) * pageSize + 1, total)}–{Math.min(page * pageSize, total)} of{' '}
        {total}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border text-sm disabled:opacity-50"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="inline-flex h-9 items-center px-2 text-sm text-muted-foreground">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border text-sm disabled:opacity-50"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
```

**Step 3: Create lead explorer page**

Create `apps/web/app/(dashboard)/leads/page.tsx`:
```tsx
'use client';

import type { LeadScoreBand, LeadStatus } from '@lead-flood/contracts';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import { LeadStatusBadge } from '../../../src/components/lead-status-badge.js';
import { Pagination } from '../../../src/components/pagination.js';
import { ScoreBandBadge } from '../../../src/components/score-band-badge.js';
import { useApiQuery } from '../../../src/hooks/use-api-query.js';
import { useAuth } from '../../../src/hooks/use-auth.js';

const STATUSES: LeadStatus[] = ['new', 'processing', 'enriched', 'messaged', 'replied', 'cold', 'failed'];
const SCORE_BANDS: LeadScoreBand[] = ['HIGH', 'MEDIUM', 'LOW'];

export default function LeadsPage() {
  const { apiClient } = useAuth();
  const router = useRouter();

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<LeadStatus | undefined>(undefined);
  const [scoreBandFilter, setScoreBandFilter] = useState<LeadScoreBand | undefined>(undefined);
  const pageSize = 20;

  const leads = useApiQuery(
    useCallback(
      () =>
        apiClient.listLeads({
          page,
          pageSize,
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(scoreBandFilter ? { scoreBand: scoreBandFilter } : {}),
        }),
      [apiClient, page, statusFilter, scoreBandFilter],
    ),
    [page, statusFilter, scoreBandFilter],
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Leads</h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={statusFilter ?? ''}
          onChange={(e) => {
            setStatusFilter((e.target.value || undefined) as LeadStatus | undefined);
            setPage(1);
          }}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <select
          value={scoreBandFilter ?? ''}
          onChange={(e) => {
            setScoreBandFilter((e.target.value || undefined) as LeadScoreBand | undefined);
            setPage(1);
          }}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">All scores</option>
          {SCORE_BANDS.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {leads.error ? (
        <p className="text-sm text-destructive">{leads.error}</p>
      ) : null}

      <div className="rounded-xl border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Score</th>
              <th className="px-4 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {leads.data?.items.map((lead) => (
              <tr
                key={lead.id}
                onClick={() => router.push(`/dashboard/leads/${lead.id}`)}
                className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/50"
              >
                <td className="px-4 py-3 font-medium">
                  {lead.firstName} {lead.lastName}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{lead.email}</td>
                <td className="px-4 py-3">
                  <LeadStatusBadge status={lead.status} />
                </td>
                <td className="px-4 py-3">
                  {lead.latestScoreBand ? (
                    <ScoreBandBadge band={lead.latestScoreBand} />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(lead.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {leads.isLoading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  Loading leads...
                </td>
              </tr>
            ) : null}
            {!leads.isLoading && leads.data?.items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No leads found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        {leads.data ? (
          <div className="px-4 pb-4">
            <Pagination
              page={leads.data.page}
              pageSize={leads.data.pageSize}
              total={leads.data.total}
              onPageChange={setPage}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
```

**Step 4: Verify build**

```bash
pnpm --filter @lead-flood/web build
```

**Step 5: Commit**

```bash
git add apps/web/
git commit -m "feat(web): lead explorer page with filters and pagination"
```

---

### Task 7: Lead Detail Page

Shows full lead information: header with status + score, enrichment data, and messaging history.

**Files:**
- Create: `apps/web/app/(dashboard)/leads/[id]/page.tsx`

**Step 1: Create lead detail page**

Create `apps/web/app/(dashboard)/leads/[id]/page.tsx`:
```tsx
'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { ArrowLeft } from 'lucide-react';

import { LeadStatusBadge } from '../../../../src/components/lead-status-badge.js';
import { useApiQuery } from '../../../../src/hooks/use-api-query.js';
import { useAuth } from '../../../../src/hooks/use-auth.js';

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { apiClient } = useAuth();
  const router = useRouter();

  const lead = useApiQuery(
    useCallback(() => apiClient.getLead(id), [apiClient, id]),
    [id],
  );

  const sends = useApiQuery(
    useCallback(() => apiClient.listSends({ leadId: id }), [apiClient, id]),
    [id],
  );

  if (lead.error) {
    return <p className="text-sm text-destructive">{lead.error}</p>;
  }

  if (lead.isLoading || !lead.data) {
    return <p className="text-muted-foreground">Loading lead...</p>;
  }

  const l = lead.data;

  return (
    <div className="space-y-6">
      {/* Back button */}
      <button
        type="button"
        onClick={() => router.back()}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to leads
      </button>

      {/* Header */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">
              {l.firstName} {l.lastName}
            </h1>
            <p className="text-muted-foreground">{l.email}</p>
          </div>
          <LeadStatusBadge status={l.status} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-muted-foreground">Source</p>
            <p className="font-medium">{l.source}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Created</p>
            <p className="font-medium">{new Date(l.createdAt).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Updated</p>
            <p className="font-medium">{new Date(l.updatedAt).toLocaleString()}</p>
          </div>
          {l.error ? (
            <div>
              <p className="text-muted-foreground">Error</p>
              <p className="font-medium text-destructive">{l.error}</p>
            </div>
          ) : null}
        </div>
      </div>

      {/* Enrichment Data */}
      {l.enrichmentData ? (
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">Enrichment Data</h2>
          <pre className="max-h-96 overflow-auto rounded-lg bg-muted p-4 text-xs">
            {JSON.stringify(l.enrichmentData, null, 2)}
          </pre>
        </div>
      ) : null}

      {/* Message History */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold">Message History</h2>

        {sends.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading messages...</p>
        ) : null}

        {sends.data?.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No messages sent yet.</p>
        ) : null}

        {sends.data?.items.map((send) => (
          <div key={send.id} className="border-b py-3 last:border-0">
            <div className="flex items-center gap-3">
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                  send.status === 'SENT' || send.status === 'DELIVERED'
                    ? 'bg-green-100 text-green-700'
                    : send.status === 'FAILED' || send.status === 'BOUNCED'
                      ? 'bg-red-100 text-red-700'
                      : send.status === 'REPLIED'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-yellow-100 text-yellow-700'
                }`}
              >
                {send.status}
              </span>
              <span className="text-xs text-muted-foreground">
                {send.channel} via {send.provider}
              </span>
              {send.sentAt ? (
                <span className="text-xs text-muted-foreground">
                  {new Date(send.sentAt).toLocaleString()}
                </span>
              ) : null}
            </div>
            {send.failureReason ? (
              <p className="mt-1 text-xs text-destructive">{send.failureReason}</p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Step 2: Verify build**

```bash
pnpm --filter @lead-flood/web build
```

**Step 3: Commit**

```bash
git add apps/web/
git commit -m "feat(web): lead detail page with enrichment data and message history"
```

---

### Task 8: Message Approval Queue Page

Shows pending message drafts with side-by-side variant comparison. Approve, reject, or send messages.

**Files:**
- Create: `apps/web/app/(dashboard)/messages/page.tsx`
- Create: `apps/web/src/components/message-draft-card.tsx`

**Step 1: Create message draft card**

Create `apps/web/src/components/message-draft-card.tsx`:
```tsx
'use client';

import type { MessageDraftResponse } from '@lead-flood/contracts';
import { useState } from 'react';
import { Check, X, Send } from 'lucide-react';

import { useAuth } from '../hooks/use-auth.js';

interface MessageDraftCardProps {
  draft: MessageDraftResponse;
  onAction: () => void;
}

export function MessageDraftCard({ draft, onAction }: MessageDraftCardProps) {
  const { apiClient, user } = useAuth();
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userId = user?.id ?? 'unknown';

  const handleApprove = async (variantId?: string) => {
    setActionInProgress('approve');
    setError(null);
    try {
      await apiClient.approveDraft(draft.id, {
        approvedByUserId: userId,
        selectedVariantId: variantId,
      });
      onAction();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) return;
    setActionInProgress('reject');
    setError(null);
    try {
      await apiClient.rejectDraft(draft.id, {
        rejectedByUserId: userId,
        rejectedReason: rejectReason,
      });
      onAction();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Reject failed');
    } finally {
      setActionInProgress(null);
      setShowReject(false);
    }
  };

  const handleSend = async (variantId: string) => {
    setActionInProgress('send');
    setError(null);
    try {
      await apiClient.sendMessage({
        messageDraftId: draft.id,
        messageVariantId: variantId,
        idempotencyKey: `ui:${draft.id}:${variantId}:${Date.now()}`,
      });
      onAction();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setActionInProgress(null);
    }
  };

  const isPending = draft.approvalStatus === 'PENDING';
  const isApproved = draft.approvalStatus === 'APPROVED' || draft.approvalStatus === 'AUTO_APPROVED';

  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Lead: {draft.leadId.slice(0, 8)}...</p>
          <p className="text-xs text-muted-foreground">
            Model: {draft.generatedByModel} · Prompt: {draft.promptVersion}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            isPending
              ? 'bg-yellow-100 text-yellow-700'
              : isApproved
                ? 'bg-green-100 text-green-700'
                : 'bg-red-100 text-red-700'
          }`}
        >
          {draft.approvalStatus}
        </span>
      </div>

      {/* Variants */}
      <div className="grid gap-4 md:grid-cols-2">
        {draft.variants.map((variant) => (
          <div key={variant.id} className="rounded-lg border p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium uppercase text-muted-foreground">
                {variant.variantKey} ({variant.channel})
              </span>
              {variant.qualityScore !== null ? (
                <span className="text-xs text-muted-foreground">
                  Q: {(variant.qualityScore * 100).toFixed(0)}%
                </span>
              ) : null}
            </div>
            {variant.subject ? (
              <p className="mb-1 text-sm font-medium">Subject: {variant.subject}</p>
            ) : null}
            <p className="whitespace-pre-wrap text-sm">{variant.bodyText}</p>

            {/* Action buttons per variant */}
            <div className="mt-3 flex gap-2">
              {isPending ? (
                <button
                  type="button"
                  disabled={!!actionInProgress}
                  onClick={() => handleApprove(variant.id)}
                  className="inline-flex items-center gap-1 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  <Check className="h-3 w-3" /> Approve
                </button>
              ) : null}
              {isApproved ? (
                <button
                  type="button"
                  disabled={!!actionInProgress}
                  onClick={() => handleSend(variant.id)}
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  <Send className="h-3 w-3" /> Send
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {/* Reject controls */}
      {isPending ? (
        <div className="mt-4">
          {showReject ? (
            <div className="flex gap-2">
              <input
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Rejection reason..."
                className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
              />
              <button
                type="button"
                disabled={!rejectReason.trim() || !!actionInProgress}
                onClick={handleReject}
                className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground disabled:opacity-50"
              >
                Confirm Reject
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowReject(true)}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-destructive"
            >
              <X className="h-3 w-3" /> Reject draft
            </button>
          )}
        </div>
      ) : null}

      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
```

**Step 2: Create messages page**

Create `apps/web/app/(dashboard)/messages/page.tsx`:
```tsx
'use client';

import type { MessageApprovalStatus } from '@lead-flood/contracts';
import { useCallback, useState } from 'react';

import { MessageDraftCard } from '../../../src/components/message-draft-card.js';
import { Pagination } from '../../../src/components/pagination.js';
import { useApiQuery } from '../../../src/hooks/use-api-query.js';
import { useAuth } from '../../../src/hooks/use-auth.js';

const APPROVAL_STATUSES: MessageApprovalStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'AUTO_APPROVED'];

export default function MessagesPage() {
  const { apiClient } = useAuth();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<MessageApprovalStatus | undefined>('PENDING');

  const drafts = useApiQuery(
    useCallback(
      () =>
        apiClient.listDrafts({
          page,
          pageSize: 10,
          ...(statusFilter ? { approvalStatus: statusFilter } : {}),
        }),
      [apiClient, page, statusFilter],
    ),
    [page, statusFilter],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Message Queue</h1>
        <select
          value={statusFilter ?? ''}
          onChange={(e) => {
            setStatusFilter((e.target.value || undefined) as MessageApprovalStatus | undefined);
            setPage(1);
          }}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">All statuses</option>
          {APPROVAL_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {drafts.error ? (
        <p className="text-sm text-destructive">{drafts.error}</p>
      ) : null}

      {drafts.isLoading ? (
        <p className="text-muted-foreground">Loading drafts...</p>
      ) : null}

      <div className="space-y-4">
        {drafts.data?.items.map((draft) => (
          <MessageDraftCard key={draft.id} draft={draft} onAction={drafts.refetch} />
        ))}
      </div>

      {!drafts.isLoading && drafts.data?.items.length === 0 ? (
        <div className="rounded-xl border bg-card p-8 text-center shadow-sm">
          <p className="text-muted-foreground">
            {statusFilter === 'PENDING'
              ? 'No pending messages to review.'
              : 'No messages found.'}
          </p>
        </div>
      ) : null}

      {drafts.data && drafts.data.total > 10 ? (
        <Pagination
          page={drafts.data.page}
          pageSize={drafts.data.pageSize}
          total={drafts.data.total}
          onPageChange={setPage}
        />
      ) : null}
    </div>
  );
}
```

**Step 3: Verify build**

```bash
pnpm --filter @lead-flood/web build
```

**Step 4: Commit**

```bash
git add apps/web/
git commit -m "feat(web): message approval queue with variant comparison"
```

---

### Task 9: ICP Management Pages

List all ICP profiles with create/edit. Detail page shows rules editor.

**Files:**
- Create: `apps/web/app/(dashboard)/icps/page.tsx`
- Create: `apps/web/app/(dashboard)/icps/[icpId]/page.tsx`

**Step 1: Create ICP list page**

Create `apps/web/app/(dashboard)/icps/page.tsx`:
```tsx
'use client';

import Link from 'next/link';
import { useCallback } from 'react';

import { useApiQuery } from '../../../src/hooks/use-api-query.js';
import { useAuth } from '../../../src/hooks/use-auth.js';

export default function IcpsPage() {
  const { apiClient } = useAuth();

  const icps = useApiQuery(
    useCallback(() => apiClient.listIcps({ pageSize: 50 }), [apiClient]),
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">ICP Profiles</h1>

      {icps.error ? (
        <p className="text-sm text-destructive">{icps.error}</p>
      ) : null}

      {icps.isLoading ? (
        <p className="text-muted-foreground">Loading ICP profiles...</p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {icps.data?.items.map((icp) => (
          <Link
            key={icp.id}
            href={`/dashboard/icps/${icp.id}`}
            className="rounded-xl border bg-card p-6 shadow-sm transition-shadow hover:shadow-md"
          >
            <div className="flex items-start justify-between">
              <h2 className="text-lg font-semibold">{icp.name}</h2>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  icp.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                }`}
              >
                {icp.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
            {icp.description ? (
              <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{icp.description}</p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-1">
              {icp.targetIndustries.map((industry) => (
                <span
                  key={industry}
                  className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                >
                  {industry}
                </span>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {icp.targetCountries.map((country) => (
                <span
                  key={country}
                  className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700"
                >
                  {country}
                </span>
              ))}
            </div>
          </Link>
        ))}
      </div>

      {!icps.isLoading && icps.data?.items.length === 0 ? (
        <p className="text-center text-muted-foreground">No ICP profiles configured.</p>
      ) : null}
    </div>
  );
}
```

**Step 2: Create ICP detail page with rules**

Create `apps/web/app/(dashboard)/icps/[icpId]/page.tsx`:
```tsx
'use client';

import { ArrowLeft } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useCallback } from 'react';

import { useApiQuery } from '../../../../src/hooks/use-api-query.js';
import { useAuth } from '../../../../src/hooks/use-auth.js';

export default function IcpDetailPage() {
  const { icpId } = useParams<{ icpId: string }>();
  const { apiClient } = useAuth();
  const router = useRouter();

  const icp = useApiQuery(
    useCallback(() => apiClient.getIcp(icpId), [apiClient, icpId]),
    [icpId],
  );

  const rules = useApiQuery(
    useCallback(() => apiClient.getIcpRules(icpId), [apiClient, icpId]),
    [icpId],
  );

  if (icp.error) {
    return <p className="text-sm text-destructive">{icp.error}</p>;
  }

  if (icp.isLoading || !icp.data) {
    return <p className="text-muted-foreground">Loading ICP profile...</p>;
  }

  const profile = icp.data;

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() => router.back()}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to ICPs
      </button>

      {/* Profile header */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">{profile.name}</h1>
            {profile.description ? (
              <p className="mt-1 text-muted-foreground">{profile.description}</p>
            ) : null}
          </div>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              profile.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {profile.isActive ? 'Active' : 'Inactive'}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <div>
            <p className="text-muted-foreground">Target Industries</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {profile.targetIndustries.map((i) => (
                <span key={i} className="rounded bg-muted px-1.5 py-0.5 text-xs">{i}</span>
              ))}
            </div>
          </div>
          <div>
            <p className="text-muted-foreground">Target Countries</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {profile.targetCountries.map((c) => (
                <span key={c} className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700">{c}</span>
              ))}
            </div>
          </div>
          <div>
            <p className="text-muted-foreground">Logic</p>
            <p className="mt-1 font-medium">{profile.qualificationLogic}</p>
          </div>
        </div>
      </div>

      {/* Qualification Rules */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">
          Qualification Rules ({rules.data?.items.length ?? 0})
        </h2>

        {rules.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading rules...</p>
        ) : null}

        <div className="space-y-3">
          {rules.data?.items
            .sort((a, b) => a.orderIndex - b.orderIndex)
            .map((rule) => (
              <div
                key={rule.id}
                className="flex items-center justify-between rounded-lg border p-4"
              >
                <div>
                  <p className="font-medium">{rule.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {rule.fieldKey} {rule.operator}{' '}
                    {JSON.stringify(rule.valueJson)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      rule.ruleType === 'HARD_FILTER'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-blue-100 text-blue-700'
                    }`}
                  >
                    {rule.ruleType}
                  </span>
                  {rule.weight !== null ? (
                    <span className="text-sm text-muted-foreground">
                      w={rule.weight}
                    </span>
                  ) : null}
                  <span
                    className={`h-2 w-2 rounded-full ${
                      rule.isActive ? 'bg-green-500' : 'bg-gray-300'
                    }`}
                    title={rule.isActive ? 'Active' : 'Inactive'}
                  />
                </div>
              </div>
            ))}
        </div>

        {!rules.isLoading && rules.data?.items.length === 0 ? (
          <p className="text-center text-muted-foreground">No qualification rules configured.</p>
        ) : null}
      </div>
    </div>
  );
}
```

**Step 3: Verify build**

```bash
pnpm --filter @lead-flood/web build
```

**Step 4: Commit**

```bash
git add apps/web/
git commit -m "feat(web): ICP management pages with rules display"
```

---

### Task 10: Analytics Page

Score distribution chart, model performance metrics, and retrain status.

**Files:**
- Create: `apps/web/app/(dashboard)/analytics/page.tsx`
- Create: `apps/web/src/components/score-distribution-chart.tsx`

**Step 1: Create score distribution chart**

Create `apps/web/src/components/score-distribution-chart.tsx`:
```tsx
'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { ScoreDistributionResponse } from '@lead-flood/contracts';

const BAND_COLORS: Record<string, string> = {
  LOW: '#ef4444',
  MEDIUM: '#eab308',
  HIGH: '#22c55e',
};

interface ScoreDistributionChartProps {
  data: ScoreDistributionResponse;
}

export function ScoreDistributionChart({ data }: ScoreDistributionChartProps) {
  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">Score Distribution</h2>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data.bands} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="scoreBand" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip
            contentStyle={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '0.5rem',
            }}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {data.bands.map((entry) => (
              <Cell key={entry.scoreBand} fill={BAND_COLORS[entry.scoreBand] ?? '#6b7280'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

**Step 2: Create analytics page**

Create `apps/web/app/(dashboard)/analytics/page.tsx`:
```tsx
'use client';

import { useCallback } from 'react';

import { ScoreDistributionChart } from '../../../src/components/score-distribution-chart.js';
import { useApiQuery } from '../../../src/hooks/use-api-query.js';
import { useAuth } from '../../../src/hooks/use-auth.js';

export default function AnalyticsPage() {
  const { apiClient } = useAuth();

  const scoreDist = useApiQuery(
    useCallback(() => apiClient.getScoreDistribution(), [apiClient]),
  );

  const modelMetrics = useApiQuery(
    useCallback(() => apiClient.getModelMetrics(), [apiClient]),
  );

  const retrainStatus = useApiQuery(
    useCallback(() => apiClient.getRetrainStatus(), [apiClient]),
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>

      {/* Score Distribution */}
      {scoreDist.data ? <ScoreDistributionChart data={scoreDist.data} /> : null}
      {scoreDist.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading score distribution...</p>
      ) : null}
      {scoreDist.error ? (
        <p className="text-sm text-destructive">{scoreDist.error}</p>
      ) : null}

      {/* Model Metrics */}
      {modelMetrics.data && modelMetrics.data.items.length > 0 ? (
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">Model Performance</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Version</th>
                  <th className="px-3 py-2 font-medium">Split</th>
                  <th className="px-3 py-2 font-medium">AUC</th>
                  <th className="px-3 py-2 font-medium">Precision</th>
                  <th className="px-3 py-2 font-medium">Recall</th>
                  <th className="px-3 py-2 font-medium">F1</th>
                  <th className="px-3 py-2 font-medium">Brier</th>
                </tr>
              </thead>
              <tbody>
                {modelMetrics.data.items.map((m, i) => (
                  <tr key={`${m.modelVersionId}-${m.split}-${i}`} className="border-b last:border-0">
                    <td className="px-3 py-2 font-mono text-xs">{m.versionTag}</td>
                    <td className="px-3 py-2">{m.split}</td>
                    <td className="px-3 py-2">{m.auc.toFixed(3)}</td>
                    <td className="px-3 py-2">{m.precision.toFixed(3)}</td>
                    <td className="px-3 py-2">{m.recall.toFixed(3)}</td>
                    <td className="px-3 py-2">{m.f1.toFixed(3)}</td>
                    <td className="px-3 py-2">{m.brierScore.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* Retrain Status */}
      {retrainStatus.data ? (
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">Retrain Status</h2>
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
            <div>
              <p className="text-muted-foreground">Active Model</p>
              <p className="font-mono text-xs font-medium">
                {retrainStatus.data.activeModelVersionId
                  ? retrainStatus.data.activeModelVersionId.slice(0, 12) + '...'
                  : 'None'}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Current Run</p>
              <p className="font-medium">
                {retrainStatus.data.currentRun
                  ? retrainStatus.data.currentRun.status
                  : 'Idle'}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Last Success</p>
              <p className="font-medium">
                {retrainStatus.data.lastSuccessfulRun
                  ? new Date(retrainStatus.data.lastSuccessfulRun.endedAt).toLocaleDateString()
                  : 'Never'}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

**Step 3: Verify build**

```bash
pnpm --filter @lead-flood/web build
```

**Step 4: Commit**

```bash
git add apps/web/
git commit -m "feat(web): analytics page with score distribution and model metrics"
```

---

### Task 11: Final Verification + Route Fix

Move the dashboard home to the correct Next.js route group path, run full quality suite, and fix any remaining issues.

**Files:**
- Modify: `apps/web/app/page.tsx` (redirect to `/dashboard`)
- Verify all routes work correctly

**Step 1: Create the `(dashboard)` route group redirect**

The `(dashboard)` route group means `app/(dashboard)/page.tsx` serves at `/dashboard` only if Next.js maps it correctly. Verify the routing by checking that:
- `/` → redirect to `/dashboard` (authenticated) or `/login` (unauthenticated)
- `/dashboard` → pipeline funnel
- `/dashboard/leads` → lead explorer
- `/dashboard/leads/:id` → lead detail
- `/dashboard/messages` → message queue
- `/dashboard/icps` → ICP list
- `/dashboard/icps/:icpId` → ICP detail
- `/dashboard/analytics` → analytics
- `/login` → login page

**Important**: The `(dashboard)` route group does NOT add `/dashboard` to the URL. It just applies the layout. The pages inside `(dashboard)` serve at `/`, `/leads`, etc. To get `/dashboard` prefix, rename the route group directory:

Move `app/(dashboard)/` to `app/dashboard/`:
```bash
cd /Users/os_architect/Desktop/OS_Architect/Projects/lead-flood/apps/web
mv app/\(dashboard\) app/dashboard
```

This makes the layout file at `app/dashboard/layout.tsx` and all child pages serve under `/dashboard/*`.

**Step 2: Run full quality suite**

```bash
cd /Users/os_architect/Desktop/OS_Architect/Projects/lead-flood
export PATH="/Users/os_architect/.nvm/versions/node/v22.22.0/bin:$PATH"
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Expected: All pass.

**Step 3: Fix any lint/typecheck issues**

Common issues to watch for:
- Missing `| undefined` on optional interface properties (exactOptionalPropertyTypes)
- Unused imports
- `import type` vs `import` for type-only imports

**Step 4: Commit all fixes**

```bash
git add apps/web/
git commit -m "feat(web): final route wiring and quality fixes"
```

---

## Parallelization Notes

- **Tasks 1-4 are sequential** (each depends on prior)
- **Tasks 5-10 are independent** after Task 4 (can be parallelized in pairs: 5+6, 7+8, 9+10)
- **Task 11** depends on all prior tasks

## Code Review Checkpoints

- **After Task 4**: Review layout + auth flow
- **After Task 8**: Review data fetching + message approval UX
- **After Task 11**: Full final review

## Dependencies Summary

| Package | Purpose |
|---------|---------|
| `tailwindcss` + `@tailwindcss/postcss` + `postcss` | CSS framework |
| `class-variance-authority` + `clsx` + `tailwind-merge` | shadcn utility deps |
| `lucide-react` | Icons |
| `recharts` | Charts |
| shadcn components (via `npx shadcn@latest add`) | UI primitives |
