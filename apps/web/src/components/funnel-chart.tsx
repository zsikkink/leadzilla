'use client';

import { PipelineTimeSeriesChart } from './pipeline-time-series-chart.js';

/**
 * FunnelChart now renders a time-series area chart showing daily pipeline trends.
 * The old aggregate horizontal bar chart has been replaced with daily bucketed lines
 * for: Discovered, Qualified, Rejected, Messaged, Replied.
 *
 * The chart keeps its own data loading, now through the existing authenticated API
 * boundary rather than a browser-direct Supabase read.
 */
export function FunnelChart() {
  return <PipelineTimeSeriesChart />;
}
