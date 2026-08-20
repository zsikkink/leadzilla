'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '../hooks/use-auth.js';
import { useSidebarCollapse } from '../hooks/use-sidebar-collapse.js';
import { getDemoPreviewPageKind } from '../lib/demo-preview-pages.js';
import { cn } from '../lib/utils.js';
import { DemoPreviewWorkspace } from './demo-preview-workspace.js';
import { Header } from './header.js';
import { Sidebar } from './sidebar.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog.js';

const LOGIN_PREVIEW_NOTICE_SESSION_KEY = 'leadzilla:show-login-preview-notice';
const PREVIEW_NOTICE_DISMISSED_SESSION_KEY = 'leadzilla:preview-notice-dismissed';

interface AppShellProps {
  children: ReactNode;
  contentClassName?: string | undefined;
}

export function AppShell({ children, contentClassName }: AppShellProps) {
  const { isAuthenticated, isLoading, sessionMode } = useAuth();
  const pathname = usePathname();
  const { collapsed, toggle, hydrated } = useSidebarCollapse();
  const [previewNoticeOpen, setPreviewNoticeOpen] = useState(false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const isStaticPreview = sessionMode !== 'live';
  const isPublicDiscoverySurface = isStaticPreview && (
    pathname === '/dashboard/discover'
    || /^\/dashboard\/jobs\/[^/]+$/.test(pathname)
  );
  const previewPage = isStaticPreview && !isPublicDiscoverySurface
    ? getDemoPreviewPageKind(pathname)
    : null;

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    if (isStaticPreview) {
      try {
        setPreviewNoticeOpen(
          window.sessionStorage.getItem(PREVIEW_NOTICE_DISMISSED_SESSION_KEY) !== 'true',
        );
      } catch {
        setPreviewNoticeOpen(true);
      }
      return;
    }

    try {
      if (window.sessionStorage.getItem(LOGIN_PREVIEW_NOTICE_SESSION_KEY) === 'true') {
        window.sessionStorage.removeItem(LOGIN_PREVIEW_NOTICE_SESSION_KEY);
        setPreviewNoticeOpen(true);
      }
    } catch {
      // Ignore unavailable storage; the app should remain usable.
    }
  }, [isAuthenticated, isStaticPreview]);

  useEffect(() => {
    setMobileNavigationOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileNavigationOpen) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavigationOpen(false);
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [mobileNavigationOpen]);

  const handlePreviewNoticeOpenChange = useCallback((open: boolean) => {
    if (open) {
      setPreviewNoticeOpen(true);
    }
  }, []);

  const handlePreviewNoticeDismiss = useCallback(() => {
    if (isStaticPreview) {
      try {
        window.sessionStorage.setItem(PREVIEW_NOTICE_DISMISSED_SESSION_KEY, 'true');
      } catch {
        // The current acknowledgement still applies when storage is unavailable.
      }
    }
    setPreviewNoticeOpen(false);
  }, [isStaticPreview]);

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

  return (
    <div className="flex min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        Skip to main content
      </a>
      {hydrated ? (
        <div className="hidden md:block">
          <Sidebar collapsed={collapsed} onToggle={toggle} />
        </div>
      ) : null}
      {hydrated && mobileNavigationOpen ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            className="absolute inset-0 bg-black/65 backdrop-blur-sm"
            onClick={() => setMobileNavigationOpen(false)}
            aria-label="Close navigation"
          />
          <div className="relative h-full w-fit">
            <Sidebar
              collapsed={false}
              mobile
              onToggle={() => setMobileNavigationOpen(false)}
              onNavigate={() => setMobileNavigationOpen(false)}
            />
          </div>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header onOpenNavigation={() => setMobileNavigationOpen(true)} />
        <main id="main-content" className={cn('flex-1 overflow-auto p-3 sm:p-4 lg:p-6', contentClassName)}>
          {previewPage ? <DemoPreviewWorkspace page={previewPage} /> : children}
        </main>
      </div>
      <Dialog open={previewNoticeOpen} onOpenChange={handlePreviewNoticeOpenChange}>
        <DialogContent
          className="border-white/[0.08] bg-card/95 text-foreground shadow-[0_24px_80px_rgba(0,0,0,0.45)] sm:max-w-[430px]"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          showCloseButton={false}
        >
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">This is a demo environment</DialogTitle>
            <DialogDescription
              className={cn('leading-6', isStaticPreview && 'text-foreground')}
            >
              {isStaticPreview
                ? 'Live discovery jobs use a fixed five-search-task budget. Other views use read-only demo data, and outbound delivery remains disabled.'
                : 'Explore lead discovery, scoring, and message drafting.'}
            </DialogDescription>
          </DialogHeader>
          {!isStaticPreview && (
            <p className="text-sm leading-6 text-foreground">
              Sending emails, SMS messages, and WhatsApp messages is disabled.
            </p>
          )}
          <DialogFooter className="mt-6 justify-center sm:justify-center">
            <button
              type="button"
              onClick={handlePreviewNoticeDismiss}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-zbooni-teal/15 bg-zbooni-teal/[0.045] px-4 text-sm font-semibold text-zbooni-teal shadow-sm shadow-black/10 transition-colors hover:bg-zbooni-teal/[0.075] focus:outline-none focus:ring-2 focus:ring-zbooni-teal/25 focus:ring-offset-2 focus:ring-offset-background"
            >
              {isStaticPreview ? 'View Demo' : 'Start exploring'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
