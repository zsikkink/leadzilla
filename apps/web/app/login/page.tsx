'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { useAuth } from '../../src/hooks/use-auth.js';
import { getSupabaseBrowserClient } from '../../src/lib/supabase-client.js';

type ViewMode = 'login' | 'register' | 'register-success';

export default function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const router = useRouter();

  const [view, setView] = useState<ViewMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [companyRole, setCompanyRole] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      router.replace('/');
    }
  }, [isAuthenticated, router]);

  if (isAuthenticated) {
    return null;
  }

  const resetForm = () => {
    setEmail('');
    setPassword('');
    setFullName('');
    setCompanyRole('');
    setError(null);
  };

  const switchView = (newView: ViewMode) => {
    resetForm();
    setView(newView);
  };

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await login(email, password);
      router.replace('/');
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

  const handleRegister = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const supabase = getSupabaseBrowserClient();
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            company_role: companyRole,
          },
        },
      });

      if (signUpError) {
        setError(signUpError.message);
      } else {
        setView('register-success');
      }
    } catch {
      setError('Registration unavailable — auth is not configured');
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
            {view === 'login' ? 'Sign in to your pipeline' : view === 'register' ? 'Request access' : 'Registration submitted'}
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-border/50 bg-card p-8 shadow-xl shadow-black/20">
          {view === 'register-success' ? (
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
                <p className="text-sm font-medium">Registration submitted</p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  An approval email has been sent to the administrator. You will receive access once your account is approved.
                </p>
              </div>
              <button
                type="button"
                onClick={() => switchView('login')}
                className="inline-block text-sm text-muted-foreground/60 hover:text-foreground transition-colors"
              >
                Back to sign in
              </button>
            </div>
          ) : view === 'register' ? (
            <form onSubmit={handleRegister} className="space-y-5">
              <div className="space-y-2">
                <label htmlFor="reg-name" className="text-sm font-medium text-muted-foreground">
                  Full name
                </label>
                <input
                  id="reg-name"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className={inputClassName}
                  placeholder="Jane Doe"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="reg-email" className="text-sm font-medium text-muted-foreground">
                  Email
                </label>
                <input
                  id="reg-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClassName}
                  placeholder="you@zbooni.com"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="reg-role" className="text-sm font-medium text-muted-foreground">
                  Company role
                </label>
                <input
                  id="reg-role"
                  type="text"
                  required
                  value={companyRole}
                  onChange={(e) => setCompanyRole(e.target.value)}
                  className={inputClassName}
                  placeholder="Sales Manager"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="reg-password" className="text-sm font-medium text-muted-foreground">
                  Password
                </label>
                <input
                  id="reg-password"
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClassName}
                  placeholder="Minimum 8 characters"
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
                    Submitting...
                  </span>
                ) : (
                  'Register'
                )}
              </button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => switchView('login')}
                  className="text-sm text-muted-foreground/60 hover:text-foreground transition-colors"
                >
                  Already have an account? Sign in
                </button>
              </div>
            </form>
          ) : (
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
                  placeholder="you@zbooni.com"
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
                  'Sign in'
                )}
              </button>

              <button
                type="button"
                onClick={() => switchView('register')}
                className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-border/70 text-sm font-semibold text-foreground transition-all hover:border-border hover:bg-secondary/50"
              >
                Register
              </button>
            </form>
          )}
        </div>

        {view === 'login' ? (
          <div className="mt-4 text-center">
            <Link
              href="/forgot-password"
              className="text-sm text-muted-foreground/60 hover:text-foreground transition-colors"
            >
              Forgot password?
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}
