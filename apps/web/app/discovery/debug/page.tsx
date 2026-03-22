'use client';

import { AlertTriangle, Loader2 } from 'lucide-react';

import { useDiscoveryAdminAccess } from '@/hooks/use-discovery-admin-access.js';

export default function PipelineDebugPage() {
  const adminAccess = useDiscoveryAdminAccess();

  if (adminAccess.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Verifying admin access...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="flex items-start gap-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div>
            <p className="font-semibold text-foreground">Pipeline Debug is admin-only.</p>
            <p className="mt-1 text-muted-foreground">
              This raw inspection surface no longer reads operational tables from the browser.
            </p>
            <p className="mt-2 text-muted-foreground">
              {adminAccess.isAllowed
                ? 'Use protected admin workflows or direct database tooling for low-level investigation.'
                : adminAccess.error ?? 'Admin access is required for this surface.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
