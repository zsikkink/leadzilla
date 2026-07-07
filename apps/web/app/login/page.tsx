'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { useAuth } from '../../src/hooks/use-auth.js';

const DEMO_EMAIL = 'demo@example.com';
const DEMO_PASSWORD = 'password';

export default function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState(DEMO_EMAIL);
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      router.replace('/dashboard');
    }
  }, [isAuthenticated, router]);

  if (isAuthenticated) {
    return null;
  }

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await login(email, password);
      router.replace('/dashboard');
    } catch (submitError: unknown) {
      if (submitError instanceof Error) {
        setError(submitError.message);
      } else {
        setError('Login failed — please try again');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClassName =
    'flex h-11 w-full rounded-xl border border-input bg-background px-4 text-sm transition-colors placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      {/* Subtle background gradient */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div
          className="absolute -top-1/2 -left-1/4 h-[800px] w-[800px] rounded-full opacity-[0.03]"
          style={{ background: 'radial-gradient(circle, #7BFF6B 0%, transparent 70%)' }}
        />
        <div
          className="absolute -bottom-1/2 -right-1/4 h-[600px] w-[600px] rounded-full opacity-[0.03]"
          style={{ background: 'radial-gradient(circle, #3CC8E0 0%, transparent 70%)' }}
        />
      </div>

      <div className="relative w-full max-w-[380px]">
        {/* Logo / Brand */}
        <div className="mb-8 text-center">
          <div className="mb-4 inline-block">
            <Image
              src="/brand/leadzilla-wordmark.svg"
              alt="Leadzilla"
              width={220}
              height={50}
              priority
              className="mx-auto h-auto w-[190px]"
            />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">Leadzilla Demo</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Public sandbox for an AI-assisted outbound sales platform
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-border/50 bg-card p-8 shadow-xl shadow-black/20">
          <div className="mb-5 rounded-xl border border-zbooni-teal/25 bg-zbooni-teal/10 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
            <p className="font-semibold text-foreground">Public demo access is prefilled.</p>
            <p className="mt-1">
              This sandbox is read-focused. Discovery, enrichment, messaging, outbound sends,
              and worker-backed jobs are disabled, and demo data may be reset.
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium text-muted-foreground">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClassName}
                placeholder={DEMO_EMAIL}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium text-muted-foreground">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClassName}
                placeholder="••••••••"
              />
            </div>

            {error ? (
              <p className="text-sm font-medium text-destructive">{error}</p>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="zbooni-gradient-bg inline-flex h-11 w-full items-center justify-center rounded-xl text-sm font-semibold text-zbooni-dark shadow-lg shadow-zbooni-green/20 transition-all hover:opacity-90 hover:shadow-zbooni-green/30 disabled:pointer-events-none disabled:opacity-50"
            >
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-zbooni-dark/30 border-t-zbooni-dark" />
                  Signing in...
                </span>
              ) : (
                'Enter demo'
              )}
            </button>

            <p className="rounded-xl border border-border/70 bg-secondary/20 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
              Credentials: <span className="font-medium text-foreground">{DEMO_EMAIL}</span> /{' '}
              <span className="font-medium text-foreground">{DEMO_PASSWORD}</span>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
