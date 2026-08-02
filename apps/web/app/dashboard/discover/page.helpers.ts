import type {
  CreateDiscoveryRunRequest,
  DiscoveryCountryCodeContract,
  PipelineRunStatus,
} from '@lead-flood/contracts';

export const PUBLIC_DEMO_SEARCH_TASKS = 5;

export function isPublicDemoSearchTaskLimit(value: number): boolean {
  return Number.isInteger(value) && value === PUBLIC_DEMO_SEARCH_TASKS;
}

export function shouldShowDiscoveryRun(
  status: PipelineRunStatus,
  processedItems: number,
  taskLimit: number,
  hasNotice = false,
): boolean {
  if (status === 'QUEUED' || status === 'RUNNING') {
    return true;
  }

  return status === 'SUCCEEDED'
    && processedItems > 0
    && taskLimit <= PUBLIC_DEMO_SEARCH_TASKS
    && !hasNotice;
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
