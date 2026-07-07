'use client';

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useAuth } from '../hooks/use-auth.js';
import { useSidebarCollapse } from '../hooks/use-sidebar-collapse.js';
import { cn } from '../lib/utils.js';
import { Header } from './header.js';
import { Sidebar } from './sidebar.js';

interface AppShellProps {
  children: ReactNode;
  contentClassName?: string | undefined;
}

export function AppShell({ children, contentClassName }: AppShellProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const { collapsed, toggle, hydrated } = useSidebarCollapse();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="flex min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        Skip to main content
      </a>
      {hydrated && <Sidebar collapsed={collapsed} onToggle={toggle} />}
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main id="main-content" className={cn('flex-1 overflow-auto p-6', contentClassName)}>
          <div className="mb-5 rounded-lg border border-zbooni-teal/25 bg-zbooni-teal/10 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">Leadzilla demo sandbox.</span>{' '}
            This is a read-focused public demo. Discovery, enrichment, messaging,
            outbound sends, and worker-backed jobs are disabled; demo data may be reset.
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
