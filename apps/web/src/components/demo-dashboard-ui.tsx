'use client';

import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import type { DemoDashboardMetric, DemoDashboardTone } from '../lib/demo-dashboard-types.js';
import { cn } from '../lib/utils.js';

const toneStyles: Record<DemoDashboardTone, { bg: string; dot: string; text: string; ring: string }> = {
  amber: {
    bg: 'from-amber-400/[0.14] to-yellow-300/[0.04]',
    dot: 'bg-amber-300',
    text: 'text-amber-200',
    ring: 'border-amber-300/25',
  },
  blue: {
    bg: 'from-sky-400/[0.14] to-blue-500/[0.04]',
    dot: 'bg-sky-300',
    text: 'text-sky-200',
    ring: 'border-sky-300/25',
  },
  green: {
    bg: 'from-zbooni-green/[0.14] to-emerald-500/[0.04]',
    dot: 'bg-zbooni-green',
    text: 'text-zbooni-green',
    ring: 'border-zbooni-green/25',
  },
  purple: {
    bg: 'from-violet-400/[0.14] to-fuchsia-500/[0.04]',
    dot: 'bg-violet-300',
    text: 'text-violet-200',
    ring: 'border-violet-300/25',
  },
  red: {
    bg: 'from-red-400/[0.14] to-rose-500/[0.04]',
    dot: 'bg-red-300',
    text: 'text-red-200',
    ring: 'border-red-300/25',
  },
  teal: {
    bg: 'from-zbooni-teal/[0.16] to-cyan-500/[0.04]',
    dot: 'bg-zbooni-teal',
    text: 'text-zbooni-teal',
    ring: 'border-zbooni-teal/25',
  },
};

export function formatDemoCount(value: number): string {
  return value.toLocaleString();
}

export function toneClass(tone: DemoDashboardTone, key: keyof (typeof toneStyles)[DemoDashboardTone]): string {
  return toneStyles[tone][key];
}

export function DemoCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.045] p-5 shadow-xl shadow-black/20',
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      {children}
    </section>
  );
}

export function DemoDashboardHeader() {
  return (
    <div className="flex min-w-0 items-start">
      <DashboardModeTabs />
    </div>
  );
}

export function DashboardModeTabs() {
  const pathname = usePathname();
  const tabs = [
    { href: '/dashboard', label: 'Operations' },
    { href: '/dashboard/analytics', label: 'Analytics' },
  ];

  return (
    <nav aria-label="Dashboard views" className="flex min-w-0 flex-wrap gap-3">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-xl border px-5 py-3 text-3xl font-extrabold leading-tight tracking-normal shadow-lg shadow-black/15 transition-colors sm:text-4xl',
              active
                ? 'border-white/[0.18] bg-white/[0.14] text-white'
                : 'border-white/[0.08] bg-white/[0.035] text-white/45 hover:border-white/[0.16] hover:bg-white/[0.08] hover:text-white/75',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function DemoSectionHeading({
  icon: Icon,
  title,
  subtitle,
  action,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string | undefined;
  action?: ReactNode | undefined;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.06]">
          <Icon className="h-4 w-4 text-zbooni-teal" />
        </div>
        <div className="min-w-0">
          <h3 className="text-lg font-bold tracking-tight text-white">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-sm text-white/70">{subtitle}</p> : null}
        </div>
      </div>
      {action ?? null}
    </div>
  );
}

export function DemoMetricGrid({ metrics }: { metrics: DemoDashboardMetric[] }) {
  const desktopColumns =
    metrics.length >= 5 ? 'xl:grid-cols-3 2xl:grid-cols-5' : 'xl:grid-cols-4';

  return (
    <div className={cn('grid gap-4 lg:grid-cols-2', desktopColumns)}>
      {metrics.map((metric) => (
        <DemoMetricCard key={metric.id} metric={metric} />
      ))}
    </div>
  );
}

export function DemoMetricCard({ metric }: { metric: DemoDashboardMetric }) {
  return (
    <div
      className={cn(
        'flex h-full min-h-[150px] flex-col rounded-lg border bg-gradient-to-br p-4 shadow-lg shadow-black/15 2xl:p-5',
        toneClass(metric.tone, 'bg'),
        toneClass(metric.tone, 'ring'),
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn('h-2 w-2 rounded-full', toneClass(metric.tone, 'dot'))} />
        <p className="text-[11px] font-bold uppercase tracking-wider text-white/70">{metric.label}</p>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <p className="text-3xl font-extrabold tracking-tight text-white">{metric.value}</p>
        {metric.unit ? <p className="text-xs font-bold uppercase tracking-wide text-white/50">{metric.unit}</p> : null}
      </div>
      <p className="mt-2 text-xs leading-5 text-white/72">{metric.detail}</p>
    </div>
  );
}

export function DemoProgressBar({
  value,
  max,
  tone = 'teal',
}: {
  value: number;
  max: number;
  tone?: DemoDashboardTone | undefined;
}) {
  const width = max > 0 ? Math.min(Math.max((value / max) * 100, value > 0 ? 5 : 0), 100) : 0;

  return (
    <div className="h-2 overflow-hidden rounded-full bg-white/[0.07]">
      <div className={cn('h-full rounded-full', toneClass(tone, 'dot'))} style={{ width: `${width}%` }} />
    </div>
  );
}

export function DemoLoadingState({ label = 'Loading dashboard snapshot...' }: { label?: string | undefined }) {
  return (
    <DemoCard>
      <div className="flex min-h-[260px] items-center justify-center text-sm font-semibold text-white/75">
        {label}
      </div>
    </DemoCard>
  );
}

export function DemoErrorState({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) {
  return (
    <DemoCard className="border-red-400/30 bg-red-500/10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-semibold text-white">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg border border-white/[0.1] bg-white/[0.08] px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-white/[0.12]"
        >
          Retry
        </button>
      </div>
    </DemoCard>
  );
}
