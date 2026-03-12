'use client';

import { PipelineTimeSeriesChart } from './pipeline-time-series-chart.js';

/**
 * FunnelChart now renders a time-series area chart showing daily pipeline trends.
 * The old aggregate horizontal bar chart has been replaced with daily bucketed lines
 * for: Discovered, Qualified, Rejected, Messaged, Replied.
 *
 * The `data` prop (FunnelResponse) is still accepted for backwards compatibility
 * but the chart fetches its own daily data from Supabase directly.
 */
export function FunnelChart() {
  return <PipelineTimeSeriesChart />;
}
