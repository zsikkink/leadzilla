import type { LucideIcon } from 'lucide-react';
import {
  BellRing,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Gauge,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
  UserRoundCheck,
} from 'lucide-react';

import {
  DEMO_SETTINGS_SNAPSHOT,
  type DemoSettingsSectionId,
} from '../lib/demo-settings-snapshot.js';

const SECTION_ICONS: Record<DemoSettingsSectionId, LucideIcon> = {
  'outreach-schedule': CalendarDays,
  'review-routing': UserRoundCheck,
  'contact-safety': ShieldCheck,
  'discovery-scoring': Gauge,
};

function SettingsSection({ sectionId }: { sectionId: DemoSettingsSectionId }) {
  const section = DEMO_SETTINGS_SNAPSHOT.sections.find(({ id }) => id === sectionId);

  if (!section) {
    return null;
  }

  const Icon = SECTION_ICONS[section.id];

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4 shadow-lg shadow-black/10 sm:p-5">
      <div className="flex items-start gap-3 border-b border-white/[0.07] pb-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zbooni-teal/20 bg-zbooni-teal/[0.08]">
          <Icon className="h-4 w-4 text-zbooni-teal" />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-bold tracking-tight text-white">{section.title}</h3>
          <p className="mt-1 text-xs leading-5 text-white/55">{section.description}</p>
        </div>
      </div>

      <dl className="divide-y divide-white/[0.06]">
        {section.items.map((item) => (
          <div key={item.label} className="grid gap-1 py-3.5 sm:grid-cols-[minmax(0,1fr)_minmax(150px,auto)] sm:gap-4">
            <div className="min-w-0">
              <dt className="text-sm font-semibold text-white/85">{item.label}</dt>
              <dd className="mt-1 text-xs leading-5 text-white/50">{item.detail}</dd>
            </div>
            <dd className="text-sm font-bold text-zbooni-teal sm:text-right">{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function DemoSettingsShowcase() {
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5">
      <section className="relative overflow-hidden rounded-2xl border border-white/[0.09] bg-gradient-to-br from-white/[0.06] via-white/[0.035] to-zbooni-teal/[0.04] p-4 shadow-xl shadow-black/15 sm:p-6">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-zbooni-teal/50 to-transparent" />
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-zbooni-teal">
              <BellRing className="h-4 w-4" />
              <p className="text-[11px] font-bold uppercase tracking-[0.16em]">Workspace operating policy</p>
            </div>
            <h2 className="mt-3 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
              Outreach defaults your team can rely on
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">
              Company-wide timing, review, safety, and scoring policies. ICP-specific targeting and qualification signals remain with each profile.
            </p>
          </div>
          <div className="inline-flex w-fit items-center gap-2 whitespace-nowrap rounded-full border border-white/[0.1] bg-black/15 px-3 py-1.5 text-xs font-semibold text-white/70">
            <LockKeyhole className="h-3.5 w-3.5 text-zbooni-green" />
            Demo configuration · Read only
          </div>
        </div>

        <dl className="mt-6 grid gap-px overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.08] sm:grid-cols-2 xl:grid-cols-4">
          {DEMO_SETTINGS_SNAPSHOT.summary.map((item) => (
            <div key={item.label} className="bg-[#15151d] p-4">
              <dt className="text-[10px] font-bold uppercase tracking-wider text-white/40">{item.label}</dt>
              <dd className="mt-2 text-base font-extrabold tracking-tight text-white">{item.value}</dd>
              <p className="mt-1.5 text-xs leading-5 text-white/50">{item.detail}</p>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-2xl border border-zbooni-teal/20 bg-zbooni-teal/[0.045] p-4 shadow-lg shadow-black/10 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zbooni-teal/20 bg-zbooni-teal/[0.08]">
            <RotateCcw className="h-4 w-4 text-zbooni-teal" />
          </div>
          <div>
            <h3 className="text-base font-bold tracking-tight text-white">Follow-up sequence</h3>
            <p className="mt-1 text-xs leading-5 text-white/55">
              Three considered follow-ups after the approved first touch, spaced across two weeks.
            </p>
          </div>
        </div>

        <ol className="mt-4 grid gap-3 md:grid-cols-3">
          {DEMO_SETTINGS_SNAPSHOT.followUps.map((step, index) => (
            <li key={step.label} className="rounded-xl border border-white/[0.08] bg-black/15 p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-zbooni-teal/15 text-xs font-extrabold text-zbooni-teal">
                  {index + 1}
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-white/75">
                  <Clock3 className="h-3.5 w-3.5 text-zbooni-green" />
                  {step.timing}
                </span>
              </div>
              <p className="mt-3 text-sm font-bold text-white">{step.label}</p>
              <p className="mt-1.5 text-xs leading-5 text-white/50">{step.purpose}</p>
            </li>
          ))}
        </ol>

        <div className="mt-4 border-t border-white/[0.07] pt-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-white/40">Sequence stops automatically when</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {DEMO_SETTINGS_SNAPSHOT.stopConditions.map((condition) => (
              <span key={condition} className="inline-flex items-center gap-1.5 rounded-full border border-zbooni-green/15 bg-zbooni-green/[0.06] px-2.5 py-1 text-xs font-semibold text-white/70">
                <CheckCircle2 className="h-3.5 w-3.5 text-zbooni-green" />
                {condition}
              </span>
            ))}
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {DEMO_SETTINGS_SNAPSHOT.sections.map((section) => (
          <SettingsSection key={section.id} sectionId={section.id} />
        ))}
      </div>
    </div>
  );
}
