'use client';

import { AlertTriangle, Loader2 } from 'lucide-react';

import { LeadsNav } from '@/components/leads-nav.js';
import { useDiscoveryAdminAccess } from '@/hooks/use-discovery-admin-access.js';

export default function BusinessIntelligencePage() {
  const adminAccess = useDiscoveryAdminAccess();

  if (adminAccess.isLoading) {
    return (
      <div className="space-y-4">
        <LeadsNav active="main" />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Verifying admin access...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <LeadsNav active="main" />
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="flex items-start gap-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div>
            <p className="font-semibold text-foreground">Raw business intelligence browser view removed.</p>
            <p className="mt-1 text-muted-foreground">
              This surface no longer reads operational business tables from the browser.
            </p>
            <p className="mt-2 text-muted-foreground">
              {adminAccess.isAllowed
                ? 'Use the protected discovery admin workflows or direct database tooling for raw operational inspection.'
                : adminAccess.error ?? 'Admin access is required for this surface.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
