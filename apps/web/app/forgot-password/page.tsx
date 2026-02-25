'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { getSupabaseBrowserClient } from '../../src/lib/supabase-client.js';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [authNotConfigured, setAuthNotConfigured] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const supabase = getSupabaseBrowserClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email);
      if (resetError) {
        setError(resetError.message);
      } else {
        setSent(true);
      }
    } catch {
      setAuthNotConfigured(true);
    } finally {
      setIsSubmitting(false);
    }
  };

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
              src="/zbooni-logo-dark.png"
              alt="Zbooni"
              width={200}
              height={200}
              priority
              className="mx-auto invert"
            />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">Sales OS</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Reset your password
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-border/50 bg-card p-8 shadow-xl shadow-black/20">
          {authNotConfigured ? (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-6 w-6 text-muted-foreground"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <p className="text-sm text-muted-foreground">
                Auth not configured — set{' '}
                <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">
                  NEXT_PUBLIC_SUPABASE_URL
                </code>{' '}
                and{' '}
                <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">
                  NEXT_PUBLIC_SUPABASE_ANON_KEY
                </code>
              </p>
              <Link
                href="/login"
                className="inline-block text-sm text-muted-foreground/60 hover:text-foreground transition-colors"
              >
                Back to sign in
              </Link>
            </div>
          ) : sent ? (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zbooni-green/10">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-6 w-6 text-zbooni-green"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium">Check your email</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  We sent a reset link to{' '}
                  <span className="font-medium text-foreground">{email}</span>
                </p>
              </div>
              <Link
                href="/login"
                className="inline-block text-sm text-muted-foreground/60 hover:text-foreground transition-colors"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
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
                  className="flex h-11 w-full rounded-xl border border-input bg-background px-4 text-sm transition-colors placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="you@zbooni.com"
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
                    Sending...
                  </span>
                ) : (
                  'Send reset link'
                )}
              </button>

              <div className="text-center">
                <Link
                  href="/login"
                  className="text-sm text-muted-foreground/60 hover:text-foreground transition-colors"
                >
                  Back to sign in
                </Link>
              </div>
            </form>
          )}
        </div>

      </div>
    </div>
  );
}
