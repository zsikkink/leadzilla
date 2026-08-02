'use client';

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  Bot,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  Database,
  Globe2,
  Mail,
  MapPin,
  Rocket,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
} from 'lucide-react';

import type { DemoPreviewPageKind } from '../lib/demo-preview-pages.js';
import { DEMO_ANALYTICS_DASHBOARD_SNAPSHOT } from '../lib/demo-dashboard-snapshots.js';
import { DEMO_LEADS, DEMO_OPERATING_TOTALS } from '../lib/demo-operating-narrative.js';
import { cn } from '../lib/utils.js';
import { DemoInboxShowcase } from './demo-inbox-showcase.js';
import { DemoSettingsShowcase } from './demo-settings-showcase.js';
import {
  DemoCard,
  DemoProgressBar,
  DemoSectionHeading,
} from './demo-dashboard-ui.js';

const ICPS = DEMO_ANALYTICS_DASHBOARD_SNAPSHOT.icpPerformance.map((icp) => ({
  name: icp.name,
  scored: icp.scored.toLocaleString('en-US'),
  priority: icp.qualified.toLocaleString('en-US'),
  rate: icp.qualifiedRate,
  score: icp.avgScore.toFixed(2),
}));

function PreviewBanner({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zbooni-teal/20 bg-zbooni-teal/[0.055] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-zbooni-teal" />
        <div>
          <p className="text-sm font-bold text-white">Bundled {label} snapshot</p>
          <p className="mt-0.5 text-xs leading-5 text-white/65">
            This read-only view stays available without live services. Changes are not saved.
          </p>
        </div>
      </div>
      <span className="w-fit shrink-0 rounded-full border border-zbooni-green/25 bg-zbooni-green/10 px-3 py-1 text-[11px] font-bold text-zbooni-green">
        Zero live API requests
      </span>
    </div>
  );
}

function PreviewMetric({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.045] p-4 shadow-lg shadow-black/15">
      <div className="flex items-center gap-2 text-white/65">
        <Icon className="h-4 w-4 text-zbooni-teal" />
        <p className="text-[11px] font-bold uppercase tracking-wider">{label}</p>
      </div>
      <p className="mt-3 text-3xl font-extrabold tracking-tight text-white">{value}</p>
      <p className="mt-2 text-xs leading-5 text-white/60">{detail}</p>
    </div>
  );
}

function PreviewButton({ children }: { children: string }) {
  return (
    <button
      type="button"
      disabled
      title="Live actions are unavailable in the read-only preview"
      className="inline-flex h-9 cursor-not-allowed items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.05] px-3 text-xs font-bold text-white/45"
    >
      {children}
    </button>
  );
}

