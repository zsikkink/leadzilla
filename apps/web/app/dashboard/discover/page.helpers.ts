import type {
  CreateDiscoveryRunRequest,
  DiscoveryCountryCodeContract,
  PipelineRunStatus,
} from '@lead-flood/contracts';

export const PUBLIC_DEMO_SEARCH_TASKS = 5;
export const DEFAULT_DISCOVERY_COUNTRY_CODES = ['US'] as const satisfies readonly DiscoveryCountryCodeContract[];

export function isPublicDemoSearchTaskLimit(value: number): boolean {
  return Number.isInteger(value) && value === PUBLIC_DEMO_SEARCH_TASKS;
}

export function shouldShowDiscoveryRun(
  status: PipelineRunStatus,
  _processedItems: number,
  taskLimit: number,
  _hasNotice = false,
): boolean {
  return [
    'QUEUED',
    'RUNNING',
    'SUCCEEDED',
    'FAILED',
    'PARTIAL',
    'CANCELLED',
  ].includes(status) && isPublicDemoSearchTaskLimit(taskLimit);
}

export function getNextSelectedIcpId(
  currentSelectedIcpIds: string[],
  clickedIcpId: string,
): string[] {
  if (currentSelectedIcpIds.includes(clickedIcpId)) {
    return currentSelectedIcpIds.filter((id) => id !== clickedIcpId);
  }

  return [...currentSelectedIcpIds, clickedIcpId];
}

export function getDefaultSelectedIcpIds(
  icps: readonly { id: string }[],
): string[] {
  return icps.map((icp) => icp.id);
}

export function buildDiscoveryRequest(input: {
  selectedIcpIds: string[];
  countries: DiscoveryCountryCodeContract[];
  cities: string[];
  includeWebsiteAnalysis: boolean;
  includeSocialMediaAnalysis: boolean;
  searchTaskLimit: number;
  requestedByUserId?: string | undefined;
}): CreateDiscoveryRunRequest | null {
  if (
    input.selectedIcpIds.length === 0 ||
    input.countries.length === 0 ||
    !isPublicDemoSearchTaskLimit(input.searchTaskLimit)
  ) {
    return null;
  }

  return {
    icpProfileIds: input.selectedIcpIds,
    countries: input.countries,
    ...(input.cities.length > 0 ? { cities: input.cities } : {}),
    includeWebsiteAnalysis: input.includeWebsiteAnalysis,
    includeSocialMediaAnalysis: input.includeSocialMediaAnalysis,
    limit: input.searchTaskLimit,
    ...(input.requestedByUserId ? { requestedByUserId: input.requestedByUserId } : {}),
  };
}
