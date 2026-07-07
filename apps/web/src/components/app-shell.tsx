'use client';

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '../hooks/use-auth.js';
import { useSidebarCollapse } from '../hooks/use-sidebar-collapse.js';
import { cn } from '../lib/utils.js';
import { Header } from './header.js';
import { Sidebar } from './sidebar.js';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog.js';

const LOGIN_PREVIEW_NOTICE_SESSION_KEY = 'leadzilla:show-login-preview-notice';

interface AppShellProps {
  children: ReactNode;
  contentClassName?: string | undefined;
}

export function AppShell({ children, contentClassName }: AppShellProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const { collapsed, toggle, hydrated } = useSidebarCollapse();
  const [previewNoticeOpen, setPreviewNoticeOpen] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    if (!isAuthenticated) {
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
  }, [isAuthenticated]);

  const handlePreviewNoticeOpenChange = useCallback((open: boolean) => {
    setPreviewNoticeOpen(open);
  }, []);

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
          {children}
        </main>
      </div>
      <Dialog open={previewNoticeOpen} onOpenChange={handlePreviewNoticeOpenChange}>
        <DialogContent className="border-white/[0.08] bg-card/95 text-foreground shadow-[0_24px_80px_rgba(0,0,0,0.45)] sm:max-w-[430px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Safe public preview</DialogTitle>
            <DialogDescription className="leading-6">
              This is a demo environment. Run small discovery and scoring workflows, then generate
              message drafts.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm leading-6 text-muted-foreground">
            <span className="font-semibold text-foreground">Message sending is disabled for safety.</span>{' '}
            Email, WhatsApp, and follow-ups are turned off.
          </p>
          <DialogFooter className="justify-center sm:justify-center">
            <DialogClose asChild>
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center rounded-lg border border-zbooni-teal/15 bg-zbooni-teal/[0.045] px-4 text-sm font-semibold text-zbooni-teal shadow-sm shadow-black/10 transition-colors hover:bg-zbooni-teal/[0.075] focus:outline-none focus:ring-2 focus:ring-zbooni-teal/25 focus:ring-offset-2 focus:ring-offset-background"
              >
                Start exploring
              </button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
