'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { useAuth } from '../../src/hooks/use-auth.js';

const DEMO_EMAIL = 'demo@example.com';
const DEMO_PASSWORD = 'password';
const LOGIN_PREVIEW_NOTICE_SESSION_KEY = 'leadzilla:show-login-preview-notice';

export default function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState(DEMO_EMAIL);
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isAuthenticated && !isSubmitting) {
      router.replace('/dashboard');
    }
  }, [isAuthenticated, isSubmitting, router]);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await login(email, password);
      try {
        window.sessionStorage.setItem(LOGIN_PREVIEW_NOTICE_SESSION_KEY, 'true');
      } catch {
        // Ignore unavailable storage; login should continue normally.
      }
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
    'flex h-10 w-full rounded-lg border border-border/70 bg-background/70 px-3.5 text-sm text-foreground shadow-inner shadow-black/[0.03] transition-colors placeholder:text-muted-foreground/40 focus:border-zbooni-teal/50 focus:outline-none focus:ring-2 focus:ring-zbooni-teal/15';

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-8 sm:py-12">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(60,200,224,0.045)_0%,rgba(123,255,107,0.02)_36%,transparent_72%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-zbooni-teal/30 to-transparent" />

      <div className="relative w-full max-w-[440px] -translate-y-6 sm:-translate-y-8">
        <div className="mb-20 text-center">
          <div className="mb-3">
            <Image
              src="/brand/leadzilla-wordmark.svg"
              alt="Leadzilla"
              width={504}
              height={115}
              priority
              className="mx-auto h-auto w-[403.2px] max-w-full sm:w-[427.2px]"
            />
          </div>
          <h1 className="mx-auto max-w-[430px] whitespace-nowrap text-[34px] font-black leading-none tracking-normal text-foreground">
            AI-Driven Sales Platform
          </h1>
        </div>

        <div className="mx-auto max-w-[360px] rounded-lg border border-white/[0.08] bg-card/90 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur sm:p-6">
          <form onSubmit={handleLogin} className="space-y-4">
            <h2 className="text-left text-lg font-semibold text-foreground">Sign in</h2>

            <div className="space-y-1.5">
              <label htmlFor="email" className="text-xs font-medium text-muted-foreground">
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

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-xs font-medium text-muted-foreground">
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
              <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="zbooni-gradient-bg inline-flex h-10 w-full items-center justify-center rounded-lg text-sm font-semibold text-zbooni-dark shadow-md shadow-zbooni-green/10 transition-all hover:-translate-y-px hover:shadow-zbooni-green/15 focus:outline-none focus:ring-2 focus:ring-zbooni-teal/35 focus:ring-offset-2 focus:ring-offset-background disabled:pointer-events-none disabled:translate-y-0 disabled:opacity-50"
            >
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-zbooni-dark/30 border-t-zbooni-dark" />
                  Signing in...
                </span>
              ) : (
                'Enter'
              )}
            </button>

            <p className="text-center text-xs leading-5 text-muted-foreground">
              <span>Demo credentials: </span>
              <span className="font-medium text-foreground">{DEMO_EMAIL}</span>
              <span className="text-muted-foreground/50"> / </span>
              <span className="font-medium text-foreground">{DEMO_PASSWORD}</span>
            </p>

            <p className="text-center text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
              Built by Zack Sikkink
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
