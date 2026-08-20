'use client';

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
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
  TrendingUp,
  UserPlus,
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
  const pathname = usePathname();
  const leadId = pathname.match(/^\/dashboard\/leads\/([^/]+)$/)?.[1];
  const selectedLead = leadId ? DEMO_LEADS.find((lead) => lead.id === leadId) : undefined;
  const [searchQuery, setSearchQuery] = useState('');
  const [enrichedLeadIds, setEnrichedLeadIds] = useState<ReadonlySet<string>>(() => new Set());

  const visibleLeads = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return DEMO_LEADS;
    return DEMO_LEADS.filter((lead) => (
      `${lead.contactName} ${lead.company} ${lead.role} ${lead.segment}`.toLowerCase().includes(query)
    ));
  }, [searchQuery]);

  const enrichLead = (leadIdToEnrich: string) => {
    setEnrichedLeadIds((current) => new Set(current).add(leadIdToEnrich));
  };

  if (leadId && selectedLead) {
    const scoreFactors = [
      { label: 'ICP alignment', value: Math.min(98, selectedLead.score + 4), detail: `${selectedLead.segment} matches a proven high-conversion segment.` },
      { label: 'Decision-maker fit', value: Math.min(96, selectedLead.score + 1), detail: `${selectedLead.contactName} holds a role with direct influence over the buying process.` },
      { label: 'Reachability', value: Math.max(72, selectedLead.score - 5), detail: `Verified contact paths are available through ${selectedLead.channels.toLowerCase()}.` },
      { label: 'Commercial intent', value: Math.max(70, selectedLead.score - 8), detail: 'Public business signals indicate active investment in customer acquisition and operations.' },
    ] as const;

    return (
      <div className="space-y-5">
        <Link href="/dashboard/leads" className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Back to leads
        </Link>

        <div className="flex flex-col gap-4 rounded-xl border border-border/60 bg-card p-5 shadow-sm sm:flex-row sm:items-start sm:justify-between sm:p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-zbooni-teal/10 text-zbooni-teal">
              <Users className="h-6 w-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-2xl font-extrabold tracking-tight text-white">{selectedLead.contactName}</h2>
                <span className="rounded-full bg-zbooni-green/15 px-2.5 py-1 text-[11px] font-bold text-zbooni-green">Qualified</span>
              </div>
              <p className="mt-1 text-sm text-white/65">{selectedLead.role} at {selectedLead.company}</p>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-white/50">
                <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{selectedLead.location}</span>
                <span className="inline-flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />{selectedLead.email}</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => enrichLead(selectedLead.id)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-zbooni-teal px-4 text-sm font-bold text-black transition-colors hover:bg-zbooni-teal/90"
          >
            {enrichedLeadIds.has(selectedLead.id) ? <CheckCircle2 className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
            {enrichedLeadIds.has(selectedLead.id) ? 'Enriched' : 'Enrich lead'}
          </button>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <DemoCard>
            <DemoSectionHeading icon={Sparkles} title="AI score and reasoning" subtitle="Evidence-backed qualification for operator review." />
            <div className="flex flex-col gap-5 rounded-xl border border-zbooni-green/20 bg-zbooni-green/[0.045] p-5 sm:flex-row sm:items-center">
              <div className="flex h-24 w-24 shrink-0 flex-col items-center justify-center rounded-full border-4 border-zbooni-green/35 bg-black/20">
                <span className="text-3xl font-black text-white">{selectedLead.score}</span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-zbooni-green">High fit</span>
              </div>
              <div>
                <p className="text-base font-bold text-white">Strong match for immediate review</p>
                <p className="mt-2 text-sm leading-6 text-white/65">
                  {selectedLead.company} combines a strong ICP match, an identifiable decision maker, and credible contact paths. The account is well suited to a consultative sales motion.
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {scoreFactors.map((factor) => (
                <div key={factor.label} className="rounded-lg border border-white/[0.08] bg-black/[0.12] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-bold text-white">{factor.label}</p>
                    <span className="text-sm font-extrabold text-zbooni-green">{factor.value}</span>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                    <div className="h-full rounded-full bg-zbooni-green" style={{ width: `${factor.value}%` }} />
                  </div>
                  <p className="mt-3 text-xs leading-5 text-white/55">{factor.detail}</p>
                </div>
              ))}
            </div>
          </DemoCard>

          <div className="space-y-5">
            <DemoCard>
              <DemoSectionHeading icon={Building2} title="Business profile" subtitle="Enriched account context." />
              <dl className="space-y-4 text-sm">
                {[
                  ['Company', selectedLead.company],
                  ['Segment', selectedLead.segment],
                  ['Location', selectedLead.location],
                  ['Contact channels', selectedLead.channels],
                  ['Lead status', selectedLead.status],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-start justify-between gap-4 border-b border-white/[0.06] pb-3 last:border-0 last:pb-0">
                    <dt className="text-white/45">{label}</dt>
                    <dd className="text-right font-semibold text-white/80">{value}</dd>
                  </div>
                ))}
              </dl>
            </DemoCard>
            <DemoCard>
              <DemoSectionHeading icon={TrendingUp} title="Recommended next step" subtitle="AI-assisted, human-controlled workflow." />
              <p className="text-sm leading-6 text-white/65">
                Review the cited fit signals, confirm the decision-maker details, then create a personalized draft for human approval. Outbound delivery remains disabled.
              </p>
            </DemoCard>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-bold text-white">Active leads</p>
          <p className="mt-1 text-xs text-white/50">Review, enrich, and inspect AI qualification evidence.</p>
        </div>
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search leads or companies"
            className="h-10 w-full rounded-lg border border-white/[0.1] bg-white/[0.045] pl-9 pr-3 text-sm text-white outline-none transition-colors placeholder:text-white/30 focus:border-zbooni-teal/50"
          />
        </div>
      </div>
      <DemoCard>
        <DemoSectionHeading icon={BriefcaseBusiness} title="Lead pipeline" subtitle={`${visibleLeads.length} qualified leads ready for review.`} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left">
            <thead>
              <tr className="border-b border-white/[0.08] text-[10px] font-bold uppercase tracking-wider text-white/45">
                <th className="pb-3 pr-4">Name</th>
                <th className="pb-3 pr-4">Company</th>
                <th className="pb-3 pr-4">Position</th>
                <th className="pb-3 pr-4">Status</th>
                <th className="pb-3 pr-4 text-right">Score</th>
                <th className="pb-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleLeads.map((lead) => (
                <tr key={lead.id} className="group border-b border-white/[0.055] last:border-0 hover:bg-white/[0.025]">
                  <td className="py-4 pr-4">
                    <Link href={`/dashboard/leads/${lead.id}`} className="block">
                      <p className="text-sm font-bold text-white transition-colors group-hover:text-zbooni-teal">{lead.contactName}</p>
                      <p className="mt-1 text-xs text-white/45">{lead.email}</p>
                    </Link>
                  </td>
                  <td className="py-4 pr-4 text-xs font-semibold text-white/75">{lead.company}</td>
                  <td className="py-4 pr-4 text-xs text-white/60">{lead.role}</td>
                  <td className="py-4 pr-4"><span className="rounded-full bg-zbooni-green/15 px-2.5 py-1 text-[11px] font-bold text-zbooni-green">Qualified</span></td>
                  <td className="py-4 pr-4 text-right"><span className="inline-flex min-w-10 justify-center rounded-full border border-zbooni-green/20 bg-zbooni-green/[0.07] px-2.5 py-1 text-sm font-extrabold text-white">{lead.score}</span></td>
                  <td className="py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => enrichLead(lead.id)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/[0.1] bg-white/[0.04] px-2.5 text-xs font-bold text-white/65 transition-colors hover:border-zbooni-teal/30 hover:text-zbooni-teal"
                      >
                        {enrichedLeadIds.has(lead.id) ? <CheckCircle2 className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
                        {enrichedLeadIds.has(lead.id) ? 'Enriched' : 'Enrich'}
                      </button>
                      <Link href={`/dashboard/leads/${lead.id}`} className="inline-flex h-8 items-center rounded-md px-2.5 text-xs font-bold text-zbooni-teal hover:bg-zbooni-teal/10">
                        View <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visibleLeads.length === 0 ? (
            <div className="py-14 text-center">
              <Search className="mx-auto h-5 w-5 text-white/25" />
              <p className="mt-3 text-sm font-semibold text-white/65">No matching leads</p>
              <p className="mt-1 text-xs text-white/40">Try a company, contact, role, or segment.</p>
            </div>
          ) : null}
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
