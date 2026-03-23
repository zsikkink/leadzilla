'use client';

import type { ListLeadsQuery } from '@lead-flood/contracts';
import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { useAuth } from '@/hooks/use-auth.js';
import type { ApiClient } from '@/lib/api-client.js';

// ── Types ──────────────────────────────────────────────────────────────────
type DateRange = '7d' | '30d' | '90d' | 'all';

interface DailyBucket {
  date: string;
  Discovered: number;
  Qualified: number;
  Rejected: number;
  Messaged: number;
  Replied: number;
}

interface LeadRow {
  createdAt: string;
  status: string;
}

function buildLeadListQuery(range: DateRange, page: number): ListLeadsQuery {
  const startDate = getStartDate(range);

  return {
    page,
    pageSize: 100,
    includeRejected: true,
    includeQualityMetrics: false,
    ...(startDate ? { from: startDate.toISOString() } : {}),
  };
}

async function fetchLeadRows(
  apiClient: Pick<ApiClient, 'listLeads'>,
  range: DateRange,
): Promise<LeadRow[]> {
  const rows: LeadRow[] = [];
  let page = 1;
  let total = 0;

  do {
    const response = await apiClient.listLeads(buildLeadListQuery(range, page));

    rows.push(
      ...response.items.map((item) => ({
        createdAt: item.createdAt,
        status: item.status,
      })),
    );

    total = response.total;

    if (response.items.length < response.pageSize) {
      break;
    }

    page += 1;
  } while (rows.length < total);

  return rows;
}

// ── Chart line config ──────────────────────────────────────────────────────

// Premium palette — each color chosen for WCAG contrast on dark backgrounds
// and visual distinction from its neighbors on screen.
const LINES = [
  { key: 'Discovered', color: '#60A5FA', label: 'Discovered' },   // blue-400
  { key: 'Qualified', color: '#3CC8E0', label: 'Qualified' },     // teal (zbooni-teal)
  { key: 'Rejected', color: '#F87171', label: 'Rejected' },       // red-400
  { key: 'Messaged', color: '#7BFF6B', label: 'Messaged' },       // zbooni-green
  { key: 'Replied', color: '#C084FC', label: 'Replied' },         // purple-400
] as const;

