'use client';

import Image from 'next/image';
import Link from 'next/link';
import { AlertCircle } from 'lucide-react';

import { withAppBasePath } from '../../src/lib/app-path.js';

export default function ForgotPasswordPage() {
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
              src={withAppBasePath('/brand/leadzilla-wordmark.svg')}
              alt="Leadzilla"
              width={220}
              height={50}
              priority
              className="mx-auto h-auto w-[190px]"
            />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">Leadzilla Demo</h1>
          <p className="mt-1 text-sm text-muted-foreground">Password reset is disabled</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-border/50 bg-card p-8 shadow-xl shadow-black/20">
          <div className="space-y-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zbooni-teal/10">
              <AlertCircle className="h-6 w-6 text-zbooni-teal" />
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Password reset emails are not available in the public sandbox. Use the
              prefilled demo credentials on the login page.
            </p>
            <Link
              href="/login"
              className="zbooni-gradient-bg inline-flex h-11 w-full items-center justify-center rounded-xl text-sm font-semibold text-zbooni-dark shadow-lg shadow-zbooni-green/20 transition-all hover:opacity-90"
            >
              Back to demo login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
