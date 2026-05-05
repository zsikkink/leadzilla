import type {
  CreateDiscoveryRunRequest,
  DiscoveryCountryCodeContract,
} from '@lead-flood/contracts';

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
  if (input.selectedIcpIds.length === 0 || input.countries.length === 0) {
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
