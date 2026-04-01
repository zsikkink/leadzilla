import type {
  CreateDiscoveryRunRequest,
  DiscoveryCountryCodeContract,
} from '@lead-flood/contracts';

export function getNextSelectedIcpId(
  currentSelectedIcpId: string | null,
  clickedIcpId: string,
): string | null {
  return currentSelectedIcpId === clickedIcpId ? null : clickedIcpId;
}

export function buildSingleIcpDiscoveryRequest(input: {
  selectedIcpId: string | null;
  countries: DiscoveryCountryCodeContract[];
  cities: string[];
  includeWebsiteAnalysis: boolean;
  includeSocialMediaAnalysis: boolean;
  limit: number;
  requestedByUserId?: string | undefined;
}): CreateDiscoveryRunRequest | null {
  if (!input.selectedIcpId || input.countries.length === 0) {
    return null;
  }

  return {
    icpProfileIds: [input.selectedIcpId],
    countries: input.countries,
    ...(input.cities.length > 0 ? { cities: input.cities } : {}),
    includeWebsiteAnalysis: input.includeWebsiteAnalysis,
    includeSocialMediaAnalysis: input.includeSocialMediaAnalysis,
    limit: input.limit,
    ...(input.requestedByUserId ? { requestedByUserId: input.requestedByUserId } : {}),
  };
}
