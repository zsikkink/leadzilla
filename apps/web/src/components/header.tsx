'use client';

import { LogOut, ShieldCheck } from 'lucide-react';
import { usePathname } from 'next/navigation';

import { useAuth } from '../hooks/use-auth.js';

function getPageTitle(pathname: string): string {
  if (pathname === '/dashboard' || pathname === '/dashboard/analytics') return 'Dashboard';
  if (pathname === '/dashboard/discover') return 'Discover Leads';
  if (pathname.startsWith('/dashboard/leads/')) return 'Lead Detail';
  if (pathname === '/dashboard/leads') return 'Leads';
  if (pathname === '/dashboard/messages') return 'Inbox';
  if (pathname === '/dashboard/inbox') return 'Inbox';
  if (pathname === '/dashboard/jobs') return 'Discover Leads';
  if (pathname.startsWith('/dashboard/jobs/')) return 'Discovery Run';
  if (pathname === '/dashboard/prompts') return 'Prompt Center';
  if (pathname.startsWith('/dashboard/icps/')) return 'ICP Profile';
  if (pathname === '/dashboard/icps') return 'Ideal Customer Profiles';
  if (pathname === '/discovery') return 'Settings';

  return 'Dashboard';
}

export function Header() {
  const { user, logout, sessionMode } = useAuth();
  const pathname = usePathname();
  const pageTitle = getPageTitle(pathname);

  return (
    <header className="sticky top-0 z-30 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="flex h-16 items-center justify-between px-4 lg:px-6">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{pageTitle}</h1>
        </div>

        <div className="flex items-center gap-3">
          {sessionMode === 'preview' ? (
            <div className="flex items-center gap-2 rounded-full border border-zbooni-green/20 bg-zbooni-green/[0.07] px-3 py-1.5 text-zbooni-green shadow-sm shadow-black/10">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden text-xs font-bold sm:inline">Read-only portfolio demo</span>
              <span className="text-xs font-bold sm:hidden">Demo</span>
            </div>
          ) : user ? (
            <div className="flex items-center gap-2">
              <div className="hidden items-center gap-2 sm:flex">
                <span className="text-sm text-foreground">
                  {user.firstName}
                </span>
              </div>
            </div>
          ) : null}
          {sessionMode === 'live' ? (
            <button
              type="button"
              onClick={logout}
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
