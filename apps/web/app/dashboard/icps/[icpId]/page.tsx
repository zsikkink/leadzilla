'use client';

import type { QualificationRuleResponse } from '@lead-flood/contracts';
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Globe2,
  Lightbulb,
  ShieldCheck,
  Sparkles,
  Target,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback } from 'react';

import { useApiQuery } from '../../../../src/hooks/use-api-query.js';
import { useAuth } from '../../../../src/hooks/use-auth.js';
import { countryName } from '../../../../src/lib/countries.js';
import {
  extractIcpProfileMetadata,
  formatCompanySize,
  groupQualificationSignals,
  summarizeIcpDescription,
} from './page.helpers.js';

function Tag({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'teal' | 'green' }) {
  const toneClass = tone === 'teal'
    ? 'bg-zbooni-teal/10 text-zbooni-teal'
    : tone === 'green'
      ? 'bg-zbooni-green/10 text-zbooni-green'
      : 'bg-white/[0.045] text-foreground/75';

  return <span className={`rounded-full px-2.5 py-1 text-xs ${toneClass}`}>{children}</span>;
}

function SignalGroup({
  title,
  description,
  icon: Icon,
  rules,
  tone,
}: {
  title: string;
  description: string;
  icon: typeof CheckCircle2;
  rules: QualificationRuleResponse[];
  tone: 'green' | 'teal' | 'amber';
}) {
  if (rules.length === 0) return null;

  const toneClass = tone === 'green'
    ? 'border-zbooni-green/20 bg-zbooni-green/[0.045] text-zbooni-green'
    : tone === 'teal'
      ? 'border-zbooni-teal/20 bg-zbooni-teal/[0.045] text-zbooni-teal'
      : 'border-amber-400/20 bg-amber-400/[0.045] text-amber-300';

  return (
    <div className={`rounded-xl border p-4 ${toneClass}`}>
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="text-sm font-bold text-foreground">{title}</p>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {rules.map((rule) => (
          <div key={rule.id} className="rounded-lg border border-white/[0.06] bg-black/[0.1] px-3 py-2.5">
            <p className="text-xs font-semibold leading-5 text-foreground/85">{rule.name}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailCard({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Target;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm sm:p-6">
      <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight">
        <Icon className="h-4 w-4 text-zbooni-teal" />
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function IcpDetailPage() {
  const { icpId } = useParams<{ icpId: string }>();
  const { apiClient } = useAuth();
  const icp = useApiQuery(
    useCallback(() => apiClient.getIcp(icpId), [apiClient, icpId]),
    [icpId],
  );

  if (icp.error) {
    return (
      <div className="rounded-2xl border border-amber-500/25 bg-card p-6 text-sm shadow-sm">
        <p className="font-semibold text-foreground">This profile is refreshing.</p>
        <p className="mt-1 text-muted-foreground">Return to the profile list or try again in a moment.</p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => void icp.refetch()}
            className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
          >
            Refresh
          </button>
          <Link href="/dashboard/icps" className="rounded-lg border border-border/50 px-3 py-2 text-xs font-semibold text-muted-foreground">
            Back to profiles
          </Link>
        </div>
      </div>
    );
  }

  if (icp.isLoading || !icp.data) {
    return (
      <div className="space-y-5">
        <div className="h-5 w-36 animate-pulse rounded bg-card" />
        <div className="h-72 animate-pulse rounded-2xl border border-border/40 bg-card/70" />
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="h-64 animate-pulse rounded-2xl border border-border/40 bg-card/70" />
          <div className="h-64 animate-pulse rounded-2xl border border-border/40 bg-card/70" />
        </div>
      </div>
    );
  }

  const profile = icp.data;
  const metadata = extractIcpProfileMetadata(profile.metadataJson);
  const signals = groupQualificationSignals(profile.qualificationRules);
  const activeSignalCount = signals.required.length + signals.positive.length + signals.antiFit.length;
  const companySize = formatCompanySize(profile.minCompanySize, profile.maxCompanySize);
  const commercialDetails = [
    metadata.averageTicket ? { label: 'Average contract', value: metadata.averageTicket } : null,
    metadata.volumePotential ? { label: 'Volume potential', value: metadata.volumePotential } : null,
    metadata.salesCycle ? { label: 'Sales cycle', value: metadata.salesCycle } : null,
    metadata.revenuePotential ? { label: 'Revenue potential', value: metadata.revenuePotential } : null,
  ].filter((item): item is { label: string; value: string } => item !== null);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/dashboard/icps"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to profiles
        </Link>
        <span className="rounded-full border border-border/50 bg-card px-3 py-1.5 text-[11px] font-semibold text-muted-foreground">
          Demo profile · Read only
        </span>
      </div>

      <section className="overflow-hidden rounded-2xl border border-border/50 bg-card shadow-sm">
        <div className="border-b border-border/40 bg-gradient-to-br from-zbooni-teal/[0.09] via-transparent to-zbooni-green/[0.045] p-6 sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-3xl">
              <div className="flex flex-wrap items-center gap-2">
                <span className={profile.isActive
                  ? 'rounded-full bg-zbooni-green/15 px-2.5 py-1 text-[11px] font-bold text-zbooni-green'
                  : 'rounded-full bg-muted/20 px-2.5 py-1 text-[11px] font-bold text-muted-foreground'}
                >
                  {profile.isActive ? 'Active profile' : 'Paused profile'}
                </span>
              </div>
              <h1 className="mt-4 text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">{profile.name}</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
                {summarizeIcpDescription(profile.description)}
              </p>
            </div>
          </div>
        </div>

        <div className="grid divide-y divide-border/30 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="p-5">
            <p className="text-2xl font-extrabold tracking-tight">{profile.targetIndustries.length}</p>
            <p className="mt-1 text-xs text-muted-foreground">Target industries</p>
          </div>
          <div className="p-5">
            <p className="text-2xl font-extrabold tracking-tight">{profile.targetCountries.length}</p>
            <p className="mt-1 text-xs text-muted-foreground">Priority markets</p>
          </div>
          <div className="p-5">
            <p className="text-2xl font-extrabold tracking-tight">{activeSignalCount}</p>
            <p className="mt-1 text-xs text-muted-foreground">Qualification signals</p>
          </div>
        </div>
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <DetailCard title="Target audience" icon={Building2}>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Industries</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {profile.targetIndustries.map((industry) => <Tag key={industry}>{industry}</Tag>)}
            </div>
          </div>
          <div className="mt-5">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              <Globe2 className="h-3.5 w-3.5" /> Markets
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {profile.targetCountries.map((country) => <Tag key={country} tone="teal">{countryName(country)}</Tag>)}
            </div>
          </div>
          {companySize ? (
            <div className="mt-5 border-t border-border/30 pt-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Company size</p>
              <p className="mt-1 text-sm font-semibold">{companySize}</p>
            </div>
          ) : null}
        </DetailCard>

        <DetailCard title="Positioning" icon={Lightbulb}>
          {metadata.salesHook ? (
            <div className="rounded-xl border border-zbooni-teal/20 bg-zbooni-teal/[0.045] p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-zbooni-teal">Conversation opener</p>
              <p className="mt-2 text-sm leading-6 text-foreground/85">{metadata.salesHook}</p>
            </div>
          ) : null}
          {metadata.salesAngles.length > 0 ? (
            <div className="mt-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Sales angles</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {metadata.salesAngles.map((angle) => <Tag key={angle} tone="green">{angle}</Tag>)}
              </div>
            </div>
          ) : null}
          {profile.featureList?.length ? (
            <div className="mt-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Features to emphasize</p>
              <ul className="mt-2 space-y-2">
                {profile.featureList.slice(0, 6).map((feature) => (
                  <li key={feature} className="flex gap-2 text-sm leading-5 text-foreground/80">
                    <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zbooni-green" /> {feature}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {commercialDetails.length > 0 ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {commercialDetails.map((detail) => (
                <div key={detail.label} className="rounded-lg border border-border/30 bg-black/[0.08] p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{detail.label}</p>
                  <p className="mt-1 text-xs font-semibold">{detail.value}</p>
                </div>
              ))}
            </div>
          ) : null}
          {!metadata.salesHook && metadata.salesAngles.length === 0 && !profile.featureList?.length && commercialDetails.length === 0 ? (
            <p className="text-sm leading-6 text-muted-foreground">Positioning follows the workspace messaging standards for this segment.</p>
          ) : null}
        </DetailCard>
      </div>

      <DetailCard title="Qualification signals" icon={Target}>
        <p className="mb-4 max-w-3xl text-sm leading-6 text-muted-foreground">
          Discovery results are evaluated against required fit, positive intent, and anti-fit signals before entering operator review.
        </p>
        {activeSignalCount > 0 ? (
          <div className="space-y-3">
            <SignalGroup
              title="Required fit"
              description="A lead must satisfy these conditions to remain in the qualified pipeline."
              icon={ShieldCheck}
              rules={signals.required}
              tone="teal"
            />
            <SignalGroup
              title="Positive signals"
              description="These characteristics increase fit and prioritization."
              icon={CheckCircle2}
              rules={signals.positive}
              tone="green"
            />
            <SignalGroup
              title="Anti-fit signals"
              description="These characteristics reduce fit and help operators avoid weak prospects."
              icon={XCircle}
              rules={signals.antiFit}
              tone="amber"
            />
          </div>
        ) : (
          <div className="rounded-xl border border-border/40 bg-black/[0.08] p-5 text-sm text-muted-foreground">
            Qualification is inherited from the workspace scoring policy for this profile.
          </div>
        )}
      </DetailCard>

      {(profile.requiredTechnologies.length > 0 || profile.excludedDomains.length > 0) ? (
        <DetailCard title="Profile guardrails" icon={ShieldCheck}>
          <div className="grid gap-5 sm:grid-cols-2">
            {profile.requiredTechnologies.length > 0 ? (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Required technology</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {profile.requiredTechnologies.map((technology) => <Tag key={technology} tone="green">{technology}</Tag>)}
                </div>
              </div>
            ) : null}
            {profile.excludedDomains.length > 0 ? (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Excluded domains</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {profile.excludedDomains.map((domain) => <Tag key={domain}>{domain}</Tag>)}
                </div>
              </div>
            ) : null}
          </div>
        </DetailCard>
      ) : null}
    </div>
  );
}
