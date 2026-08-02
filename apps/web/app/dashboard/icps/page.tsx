'use client';

import type { IcpProfileResponse } from '@lead-flood/contracts';
import { ArrowUpRight, Eye } from 'lucide-react';
import Link from 'next/link';
import { useCallback } from 'react';

import { useApiQuery } from '../../../src/hooks/use-api-query.js';
import { useAuth } from '../../../src/hooks/use-auth.js';
import { countryName } from '../../../src/lib/countries.js';
import { summarizeIcpDescription } from './[icpId]/page.helpers.js';

function ProfileCard({ profile }: { profile: IcpProfileResponse }) {
  return (
    <Link
      href={`/dashboard/icps/${profile.id}`}
      className="group flex min-h-[250px] w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-border/50 bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-zbooni-teal/35 hover:shadow-lg hover:shadow-black/10 sm:p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <h2 className="min-w-0 text-lg font-bold leading-snug tracking-tight transition-colors group-hover:text-zbooni-teal">
          {profile.name}
        </h2>
        <span
          className={profile.isActive
            ? 'shrink-0 rounded-full bg-zbooni-green/15 px-2.5 py-1 text-[11px] font-bold text-zbooni-green'
            : 'shrink-0 rounded-full bg-muted/20 px-2.5 py-1 text-[11px] font-bold text-muted-foreground'}
        >
          {profile.isActive ? 'Active' : 'Paused'}
        </span>
      </div>

      <p className="mt-3 line-clamp-3 text-sm leading-6 text-muted-foreground">
        {summarizeIcpDescription(profile.description, 220)}
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {profile.targetIndustries.slice(0, 5).map((industry) => (
          <span key={industry} className="rounded-full bg-white/[0.045] px-2.5 py-1 text-xs text-foreground/75">
            {industry}
          </span>
        ))}
        {profile.targetIndustries.length > 5 ? (
          <span className="rounded-full bg-white/[0.035] px-2.5 py-1 text-xs text-muted-foreground">
            +{profile.targetIndustries.length - 5}
          </span>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {profile.targetCountries.slice(0, 5).map((country) => (
          <span key={country} className="rounded-full bg-zbooni-teal/10 px-2.5 py-1 text-xs text-zbooni-teal">
            {countryName(country)}
          </span>
        ))}
        {profile.targetCountries.length > 5 ? (
          <span className="rounded-full bg-zbooni-teal/5 px-2.5 py-1 text-xs text-zbooni-teal/70">
            +{profile.targetCountries.length - 5}
          </span>
        ) : null}
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-border/30 pt-4 text-xs">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Eye className="h-3.5 w-3.5" />
          Profile overview
        </span>
        <span className="inline-flex items-center gap-1 font-semibold text-zbooni-teal">
          View <ArrowUpRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </Link>
  );
}

export default function IcpsPage() {
  const { apiClient } = useAuth();
  const icps = useApiQuery(
    useCallback(() => apiClient.listIcps({ page: 1, pageSize: 50, isActive: true }), [apiClient]),
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {icps.data ? `${icps.data.total} customer profiles` : 'Loading customer profiles...'}
        </p>
        <span className="rounded-full border border-border/50 bg-card px-3 py-1.5 text-[11px] font-semibold text-muted-foreground">
          Demo workspace · Read only
        </span>
      </div>

      {icps.error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-sm text-amber-100">
          <span>Customer profiles are refreshing. Try again in a moment.</span>
          <button
            type="button"
            onClick={() => void icps.refetch()}
            className="rounded-lg border border-amber-400/30 px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-amber-400/10"
          >
            Refresh
          </button>
        </div>
      ) : null}

      {icps.isLoading && !icps.data ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-[250px] animate-pulse rounded-2xl border border-border/40 bg-card/70" />
          ))}
        </div>
      ) : null}

      {icps.data?.items.length ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {icps.data.items.map((profile) => <ProfileCard key={profile.id} profile={profile} />)}
        </div>
      ) : null}

      {!icps.isLoading && icps.data?.items.length === 0 ? (
        <div className="rounded-2xl border border-border/50 bg-card p-10 text-center text-sm text-muted-foreground shadow-sm">
          No customer profiles are available in this workspace.
        </div>
      ) : null}
    </div>
  );
}
