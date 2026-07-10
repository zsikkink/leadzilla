import type { LeadFlowSankeyData } from '../components/lead-flow-sankey.js';

export type DemoDashboardTone = 'amber' | 'blue' | 'green' | 'purple' | 'red' | 'teal';

export type DemoDashboardHeadline = {
  title: string;
  eyebrow: string;
  summary: string;
  status: string;
};

export type DemoDashboardMetric = {
  id: string;
  label: string;
  value: string;
  unit?: string | undefined;
  detail: string;
  tone: DemoDashboardTone;
};

export type DemoOperationsPipelineStage = {
  id: string;
  label: string;
  count: number;
  displayValue: string;
  caption: string;
  status: string;
  health: 'attention' | 'healthy';
};

export type DemoOperationsQueueItem = {
  id: string;
  label: string;
  value: string;
  detail: string;
};

export type DemoOperationsHealthItem = {
  id: string;
  label: string;
  status: string;
  detail: string;
  tone: DemoDashboardTone;
};

export type DemoOperationsRun = {
  id: string;
  title: string;
  status: string;
  found: number;
  converted: number;
  detail: string;
};

export type DemoOperationsDashboardSnapshot = {
  id: string;
  workspaceSlug: string;
  version: string;
  kind: 'operations';
  generatedAt: string;
  headline: DemoDashboardHeadline;
  metrics: DemoDashboardMetric[];
  pipeline: DemoOperationsPipelineStage[];
  queues: DemoOperationsQueueItem[];
  systemHealth: DemoOperationsHealthItem[];
  recentRuns: DemoOperationsRun[];
  safety: {
    title: string;
    status: string;
    detail: string;
  };
};

export type DemoAnalyticsScoreBand = {
  id: string;
  label: string;
  count: number;
  percent: number;
  detail: string;
  tone: DemoDashboardTone;
};

export type DemoAnalyticsIcpPerformance = {
  id: string;
  name: string;
  scored: number;
  avgScore: number;
  qualifiedRate: number;
  qualified: number;
  insight: string;
};

export type DemoAnalyticsOutcome = {
  id: string;
  label: string;
  value: string;
  detail: string;
};

export type DemoAnalyticsRecommendation = {
  id: string;
  title: string;
  detail: string;
};

export type DemoAnalyticsDisqualificationReason = {
  id: string;
  label: string;
  count: number;
  detail: string;
};

export type DemoAnalyticsDashboardSnapshot = {
  id: string;
  workspaceSlug: string;
  version: string;
  kind: 'analytics';
  generatedAt: string;
  headline: DemoDashboardHeadline;
  metrics: DemoDashboardMetric[];
  leadFlow: LeadFlowSankeyData;
  scoreBands: DemoAnalyticsScoreBand[];
  icpPerformance: DemoAnalyticsIcpPerformance[];
  outcomeSummary: DemoAnalyticsOutcome[];
  recommendations: DemoAnalyticsRecommendation[];
  disqualificationReasons?: DemoAnalyticsDisqualificationReason[] | undefined;
  safety: {
    title: string;
    detail: string;
  };
};
