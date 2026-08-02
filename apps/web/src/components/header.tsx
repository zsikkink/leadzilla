'use client';

import { LogOut } from 'lucide-react';
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
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const pageTitle = getPageTitle(pathname);

  return (
    <header className="sticky top-0 z-30 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="flex h-16 items-center justify-between px-4 lg:px-6">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{pageTitle}</h1>
        </div>

        <div className="flex items-center gap-3">
          {user ? (
            <div className="flex items-center gap-2">
              <div className="hidden items-center gap-2 sm:flex">
                <span className="text-sm text-foreground">
                  {user.firstName}
                </span>
              </div>
            </div>
          ) : null}
          <button
            type="button"
            onClick={logout}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
