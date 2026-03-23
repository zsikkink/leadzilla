'use client';

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
import { TrendingUp } from 'lucide-react';

import { getSupabaseBrowserClient } from '../lib/supabase-client.js';

// ── Types ────────────────────────────────────────────────────
interface TimeSeriesRow {
  date: string;
  discovered: number;
  scored: number;
  messaged: number;
}

interface PipelineTimeSeriesChartProps {
  icpProfileId?: string | undefined;
}

// ── Supabase query helpers ───────────────────────────────────

/**
 * Fetches lead counts grouped by creation date.
 * When icpProfileId is provided, joins through business_conversions to filter.
 */
async function fetchTimeSeriesData(
  icpProfileId?: string | undefined,
): Promise<TimeSeriesRow[]> {
  const supabase = getSupabaseBrowserClient();

  // Query leads grouped by date, using Lead table (PascalCase in Supabase)
  // We'll get all non-deleted leads and group by date
  let leadsQuery = supabase
    .from('Lead')
    .select('id, status, createdAt')
    .is('deletedAt', null);

  // When ICP filter is set, get lead IDs from business_conversions first
  let filteredLeadIds: string[] | null = null;
  if (icpProfileId) {
    const { data: conversions } = await supabase
      .from('business_conversions')
      .select('leadId')
      .eq('icpProfileId', icpProfileId);

    if (conversions && conversions.length > 0) {
      filteredLeadIds = conversions.map((c: { leadId: string }) => c.leadId);
      leadsQuery = leadsQuery.in('id', filteredLeadIds);
    } else {
      // No leads for this ICP
      return [];
    }
  }

  const { data: leads, error } = await leadsQuery;

  if (error || !leads) {
    console.error('Failed to fetch leads for time series:', error);
    return [];
  }

  // Also fetch score predictions for "scored" counts
  let predictionsQuery = supabase
    .from('LeadScorePrediction')
    .select('leadId, predictedAt');

  if (icpProfileId) {
    predictionsQuery = predictionsQuery.eq('icpProfileId', icpProfileId);
  }

  const { data: predictions } = await predictionsQuery;

  // Also fetch message sends for "messaged" counts
  let sendsQuery = supabase
    .from('MessageSend')
    .select('id, sentAt')
    .in('status', ['SENT', 'DELIVERED', 'REPLIED']);

  // For ICP filtering on sends, we'd need to join through MessageDraft
  // but Supabase doesn't support multi-level joins well.
  // Instead, if ICP-filtered, use the lead IDs we already have.
  if (icpProfileId && filteredLeadIds && filteredLeadIds.length > 0) {
    // Get drafts for these leads
    const { data: drafts } = await supabase
      .from('MessageDraft')
      .select('id')
      .in('leadId', filteredLeadIds);

    if (drafts && drafts.length > 0) {
      const draftIds = drafts.map((d: { id: string }) => d.id);
      sendsQuery = sendsQuery.in('messageDraftId', draftIds);
    } else {
      // No drafts means no sends
      sendsQuery = sendsQuery.eq('id', 'IMPOSSIBLE_ID_NO_MATCH');
    }
  }

  const { data: sends } = await sendsQuery;

  // Group by date
  const dateMap = new Map<string, { discovered: number; scored: number; messaged: number }>();

  for (const lead of leads) {
    const date = new Date(lead.createdAt).toISOString().slice(0, 10);
    const entry = dateMap.get(date) ?? { discovered: 0, scored: 0, messaged: 0 };
    entry.discovered += 1;
    dateMap.set(date, entry);
  }

  for (const pred of predictions ?? []) {
    const date = new Date(pred.predictedAt).toISOString().slice(0, 10);
    const entry = dateMap.get(date) ?? { discovered: 0, scored: 0, messaged: 0 };
    entry.scored += 1;
    dateMap.set(date, entry);
  }

  for (const send of sends ?? []) {
    if (!send.sentAt) continue;
    const date = new Date(send.sentAt).toISOString().slice(0, 10);
    const entry = dateMap.get(date) ?? { discovered: 0, scored: 0, messaged: 0 };
    entry.messaged += 1;
    dateMap.set(date, entry);
  }

  // Convert to sorted array
  return Array.from(dateMap.entries())
    .map(([date, counts]) => ({ date, ...counts }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ── Tooltip ──────────────────────────────────────────────────

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean | undefined;
  payload?: { name: string; value: number; color: string }[] | undefined;
  label?: string | undefined;
}) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div
      style={{
        backgroundColor: 'hsl(240 15% 12%)',
        border: '1px solid hsl(240 8% 22%)',
        borderRadius: '0.75rem',
        padding: '10px 14px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      }}
    >
      <p style={{ fontSize: '12px', fontWeight: 600, color: 'hsl(240 5% 65%)', marginBottom: '6px' }}>
        {label}
      </p>
      {payload.map((entry) => (
        <p key={entry.name} style={{ fontSize: '13px', fontWeight: 600, color: entry.color }}>
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  );
}

// ── Component ────────────────────────────────────────────────

export function PipelineTimeSeriesChart({ icpProfileId }: PipelineTimeSeriesChartProps) {
  const [data, setData] = useState<TimeSeriesRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    fetchTimeSeriesData(icpProfileId)
      .then((rows) => {
        if (!cancelled) {
          setData(rows);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        console.error('Time series fetch error:', err);
        if (!cancelled) {
          setData([]);
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [icpProfileId]);

  const totals = useMemo(() => {
    return data.reduce(
      (acc, row) => ({
        discovered: acc.discovered + row.discovered,
        scored: acc.scored + row.scored,
        messaged: acc.messaged + row.messaged,
      }),
      { discovered: 0, scored: 0, messaged: 0 },
    );
  }, [data]);

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-zbooni-teal" />
          <h2 className="text-base font-bold tracking-tight">Pipeline Activity Over Time</h2>
        </div>
        <div className="mt-6 flex items-center justify-center py-12">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
          <span className="ml-2 text-sm text-muted-foreground">Loading chart data...</span>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-zbooni-teal" />
          <h2 className="text-base font-bold tracking-tight">Pipeline Activity Over Time</h2>
        </div>
        <div className="mt-6 flex flex-col items-center py-8 text-center">
          <TrendingUp className="h-8 w-8 text-muted-foreground/20" />
          <p className="mt-3 text-sm text-muted-foreground/50">No pipeline activity data yet</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-zbooni-teal" />
          <h2 className="text-base font-bold tracking-tight">Pipeline Activity Over Time</h2>
        </div>
        <div className="flex items-center gap-4 text-[11px] text-muted-foreground/50">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-blue-400" />
            Discovered ({totals.discovered})
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-yellow-400" />
            Scored ({totals.scored})
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: '#7BFF6B' }} />
            Messaged ({totals.messaged})
          </span>
        </div>
      </div>
      <p className="mb-4 text-[11px] text-muted-foreground/40">
        Daily lead pipeline throughput{icpProfileId ? ' (filtered by ICP)' : ''}
      </p>
      <style>{`
        .recharts-wrapper { outline: none !important; }
        .recharts-surface { outline: none !important; }
        .recharts-surface:focus { outline: none !important; }
      `}</style>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
          <defs>
            <linearGradient id="colorDiscovered" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#60A5FA" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#60A5FA" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="colorScored" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#FACC15" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#FACC15" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="colorMessaged" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#7BFF6B" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#7BFF6B" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 8% 18%)" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fontWeight: 500, fill: 'hsl(240 5% 55%)' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: string) => {
              const d = new Date(v + 'T00:00:00');
              return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            }}
          />
          <YAxis
            tick={{ fontSize: 10, fontWeight: 500, fill: 'hsl(240 5% 55%)' }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip content={<ChartTooltip />} />
          <Area
            type="monotone"
            dataKey="discovered"
            name="Discovered"
            stroke="#60A5FA"
            strokeWidth={2}
            fill="url(#colorDiscovered)"
          />
          <Area
            type="monotone"
            dataKey="scored"
            name="Scored"
            stroke="#FACC15"
            strokeWidth={2}
            fill="url(#colorScored)"
          />
          <Area
            type="monotone"
            dataKey="messaged"
            name="Messaged"
            stroke="#7BFF6B"
            strokeWidth={2}
            fill="url(#colorMessaged)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
