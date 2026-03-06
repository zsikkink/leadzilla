'use client';

import type { FunnelResponse } from '@lead-flood/contracts';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface FunnelChartProps {
  data: FunnelResponse;
}

const STAGES = [
  { key: 'discovered', label: 'Discovered', color: '#60A5FA', getValue: (d: FunnelResponse) => d.discoveredCount },
  { key: 'enriched', label: 'Enriched', color: '#3CC8E0', getValue: (d: FunnelResponse) => d.enrichedCount },
  { key: 'scored', label: 'Scored', color: '#FACC15', getValue: (d: FunnelResponse) => d.scoredCount },
  { key: 'messaged', label: 'Messaged', color: '#7BFF6B', getValue: (d: FunnelResponse) => d.messagesSentCount },
  { key: 'replied', label: 'Replied', color: '#C084FC', getValue: (d: FunnelResponse) => d.repliesCount },
] as const;

function CustomTooltipContent({
  active,
  payload,
}: {
  active?: boolean | undefined;
  payload?: { payload: { label: string; count: number; rate: string; color: string } }[] | undefined;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const entry = payload[0]?.payload;
  if (!entry) return null;

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
      <p style={{ fontSize: '13px', fontWeight: 600, color: entry.color, marginBottom: '4px' }}>
        {entry.label}
      </p>
      <p style={{ fontSize: '14px', fontWeight: 700, color: 'hsl(0 0% 96%)' }}>
        {entry.count.toLocaleString()}
      </p>
      {entry.rate !== '\u2014' ? (
        <p style={{ fontSize: '11px', color: 'hsl(240 5% 65%)', marginTop: '2px' }}>
          {entry.rate} from previous stage
        </p>
      ) : null}
    </div>
  );
}

export function FunnelChart({ data }: FunnelChartProps) {
  const chartData = STAGES.map((stage, i) => {
    const count = stage.getValue(data);
    const prevCount = i > 0 ? STAGES[i - 1]!.getValue(data) : 0;
    const rate = i > 0 && prevCount > 0
      ? `${Math.round((count / prevCount) * 100)}%`
      : '\u2014';

    return {
      label: stage.label,
      count,
      rate,
      color: stage.color,
    };
  });

  return (
    <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
      <div className="mb-5">
        <h2 className="text-base font-bold tracking-tight">Pipeline Funnel</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground/50">
          Aggregate conversion across pipeline stages
        </p>
      </div>
      <style>{`
        .recharts-wrapper { outline: none !important; }
        .recharts-surface { outline: none !important; }
        .recharts-surface:focus { outline: none !important; }
      `}</style>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 8% 18%)" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 11, fontWeight: 500, fill: 'hsl(240 5% 55%)' }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            tick={{ fontSize: 12, fontWeight: 600, fill: 'hsl(240 5% 75%)' }}
            axisLine={false}
            tickLine={false}
            width={90}
          />
          <Tooltip
            content={<CustomTooltipContent />}
            cursor={{ fill: 'hsl(240 8% 16%)' }}
            animationDuration={150}
          />
          <Bar dataKey="count" radius={[0, 6, 6, 0]} maxBarSize={36}>
            {chartData.map((entry) => (
              <Cell key={entry.label} fill={entry.color} fillOpacity={0.7} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {/* Stage-to-stage conversion rates */}
      <div className="mt-4 flex items-center justify-center gap-6">
        {chartData.slice(1).map((entry) => (
          <div key={entry.label} className="text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
              &rarr; {entry.label}
            </p>
            <p className="text-sm font-bold tabular-nums" style={{ color: entry.color }}>
              {entry.rate}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
