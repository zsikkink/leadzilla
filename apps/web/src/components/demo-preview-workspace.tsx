'use client';

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Bot,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  Database,
  Eye,
  Globe2,
  Lightbulb,
  Mail,
  MapPin,
  PencilLine,
  Rocket,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { DemoPreviewPageKind } from '../lib/demo-preview-pages.js';
import {
  DEMO_ICP_PLAYBOOKS,
  type DemoIcpPlaybook,
} from '../lib/demo-icp-playbooks.js';
import { DEMO_LEADS, DEMO_OPERATING_TOTALS } from '../lib/demo-operating-narrative.js';
import { cn } from '../lib/utils.js';
import { DemoInboxShowcase } from './demo-inbox-showcase.js';
import { DemoSettingsShowcase } from './demo-settings-showcase.js';
import {
  DemoCard,
  DemoSectionHeading,
} from './demo-dashboard-ui.js';

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

function IcpProfileCard({ profile }: { profile: DemoIcpPlaybook }) {
  return (
    <Link
      href={`/dashboard/icps/${profile.id}`}
      className="group flex min-h-[250px] w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-border/50 bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-zbooni-teal/35 hover:shadow-lg hover:shadow-black/10 sm:p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <h2 className="min-w-0 text-lg font-bold leading-snug tracking-tight transition-colors group-hover:text-zbooni-teal">
          {profile.name}
        </h2>
        <span className="shrink-0 rounded-full bg-zbooni-green/15 px-2.5 py-1 text-[11px] font-bold text-zbooni-green">
          Active
        </span>
      </div>

      <p className="mt-3 line-clamp-3 text-sm leading-6 text-muted-foreground">
        {profile.description}
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {profile.industries.map((industry) => (
          <span key={industry} className="rounded-full bg-white/[0.045] px-2.5 py-1 text-xs text-foreground/75">
            {industry}
          </span>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="rounded-full bg-zbooni-teal/10 px-2.5 py-1 text-xs text-zbooni-teal">
          United States
        </span>
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

function DetailCard({
  title,
  icon: Icon,
  children,
  action,
}: {
  title: string;
  icon: LucideIcon;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight">
          <Icon className="h-4 w-4 text-zbooni-teal" />
          {title}
        </h2>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function EditablePlaybookField({
  label,
  value,
  multiline = false,
  onSave,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  onSave: (value: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const cancel = () => {
    setDraft(value);
    setIsEditing(false);
  };

  const save = () => {
    const nextValue = draft.trim();
    if (nextValue) onSave(nextValue);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{label}</p>
        <div className="mt-2">
          {multiline ? (
            <textarea
              aria-label={label}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={5}
              className="w-full resize-none rounded-lg border border-border/50 bg-zbooni-dark/60 px-3 py-2.5 text-sm leading-6 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              autoFocus
            />
          ) : (
            <input
              aria-label={label}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="h-10 w-full rounded-lg border border-border/50 bg-zbooni-dark/60 px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              autoFocus
            />
          )}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={cancel}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/50 px-2.5 text-xs font-semibold text-muted-foreground hover:bg-accent/50"
            >
              <X className="h-3.5 w-3.5" /> Cancel
            </button>
            <button
              type="button"
              onClick={save}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-xs font-semibold text-primary-foreground"
            >
              <Save className="h-3.5 w-3.5" /> Apply
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{label}</p>
        <button
          type="button"
          onClick={() => {
            setDraft(value);
            setIsEditing(true);
          }}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-zbooni-teal transition-colors hover:bg-zbooni-teal/10"
        >
          <PencilLine className="h-3 w-3" /> Edit
        </button>
      </div>
      <p className={cn('mt-1.5 text-sm text-foreground/85', multiline && 'leading-6')}>
        {value}
      </p>
    </div>
  );
}

function IcpDetailPreview({ profile }: { profile: DemoIcpPlaybook }) {
  const [salesApproach, setSalesApproach] = useState(profile.salesApproach);
  const [primaryCta, setPrimaryCta] = useState(profile.primaryCta);

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
          Rep-editable demo profile
        </span>
      </div>

      <section className="overflow-hidden rounded-2xl border border-border/50 bg-card shadow-sm">
        <div className="border-b border-border/40 bg-gradient-to-br from-zbooni-teal/[0.09] via-transparent to-zbooni-green/[0.045] p-6 sm:p-8">
          <div className="max-w-3xl">
            <span className="rounded-full bg-zbooni-green/15 px-2.5 py-1 text-[11px] font-bold text-zbooni-green">
              Active profile
            </span>
            <h1 className="mt-4 text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">{profile.name}</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
              {profile.description}
            </p>
          </div>
        </div>
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <DetailCard title="Target audience" icon={Building2}>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Industries</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {profile.industries.map((industry) => (
                <span key={industry} className="rounded-full bg-white/[0.045] px-2.5 py-1 text-xs text-foreground/75">
                  {industry}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-5">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              <Globe2 className="h-3.5 w-3.5" /> Market
            </p>
            <div className="mt-2">
              <span className="rounded-full bg-zbooni-teal/10 px-2.5 py-1 text-xs text-zbooni-teal">United States</span>
            </div>
          </div>
          <div className="mt-5 grid gap-4 border-t border-border/30 pt-4 sm:grid-cols-2">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Best-fit accounts</p>
              <p className="mt-1 text-sm font-semibold leading-6">{profile.bestFit}</p>
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Primary buyers</p>
              <p className="mt-1 text-sm font-semibold leading-6">{profile.primaryBuyers}</p>
            </div>
          </div>
        </DetailCard>

        <DetailCard
          title="Sales playbook"
          icon={Lightbulb}
          action={<span className="text-[11px] font-semibold text-zbooni-teal">Rep editable</span>}
        >
          <EditablePlaybookField
            label="Sales approach"
            value={salesApproach}
            multiline
            onSave={setSalesApproach}
          />
          <div className="mt-5 border-t border-border/30 pt-4">
            <EditablePlaybookField
              label="Primary CTA"
              value={primaryCta}
              onSave={setPrimaryCta}
            />
          </div>
        </DetailCard>
      </div>

      <DetailCard title="Qualification signals" icon={Target}>
        <p className="mb-4 max-w-3xl text-sm leading-6 text-muted-foreground">
          Discovery results are evaluated against the signals that define this profile before entering sales review.
        </p>
        <div className="rounded-xl border border-zbooni-green/20 bg-zbooni-green/[0.045] p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-zbooni-green" />
            <div>
              <p className="text-sm font-bold">Positive buying signals</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{profile.buyingSignals}</p>
            </div>
          </div>
        </div>
      </DetailCard>
    </div>
  );
}

function IcpsPreview() {
  const pathname = usePathname();
  const profileId = pathname.match(/^\/dashboard\/icps\/([^/]+)$/)?.[1];
  const selectedProfile = profileId
    ? DEMO_ICP_PLAYBOOKS.find((profile) => profile.id === decodeURIComponent(profileId))
    : undefined;

  if (selectedProfile) {
    return <IcpDetailPreview key={selectedProfile.id} profile={selectedProfile} />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">4 customer profiles</p>
        <span className="rounded-full border border-border/50 bg-card px-3 py-1.5 text-[11px] font-semibold text-muted-foreground">
          Select a profile to review its sales playbook
        </span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {DEMO_ICP_PLAYBOOKS.map((profile) => <IcpProfileCard key={profile.id} profile={profile} />)}
      </div>
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