function DiscoverPreview() {
  const runs = [
    {
      name: 'July · ICP expansion and review',
      query: 'Revenue teams, vertical SaaS, and enterprise workflow platforms',
      found: '2,693',
      converted: '2,429',
      status: 'Complete',
    },
    {
      name: 'June · Initial scored inventory',
      query: 'Product-led SaaS, developer tools, and analytics software',
      found: '2,214',
      converted: '1,999',
      status: 'Complete',
    },
  ] as const;

  return (
    <div className="space-y-5">
      <PreviewBanner label="discovery" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <PreviewMetric icon={Database} label="Database leads" value={DEMO_OPERATING_TOTALS.sourceRecords.toLocaleString('en-US')} detail="4,906 discovery-linked leads plus one manually added lead." />
        <PreviewMetric icon={Search} label="Scored profiles" value={DEMO_OPERATING_TOTALS.scored.toLocaleString('en-US')} detail="Businesses with sufficient public context." />
        <PreviewMetric icon={Sparkles} label="Priority leads" value={DEMO_OPERATING_TOTALS.priority.toLocaleString('en-US')} detail="High-fit leads ready for immediate review." />
        <PreviewMetric icon={MapPin} label="Markets covered" value="24" detail="Representative metro and regional search markets." />
      </div>
      <DemoCard>
        <DemoSectionHeading
          icon={Rocket}
          title="Discovery Runs"
          subtitle="Representative search, normalization, and conversion history."
          action={<PreviewButton>Launch discovery</PreviewButton>}
        />
        <div className="grid gap-3 xl:grid-cols-2">
          {runs.map((run) => (
            <div key={run.name} className="rounded-lg border border-white/[0.08] bg-black/[0.12] p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-bold text-white">{run.name}</p>
                <span className="rounded-full border border-zbooni-green/20 bg-zbooni-green/10 px-2.5 py-1 text-[11px] font-bold text-zbooni-green">
                  {run.status}
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-white/60">{run.query}</p>
              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/[0.07] pt-4">
                <div>
                  <p className="text-xl font-extrabold text-white">{run.found}</p>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-white/40">found</p>
                </div>
                <div>
                  <p className="text-xl font-extrabold text-zbooni-teal">{run.converted}</p>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-white/40">converted</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </DemoCard>
    </div>
  );
}

function LeadsPreview() {
  return (
    <div className="space-y-5">
      <PreviewBanner label="lead portfolio" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <PreviewMetric icon={Users} label="Priority leads" value={DEMO_OPERATING_TOTALS.priority.toLocaleString('en-US')} detail="High-fit opportunities." />
        <PreviewMetric icon={Building2} label="High fit" value={DEMO_OPERATING_TOTALS.highFit.toLocaleString('en-US')} detail="Best accounts for immediate review." />
        <PreviewMetric icon={Globe2} label="Scored" value={DEMO_OPERATING_TOTALS.scored.toLocaleString('en-US')} detail="Profiles with enough business context for scoring." />
        <PreviewMetric icon={Mail} label="Drafts generated" value={DEMO_OPERATING_TOTALS.drafts.toLocaleString('en-US')} detail="Historical drafts held behind human review." />
      </div>
      <DemoCard>
        <DemoSectionHeading icon={BriefcaseBusiness} title="Priority Lead Review" subtitle="Representative enriched accounts from the scored portfolio." />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead>
              <tr className="border-b border-white/[0.08] text-[10px] font-bold uppercase tracking-wider text-white/45">
                <th className="pb-3 pr-4">Business</th>
                <th className="pb-3 pr-4">Segment</th>
                <th className="pb-3 pr-4">Location</th>
                <th className="pb-3 pr-4">Channels</th>
                <th className="pb-3 text-right">Score</th>
              </tr>
            </thead>
            <tbody>
              {DEMO_LEADS.map((lead) => (
                <tr key={lead.company} className="border-b border-white/[0.055] last:border-0">
                  <td className="py-4 pr-4">
                    <p className="text-sm font-bold text-white">{lead.company}</p>
                    <p className="mt-1 text-xs text-zbooni-green">{lead.status}</p>
                  </td>
                  <td className="py-4 pr-4 text-xs text-white/70">{lead.segment}</td>
                  <td className="py-4 pr-4 text-xs text-white/70">{lead.location}</td>
                  <td className="py-4 pr-4 text-xs text-white/70">{lead.channels}</td>
                  <td className="py-4 text-right text-lg font-extrabold text-white">{lead.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DemoCard>
    </div>
  );
}

function PromptsPreview() {
  const prompts = [
    {
      title: 'High-context first touch',
      channel: 'Email',
      version: 'v12',
      status: 'Active',
      detail: 'Uses business context, ICP pain points, and a low-friction relevance question.',
    },
    {
      title: 'Premium service conversation opener',
      channel: 'WhatsApp draft',
      version: 'v8',
      status: 'Review',
      detail: 'Short-form draft focused on appointment conversion and customer follow-through.',
    },
    {
      title: 'Consultation recovery follow-up',
      channel: 'Email',
      version: 'v5',
      status: 'Draft',
      detail: 'A restrained follow-up template for unresponsive high-intent opportunities.',
    },
  ] as const;

  return (
    <div className="space-y-5">
      <PreviewBanner label="prompt center" />
      <DemoCard>
        <DemoSectionHeading
          icon={Bot}
          title="Prompt Library"
          subtitle="Versioned drafting instructions with human-review guardrails."
          action={<PreviewButton>Create prompt</PreviewButton>}
        />
        <div className="grid gap-4 xl:grid-cols-3">
          {prompts.map((prompt) => (
            <div key={prompt.title} className="flex h-full flex-col rounded-lg border border-white/[0.08] bg-black/[0.12] p-4">
              <div className="flex items-start justify-between gap-3">
                <Bot className="h-5 w-5 text-violet-300" />
                <span className="rounded-full border border-white/[0.1] bg-white/[0.05] px-2.5 py-1 text-[11px] font-bold text-white/65">
                  {prompt.status}
                </span>
              </div>
              <p className="mt-4 text-base font-bold text-white">{prompt.title}</p>
              <p className="mt-2 flex-1 text-xs leading-5 text-white/60">{prompt.detail}</p>
              <div className="mt-4 flex items-center justify-between border-t border-white/[0.07] pt-3 text-xs">
                <span className="text-zbooni-teal">{prompt.channel}</span>
                <span className="font-bold text-white/45">{prompt.version}</span>
              </div>
            </div>
          ))}
        </div>
      </DemoCard>
      <DemoCard>
        <DemoSectionHeading icon={ShieldCheck} title="Drafting Guardrails" subtitle="Controls preserved across every prompt version." />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {['Human review required', 'Suppression checks preserved', 'No delivery provider calls', 'Outbound publishing disabled'].map((item) => (
            <div key={item} className="flex items-center gap-2 rounded-lg border border-zbooni-green/15 bg-zbooni-green/[0.045] p-3 text-xs font-semibold text-white/75">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-zbooni-green" />
              {item}
            </div>
          ))}
        </div>
      </DemoCard>
    </div>
  );
}

function InboxPreview() {
  return <DemoInboxShowcase />;
}

function IcpsPreview() {
  return (
    <div className="space-y-5">
      <PreviewBanner label="ICP portfolio" />
      <DemoCard>
        <DemoSectionHeading
          icon={Target}
          title="Ideal Customer Profiles"
          subtitle="Representative segments ranked by screened volume and priority rate."
        />
        <div className="space-y-3">
          {ICPS.map((icp) => (
            <div key={icp.name} className="rounded-lg border border-white/[0.08] bg-black/[0.12] p-4">
              <div className="grid gap-4 lg:grid-cols-[minmax(260px,1fr)_110px_110px_110px] lg:items-center">
                <div>
                  <p className="text-sm font-bold text-white">{icp.name}</p>
                  <div className="mt-3">
                    <DemoProgressBar value={icp.rate} max={100} tone="teal" />
                  </div>
                </div>
                <div>
                  <p className="text-lg font-extrabold text-white">{icp.scored}</p>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-white/40">scored</p>
                </div>
                <div>
                  <p className="text-lg font-extrabold text-zbooni-green">{icp.priority}</p>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-white/40">priority</p>
                </div>
                <div>
                  <p className="text-lg font-extrabold text-violet-200">{icp.score}</p>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-white/40">avg score</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </DemoCard>
    </div>
  );
}

function UnavailablePreview() {
  return (
    <div className="space-y-5">
      <PreviewBanner label="workspace" />
      <DemoCard>
        <div className="flex min-h-[280px] flex-col items-center justify-center text-center">
          <ShieldCheck className="h-8 w-8 text-zbooni-teal" />
          <h2 className="mt-4 text-xl font-bold text-white">This live-only detail is protected</h2>
          <p className="mt-2 max-w-lg text-sm leading-6 text-white/65">
            Use the main navigation to explore the bundled Dashboard, Discover, Leads, Prompt Center, Inbox, ICP, and Settings views.
          </p>
        </div>
      </DemoCard>
    </div>
  );
}

export function DemoPreviewWorkspace({ page }: { page: DemoPreviewPageKind }) {
  const content = {
    discover: <DiscoverPreview />,
    leads: <LeadsPreview />,
    prompts: <PromptsPreview />,
    inbox: <InboxPreview />,
    icps: <IcpsPreview />,
    settings: <DemoSettingsShowcase />,
    unavailable: <UnavailablePreview />,
  } satisfies Record<DemoPreviewPageKind, ReactNode>;

  return <div className={cn('mx-auto w-full max-w-[1600px]')}>{content[page]}</div>;
}
