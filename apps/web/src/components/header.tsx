'use client';

import { LogOut, Menu } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { useAuth } from '../hooks/use-auth.js';
import { cn } from '../lib/utils.js';

const MOBILE_NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/dashboard/discover', label: 'Discover' },
  { href: '/dashboard/leads', label: 'Leads' },
  { href: '/dashboard/prompts', label: 'Prompt Center' },
  { href: '/dashboard/inbox', label: 'Inbox' },
  { href: '/dashboard/icps', label: 'ICPs' },
  { href: '/discovery', label: 'Settings' },
  { href: '/discovery/lifecycle', label: 'Lead Lifecycle' },
  { href: '/discovery/model', label: 'Model Inspector' },
  { href: '/discovery/rules', label: 'Rules' },
] as const;

function getPageTitle(pathname: string): string {
  if (pathname === '/dashboard' || pathname === '/dashboard/analytics') return 'Dashboard';
  if (pathname === '/dashboard/discover') return 'Discover Leads';
  if (pathname === '/dashboard/leads/businesses') return 'Business Intelligence';
  if (pathname === '/dashboard/leads/recovery') return 'Contact Recovery';
  if (pathname.startsWith('/dashboard/leads/')) return 'Lead Detail';
  if (pathname === '/dashboard/leads') return 'Leads';
  if (pathname === '/dashboard/messages') return 'Inbox';
  if (pathname === '/dashboard/inbox') return 'Inbox';
  if (pathname === '/dashboard/jobs') return 'Discover Leads';
  if (pathname.startsWith('/dashboard/jobs/')) return 'Discovery Run';
  if (pathname === '/dashboard/prompts') return 'Prompt Center';
  if (pathname.startsWith('/dashboard/icps/')) return 'ICP Profile';
  if (pathname === '/dashboard/icps') return 'ICPs';
  if (pathname === '/discovery') return 'Settings';
  if (pathname === '/discovery/lifecycle') return 'Lead Lifecycle Inspector';
  if (pathname.startsWith('/discovery/lifecycle/')) return 'Lead Lifecycle Inspector';
  if (pathname === '/discovery/model') return 'Model Inspector';
  if (pathname === '/discovery/rules') return 'Rules';

  return 'Dashboard';
}

export function Header() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pageTitle = getPageTitle(pathname);

  return (
    <header className="sticky top-0 z-30 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="flex h-16 items-center justify-between px-4 lg:px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent focus:outline-none focus:ring-2 focus:ring-primary/40 lg:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Open navigation menu"
            aria-expanded={mobileMenuOpen}
          >
            <Menu className="h-5 w-5" />
          </button>
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

      {/* Mobile nav */}
      {mobileMenuOpen ? (
        <nav className="border-t border-border/50 p-3 lg:hidden">
          {MOBILE_NAV.map(({ href, label }) => {
            const isDiscoverDetailRoute =
              href === '/dashboard/discover' && pathname.startsWith('/dashboard/jobs');
            const isDashboardRoute =
              href === '/dashboard' && (pathname === '/dashboard' || pathname === '/dashboard/analytics');
            const isActive =
              href === '/dashboard'
                ? isDashboardRoute
                : isDiscoverDetailRoute ||
                  pathname === href ||
                  (href !== '/discovery' && pathname.startsWith(`${href}/`));
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  'block rounded-lg px-3 py-2 text-sm font-medium',
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50',
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
