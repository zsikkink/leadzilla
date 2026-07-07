export const QUALIFIED_LEAD_STATUSES = ['qualified', 'drafted', 'messaged', 'replied', 'cold'] as const;

export const ENRICHED_LEAD_STATUSES = [
  'enriched',
  'scored',
  'qualified',
  'drafted',
  'messaged',
  'replied',
  'cold',
] as const;

export const SCORED_LEAD_STATUSES = ['scored', 'qualified', 'drafted', 'messaged', 'replied', 'cold'] as const;

export const MESSAGED_LEAD_STATUSES = ['messaged', 'replied', 'cold'] as const;

export const SENT_MESSAGE_STATUSES = ['SENT', 'DELIVERED', 'REPLIED'] as const;

export type LeadMetricStatus =
  | (typeof QUALIFIED_LEAD_STATUSES)[number]
  | (typeof ENRICHED_LEAD_STATUSES)[number]
  | (typeof SCORED_LEAD_STATUSES)[number]
  | (typeof MESSAGED_LEAD_STATUSES)[number];

export interface LeadStatusCountRow {
  status: string;
  count: number;
}

export function sumLeadStatusCounts(
  rows: readonly LeadStatusCountRow[],
  statuses: readonly string[],
): number {
  const statusSet = new Set(statuses);
  return rows.reduce((total, row) => (
    statusSet.has(row.status) && Number.isFinite(row.count) && row.count > 0
      ? total + Math.floor(row.count)
      : total
  ), 0);
}

export function sumAllLeadStatusCounts(rows: readonly LeadStatusCountRow[]): number {
  return rows.reduce((total, row) => (
    Number.isFinite(row.count) && row.count > 0 ? total + Math.floor(row.count) : total
  ), 0);
}