// ── Date range helpers ─────────────────────────────────────────────────────
function getStartDate(range: DateRange): Date | null {
  if (range === 'all') return null;
  const now = new Date();
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatLabel(dateStr: string, range: DateRange): string {
  const d = new Date(dateStr + 'T00:00:00');
  if (range === '7d') {
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Statuses that count as "qualified or later" (passed the quality gate)
const QUALIFIED_OR_LATER = new Set([
  'qualified',
  'drafted',
  'messaged',
  'replied',
  'cold',
]);

const MESSAGED_OR_LATER = new Set(['messaged', 'replied', 'cold']);
const REPLIED_OR_LATER = new Set(['replied']);

// ── Bucketing ──────────────────────────────────────────────────────────────
function bucketByDay(rows: LeadRow[], range: DateRange): DailyBucket[] {
  const startDate = getStartDate(range);
  const buckets = new Map<string, DailyBucket>();

  // Pre-fill every day in the range so we get continuous lines
  const end = new Date();
  const start = startDate ?? (rows.length > 0 ? new Date(rows[rows.length - 1]!.createdAt) : end);
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);

  while (cursor <= end) {
    const key = toDateKey(cursor);
    buckets.set(key, { date: key, Discovered: 0, Qualified: 0, Rejected: 0, Messaged: 0, Replied: 0 });
    cursor.setDate(cursor.getDate() + 1);
  }

  for (const row of rows) {
    const day = toDateKey(new Date(row.createdAt));
    let bucket = buckets.get(day);
    if (!bucket) {
      bucket = { date: day, Discovered: 0, Qualified: 0, Rejected: 0, Messaged: 0, Replied: 0 };
      buckets.set(day, bucket);
    }

    // Every lead counts as "discovered" on its creation date
    bucket.Discovered += 1;

    const s = row.status;
    if (QUALIFIED_OR_LATER.has(s)) bucket.Qualified += 1;
    if (s === 'rejected') bucket.Rejected += 1;
    if (MESSAGED_OR_LATER.has(s)) bucket.Messaged += 1;
    if (REPLIED_OR_LATER.has(s)) bucket.Replied += 1;
  }

  return Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
}

// ── Custom tooltip ─────────────────────────────────────────────────────────
interface TooltipEntry {
  name: string;
  value: number;
  color: string;
}

function GlassTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean | undefined;
  payload?: TooltipEntry[] | undefined;
  label?: string | undefined;
}) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div
      style={{
        background: 'rgba(28, 28, 46, 0.85)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(60, 200, 224, 0.25)',
        borderRadius: '12px',
        padding: '12px 16px',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255,255,255,0.05)',
      }}
    >
      <p style={{ fontSize: '12px', fontWeight: 600, color: 'rgba(255,255,255,0.6)', marginBottom: '8px' }}>
        {label}
      </p>
      {payload.map((entry) => (
        <div key={entry.name} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: entry.color,
              boxShadow: `0 0 6px ${entry.color}60`,
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', minWidth: '70px' }}>
            {entry.name}
          </span>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#fff' }}>
            {entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export function PipelineTimeSeriesChart() {
  const { apiClient, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [range, setRange] = useState<DateRange>('30d');
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (isAuthLoading) {
      return () => {
        cancelled = true;
      };
    }

    if (!isAuthenticated) {
      setRows([]);
      setError(null);
      setIsLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setIsLoading(true);
    setError(null);

    async function fetchLeads() {
      try {
        const data = await fetchLeadRows(apiClient, range);
        if (cancelled) return;

        setRows(data);
        setIsLoading(false);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load chart data');
          setIsLoading(false);
        }
      }
    }

    void fetchLeads();
    return () => {
      cancelled = true;
    };
  }, [apiClient, isAuthenticated, isAuthLoading, range]);

  const chartData = useMemo(() => bucketByDay(rows, range), [rows, range]);

  const rangeButtons: { value: DateRange; label: string }[] = [
    { value: '7d', label: '7d' },
    { value: '30d', label: '30d' },
    { value: '90d', label: '90d' },
    { value: 'all', label: 'All' },
  ];

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-white/[0.08] p-6 shadow-xl"
      style={{
        background: 'linear-gradient(135deg, rgba(28,28,46,0.7) 0%, rgba(37,37,64,0.5) 50%, rgba(28,28,46,0.7) 100%)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        boxShadow: '0 8px 40px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)',
      }}
    >
      {/* Glass shimmer overlay */}
      <div
        className="pointer-events-none absolute inset-0 rounded-2xl"
        style={{
          background: 'linear-gradient(135deg, rgba(60,200,224,0.04) 0%, transparent 40%, rgba(123,255,107,0.03) 100%)',
        }}
      />

      {/* Header */}
      <div className="relative z-10 mb-5 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold tracking-tight text-white">Pipeline Trends</h2>
            <span className="rounded-full border border-yellow-300/20 bg-yellow-300/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-yellow-200">
              Directional
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-white/40">
            Bucketed from lead creation dates and current status, not canonical event timestamps.
          </p>
        </div>

        {/* Date range selector */}
        <div className="flex gap-1 rounded-lg border border-white/[0.08] bg-white/[0.04] p-0.5">
          {rangeButtons.map((btn) => (
            <button
              key={btn.value}
              onClick={() => setRange(btn.value)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
                range === btn.value
                  ? 'bg-gradient-to-r from-[#3CC8E0]/30 to-[#7BFF6B]/20 text-white shadow-sm shadow-[#3CC8E0]/20'
                  : 'text-white/50 hover:text-white/80 hover:bg-white/[0.06]'
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="relative z-10 mb-4 flex flex-wrap gap-4">
        {LINES.map((line) => (
          <div key={line.key} className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full"
              style={{
                background: line.color,
                boxShadow: `0 0 8px ${line.color}50`,
              }}
            />
            <span className="text-[11px] font-medium text-white/60">{line.label}</span>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="relative z-10">
        {isLoading ? (
          <div className="flex h-[320px] items-center justify-center">
            <div className="flex items-center gap-2 text-sm text-white/40">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-[#3CC8E0]" />
              Loading chart data...
            </div>
          </div>
        ) : error ? (
          <div className="flex h-[320px] items-center justify-center">
            <p className="text-sm text-red-400/80">{error}</p>
          </div>
        ) : (
          <>
            <style>{`
              .recharts-wrapper { outline: none !important; }
              .recharts-surface { outline: none !important; }
              .recharts-surface:focus { outline: none !important; }
            `}</style>
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  {LINES.map((line) => (
                    <linearGradient key={line.key} id={`gradient-${line.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={line.color} stopOpacity={0.35} />
                      <stop offset="60%" stopColor={line.color} stopOpacity={0.08} />
                      <stop offset="100%" stopColor={line.color} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>

                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.04)"
                  vertical={false}
                />

                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fontWeight: 500, fill: 'rgba(255,255,255,0.35)' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(val: string) => formatLabel(val, range)}
                  interval="preserveStartEnd"
                  minTickGap={40}
                />

                <YAxis
                  tick={{ fontSize: 10, fontWeight: 500, fill: 'rgba(255,255,255,0.35)' }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                  width={35}
                />

                <Tooltip
                  content={<GlassTooltip />}
                  cursor={{
                    stroke: 'rgba(60,200,224,0.2)',
                    strokeWidth: 1,
                    strokeDasharray: '4 4',
                  }}
                />

                {LINES.map((line) => (
                  <Area
                    key={line.key}
                    type="monotone"
                    dataKey={line.key}
                    stroke={line.color}
                    strokeWidth={2.5}
                    fill={`url(#gradient-${line.key})`}
                    fillOpacity={1}
                    dot={false}
                    activeDot={{
                      r: 5,
                      strokeWidth: 2,
                      stroke: line.color,
                      fill: '#1C1C2E',
                      style: {
                        filter: `drop-shadow(0 0 6px ${line.color}80)`,
                      },
                    }}
                    isAnimationActive={true}
                    animationBegin={0}
                    animationDuration={1500}
                    animationEasing="ease-out"
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </>
        )}
      </div>

      {/* Summary row — total counts for current range */}
      {!isLoading && !error && chartData.length > 0 ? (
        <div className="relative z-10 mt-4 grid grid-cols-5 gap-3">
          {LINES.map((line) => {
            const total = chartData.reduce((sum, d) => sum + (d[line.key as keyof DailyBucket] as number), 0);
            return (
              <div
                key={line.key}
                className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-center transition-all duration-200 hover:bg-white/[0.06]"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">{line.label}</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums" style={{ color: line.color }}>
                  {total.toLocaleString()}
                </p>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
