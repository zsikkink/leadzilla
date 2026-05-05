'use client';

import type {
  CountryCitiesMap,
  DiscoveryCountryCodeContract,
  IcpProfileResponse,
  PipelineRunStatus,
} from '@lead-flood/contracts';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Loader2,
  MapPin,
  Play,
  Search,
  Settings2,
  Target,
  TrendingUp,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useApiQuery } from '../../../src/hooks/use-api-query.js';
import { useAuth } from '../../../src/hooks/use-auth.js';
import {
  SupportedCountryPickerOptions,
  buildDiscoveryCountryCities,
  countryName,
  toDiscoveryCountryCode,
} from '../../../src/lib/countries.js';
import { cn } from '../../../src/lib/utils.js';
import {
  buildDiscoveryRequest,
  getNextSelectedIcpId,
} from './page.helpers.js';

const MIN_SEARCH_TASK_LIMIT = 1;
const MAX_SEARCH_TASK_LIMIT = 1000;
const SEARCH_TASK_OPTIONS = ['5', '10', '25', '50', '100', '250', '500', '1000'] as const;
const DEFAULT_DISCOVERY_COUNTRY_CODES = ['AE', 'SA', 'JO', 'EG'] as const satisfies readonly DiscoveryCountryCodeContract[];
const DEFAULT_DISCOVERY_COUNTRY_ORDER = new Map<DiscoveryCountryCodeContract, number>(
  DEFAULT_DISCOVERY_COUNTRY_CODES.map((country, index) => [country, index]),
);
type CitySelectionKey = `${DiscoveryCountryCodeContract}:${string}`;

function citySelectionKey(
  country: DiscoveryCountryCodeContract,
  city: string,
): CitySelectionKey {
  return `${country}:${city}`;
}

function compareDiscoveryCountryCodes(
  left: DiscoveryCountryCodeContract,
  right: DiscoveryCountryCodeContract,
): number {
  const leftDefaultIndex = DEFAULT_DISCOVERY_COUNTRY_ORDER.get(left);
  const rightDefaultIndex = DEFAULT_DISCOVERY_COUNTRY_ORDER.get(right);

  if (leftDefaultIndex !== undefined && rightDefaultIndex !== undefined) {
    return leftDefaultIndex - rightDefaultIndex;
  }
  if (leftDefaultIndex !== undefined) {
    return -1;
  }
  if (rightDefaultIndex !== undefined) {
    return 1;
  }

  return countryName(left).localeCompare(countryName(right));
}

function orderDiscoveryCountryCodes(
  countries: readonly DiscoveryCountryCodeContract[],
): DiscoveryCountryCodeContract[] {
  const seen = new Set<DiscoveryCountryCodeContract>();
  const result: DiscoveryCountryCodeContract[] = [];

  for (const country of countries) {
    if (seen.has(country)) {
      continue;
    }
    seen.add(country);
    result.push(country);
  }

  return result.sort(compareDiscoveryCountryCodes);
}

function dedupeCityList(cities: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const city of cities) {
    const normalized = city.trim().replace(/\s+/g, ' ');
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function countrySearchOptionValue(country: DiscoveryCountryCodeContract): string {
  return `${countryName(country)} (${country})`;
}

function getCountrySearchMatches(value: string): DiscoveryCountryCodeContract[] {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return [];
  }

  return SupportedCountryPickerOptions.map((option) => {
    const label = option.label.toLowerCase();
    const code = option.code.toLowerCase();
    const optionValue = countrySearchOptionValue(option.code).toLowerCase();
    let score: number | null = null;

    if (label.startsWith(normalized)) {
      score = 0;
    } else if (code.startsWith(normalized)) {
      score = 1;
    } else if (optionValue.startsWith(normalized)) {
      score = 2;
    } else if (label.includes(normalized)) {
      score = 3;
    }

    return { option, score };
  })
    .filter((match): match is { option: (typeof SupportedCountryPickerOptions)[number]; score: number } => match.score !== null)
    .sort((left, right) => left.score - right.score || left.option.label.localeCompare(right.option.label))
    .map((match) => match.option.code);
}

function resolveCountrySearchInput(value: string): DiscoveryCountryCodeContract | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parenthesizedCode = /\(([A-Z]{2})\)$/i.exec(trimmed)?.[1];
  if (parenthesizedCode) {
    return toDiscoveryCountryCode(parenthesizedCode);
  }

  const directMatch = toDiscoveryCountryCode(trimmed);
  if (directMatch) {
    return directMatch;
  }

  const normalized = trimmed.toLowerCase();
  return SupportedCountryPickerOptions.find(
    (option) =>
      option.label.toLowerCase() === normalized ||
      option.code.toLowerCase() === normalized ||
      countrySearchOptionValue(option.code).toLowerCase() === normalized,
  )?.code ?? null;
}

function isBrowserDatalistSelection(event: Event): boolean {
  return event instanceof InputEvent && event.inputType === 'insertReplacementText';
}

function getCitySelectionKeysForCountries(
  countryCities: Record<string, readonly string[] | undefined>,
  countries: readonly DiscoveryCountryCodeContract[],
): CitySelectionKey[] {
  const keys: CitySelectionKey[] = [];
  for (const country of countries) {
    for (const city of countryCities[country] ?? []) {
      keys.push(citySelectionKey(country, city));
    }
  }
  return keys;
}

function areAllSelectedCountryCitiesSelected(
  countryCities: Record<string, readonly string[] | undefined>,
  selectedCountries: readonly DiscoveryCountryCodeContract[],
  selectedCityKeys: ReadonlySet<CitySelectionKey>,
): boolean {
  return selectedCountries.every((country) => {
    const cities = countryCities[country] ?? [];
    return cities.length > 0 && cities.every((city) => selectedCityKeys.has(citySelectionKey(country, city)));
  });
}

function getOrderedSelectedCities(
  countryCities: Record<string, readonly string[] | undefined>,
  selectedCountries: readonly DiscoveryCountryCodeContract[],
  selectedCityKeys: ReadonlySet<CitySelectionKey>,
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const country of selectedCountries) {
    for (const city of countryCities[country] ?? []) {
      const dedupeKey = city.toLowerCase();
      if (selectedCityKeys.has(citySelectionKey(country, city)) && !seen.has(dedupeKey)) {
        seen.add(dedupeKey);
        result.push(city);
      }
    }
  }

  return result;
}

// ── Sub-components ──────────────────────────────────────

function StatusIcon({ status }: { status: PipelineRunStatus }) {
  switch (status) {
    case 'QUEUED':
      return <Loader2 className="h-5 w-5 animate-spin text-yellow-400" />;
    case 'RUNNING':
      return <Loader2 className="h-5 w-5 animate-spin text-zbooni-teal" />;
    case 'SUCCEEDED':
      return <CheckCircle2 className="h-5 w-5 text-zbooni-green" />;
    case 'FAILED':
      return <AlertCircle className="h-5 w-5 text-red-400" />;
    case 'PARTIAL':
      return <AlertCircle className="h-5 w-5 text-yellow-400" />;
  }
}

function ProgressBar({ processed, total, label }: { processed: number; total: number; label: string }) {
  const pct = total > 0 ? Math.min(Math.round((processed / total) * 100), 100) : 0;
  return (
    <div className="w-full">
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="font-medium text-muted-foreground">
          {processed} / {total} {label}
        </span>
        <span className="font-bold text-foreground">{pct}%</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-zbooni-dark/60">
        <div
          className="h-full rounded-full bg-gradient-to-r from-zbooni-green to-zbooni-teal transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}


// ── Pill selector components ──────────────────────────────

function PillOption({
  selected,
  onClick,
  children,
  className,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string | undefined;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-all duration-150',
        selected
          ? 'border-zbooni-teal/40 bg-zbooni-teal/10 text-zbooni-teal shadow-sm'
          : 'border-border/40 bg-zbooni-dark/30 text-muted-foreground hover:border-border/60 hover:bg-zbooni-dark/50 hover:text-foreground',
        className,
      )}
    >
      {children}
    </button>
  );
}

function IcpOption({
  icp,
  selected,
  onSelect,
}: {
  icp: IcpProfileResponse;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(icp.id)}
      role="checkbox"
      aria-checked={selected}
      className={cn(
        'block rounded-xl border p-3 text-left transition-all duration-150',
        selected
          ? 'border-zbooni-teal/40 bg-zbooni-teal/5 shadow-sm'
          : 'border-border/30 bg-zbooni-dark/20 hover:border-border/50 hover:bg-zbooni-dark/40',
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={cn('text-sm font-semibold', selected ? 'text-foreground' : 'text-muted-foreground')}>
            {icp.name}
          </span>
        </div>
        {icp.description ? (
          <p className="mt-0.5 text-xs text-muted-foreground/70 line-clamp-1">{icp.description}</p>
        ) : null}
        {icp.targetIndustries.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {icp.targetIndustries.slice(0, 3).map((ind) => (
              <span key={ind} className="rounded bg-zbooni-dark/60 px-1.5 py-0.5 text-[10px] text-muted-foreground/60">
                {ind}
              </span>
            ))}
            {icp.targetIndustries.length > 3 ? (
              <span className="text-[10px] text-muted-foreground/40">+{icp.targetIndustries.length - 3}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </button>
  );
}

// ── Batch grouping — runs created within 5s = one batch ──────
interface RunBatch {
  batchKey: string;
  runs: Array<{
    runId: string;
    status: PipelineRunStatus;
    icpProfileId: string | null;
    icpProfileIds?: string[] | undefined;
    countries: string[];
    limit: number;
    totalItems: number;
    processedItems: number;
    failedItems: number;
    startedAt: string | null;
    finishedAt: string | null;
    createdAt: string;
    errorMessage: string | null;
  }>;
  icpNames: string[];
  countries: string[];
  totalTaskLimit: number;
  totalItems: number;
  totalProcessed: number;
  totalFailed: number;
  overallStatus: PipelineRunStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessages: string[];
}

const STATUS_PRIORITY: Record<string, number> = {
  FAILED: 0,
  RUNNING: 1,
  QUEUED: 2,
  PARTIAL: 3,
  SUCCEEDED: 4,
};

function groupRunsIntoBatches(
  runs: RunBatch['runs'],
  icpItems: Array<{ id: string; name: string }> | undefined,
): RunBatch[] {
  if (runs.length === 0) return [];

  const sorted = [...runs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const batches: RunBatch[] = [];
  let currentBatch: RunBatch['runs'] = [sorted[0]!];

  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]!.createdAt).getTime();
    const curr = new Date(sorted[i]!.createdAt).getTime();
    if (prev - curr <= 5000) {
      currentBatch.push(sorted[i]!);
    } else {
      batches.push(buildBatch(currentBatch, icpItems));
      currentBatch = [sorted[i]!];
    }
  }
  batches.push(buildBatch(currentBatch, icpItems));
  return batches;
}

function buildBatch(
  runs: RunBatch['runs'],
  icpItems: Array<{ id: string; name: string }> | undefined,
): RunBatch {
  const icpNames = Array.from(new Set(runs.flatMap((r) => {
    const ids = r.icpProfileIds?.length
      ? r.icpProfileIds
      : (r.icpProfileId ? [r.icpProfileId] : []);
    return ids.map((id) => icpItems?.find((i) => i.id === id)?.name ?? 'ICP');
  })));
  const uniqueCountries = Array.from(new Set(runs.flatMap((r) => r.countries)));
  const overallStatus = runs.reduce<PipelineRunStatus>((worst, r) => {
    return (STATUS_PRIORITY[r.status] ?? 5) < (STATUS_PRIORITY[worst] ?? 5) ? r.status : worst;
  }, 'SUCCEEDED');
  const errors = runs.map((r) => r.errorMessage).filter((e): e is string => e !== null);
  const startedAt = runs.map((r) => r.startedAt).filter((s): s is string => s !== null).sort()[0] ?? null;
  const finishedAt = runs.every((r) => r.finishedAt) ? runs.map((r) => r.finishedAt).filter((s): s is string => s !== null).sort().reverse()[0] ?? null : null;

  return {
    batchKey: runs.map((r) => r.runId).join('-'),
    runs,
    icpNames,
    countries: uniqueCountries,
    totalTaskLimit: runs.reduce((sum, r) => sum + r.limit, 0),
    totalItems: runs.reduce((sum, r) => sum + r.totalItems, 0),
    totalProcessed: runs.reduce((sum, r) => sum + r.processedItems, 0),
    totalFailed: runs.reduce((sum, r) => sum + r.failedItems, 0),
    overallStatus,
    createdAt: runs[0]!.createdAt,
    startedAt,
    finishedAt,
    errorMessages: errors,
  };
}

function parseSearchTaskLimit(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);
  if (parsed < MIN_SEARCH_TASK_LIMIT || parsed > MAX_SEARCH_TASK_LIMIT) {
    return null;
  }

  return parsed;
}

// ── Main page ──────────────────────────────────────

export default function DiscoverPage() {
  const { apiClient, user } = useAuth();

  const [selectedIcpIds, setSelectedIcpIds] = useState<string[]>([]);
  const [selectedCountryCodes, setSelectedCountryCodes] = useState<DiscoveryCountryCodeContract[]>([]);
  const [selectedCityKeys, setSelectedCityKeys] = useState<Set<CitySelectionKey>>(new Set());
  const [expandedCountryCodes, setExpandedCountryCodes] = useState<Set<DiscoveryCountryCodeContract>>(new Set());
  const [hiddenCountryCodes, setHiddenCountryCodes] = useState<Set<DiscoveryCountryCodeContract>>(new Set());
  const [addedCountryCities, setAddedCountryCities] = useState<CountryCitiesMap>({});
  const [addCountryInput, setAddCountryInput] = useState('');
  const [countryInputResetKey, setCountryInputResetKey] = useState(0);
  const [addCountryError, setAddCountryError] = useState<string | null>(null);
  const [citySearchByCountry, setCitySearchByCountry] = useState<
    Partial<Record<DiscoveryCountryCodeContract, string>>
  >({});
  const [includeWebsiteAnalysis, setIncludeWebsiteAnalysis] = useState(true);
  const [includeSocialMediaAnalysis, setIncludeSocialMediaAnalysis] = useState(true);
  const [searchTaskLimit, setSearchTaskLimit] = useState('25');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showSearchTaskLimitError, setShowSearchTaskLimitError] = useState(false);
  const [showTargetingControls, setShowTargetingControls] = useState(false);
  const initializedDefaultIcpSelectionRef = useRef(false);
  const initializedDefaultCountrySelectionRef = useRef(false);

  const pipelineSettings = useApiQuery(
    useCallback(() => apiClient.listPipelineSettings(), [apiClient]),
  );

  const pipelineCountryCities = useMemo(() => {
    const countryCitiesSetting = pipelineSettings.data?.items.find((item) => item.key === 'countryCities');
    return buildDiscoveryCountryCities(countryCitiesSetting?.value, {
      includeCuratedDefaults: true,
    });
  }, [pipelineSettings.data]);

  const countryCities = useMemo<CountryCitiesMap>(() => {
    const merged: CountryCitiesMap = {};

    for (const [country, cities] of Object.entries(pipelineCountryCities) as Array<
      [DiscoveryCountryCodeContract, string[]]
    >) {
      merged[country] = dedupeCityList(cities);
    }

    for (const [country, cities] of Object.entries(addedCountryCities) as Array<
      [DiscoveryCountryCodeContract, string[]]
    >) {
      merged[country] = dedupeCityList([...(merged[country] ?? []), ...cities]);
    }

    return merged;
  }, [addedCountryCities, pipelineCountryCities]);

  const addedCountryCodes = useMemo<DiscoveryCountryCodeContract[]>(
    () =>
      Object.keys(addedCountryCities)
        .map((country) => toDiscoveryCountryCode(country))
        .filter((country): country is DiscoveryCountryCodeContract => country !== null),
    [addedCountryCities],
  );

  // Run tracking — multi-run via API
  const [runsRefreshKey, setRunsRefreshKey] = useState(0);
  const discoveryRuns = useApiQuery(
    useCallback(
      () => apiClient.listDiscoveryRuns({ page: 1, pageSize: 20 }),
      [apiClient, runsRefreshKey],
    ),
    [runsRefreshKey],
  );

  // Poll for runs when any are QUEUED or RUNNING
  const hasActiveRuns = discoveryRuns.data?.runs.some(
    (r) => r.status === 'QUEUED' || r.status === 'RUNNING',
  );
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!hasActiveRuns) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    pollRef.current = setInterval(() => {
      setRunsRefreshKey((k) => k + 1);
    }, 3000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [hasActiveRuns]);

  // Load ICPs
  const icps = useApiQuery(
    useCallback(() => apiClient.listIcps({ page: 1, pageSize: 50, isActive: true }), [apiClient]),
  );

  useEffect(() => {
    if (initializedDefaultIcpSelectionRef.current || !icps.data) {
      return;
    }

    initializedDefaultIcpSelectionRef.current = true;
    setSelectedIcpIds(icps.data.items.map((item) => item.id));
  }, [icps.data]);

  // Group discovery runs into batches (runs within 5s = same batch)
  const runBatches = useMemo(
    () => groupRunsIntoBatches(discoveryRuns.data?.runs ?? [], icps.data?.items),
    [discoveryRuns.data, icps.data],
  );

  const displayedCountryCodes = useMemo<DiscoveryCountryCodeContract[]>(
    () => {
      const defaultCountries = DEFAULT_DISCOVERY_COUNTRY_CODES.filter(
        (country) => (countryCities[country] ?? []).length > 0,
      );

      return orderDiscoveryCountryCodes([...defaultCountries, ...addedCountryCodes])
        .filter((country) => !hiddenCountryCodes.has(country));
    },
    [addedCountryCodes, countryCities, hiddenCountryCodes],
  );

  useEffect(() => {
    if (
      initializedDefaultCountrySelectionRef.current ||
      pipelineSettings.isLoading ||
      displayedCountryCodes.length === 0
    ) {
      return;
    }

    const displayedCountries = new Set(displayedCountryCodes);
    const defaultCountries = DEFAULT_DISCOVERY_COUNTRY_CODES.filter((country) =>
      displayedCountries.has(country),
    );
    const initialCountries = defaultCountries.length > 0
      ? defaultCountries
      : displayedCountryCodes.slice(0, 4);

    initializedDefaultCountrySelectionRef.current = true;
    setSelectedCountryCodes(initialCountries);
    setSelectedCityKeys(new Set(getCitySelectionKeysForCountries(countryCities, initialCountries)));
  }, [countryCities, displayedCountryCodes, pipelineSettings.isLoading]);

  useEffect(() => {
    setSelectedCountryCodes((prev) => {
      const displayedCountries = new Set(displayedCountryCodes);
      const filtered = prev.filter((country) => displayedCountries.has(country));
      return filtered.length !== prev.length ? filtered : prev;
    });
  }, [displayedCountryCodes]);

  const selectedCityList = useMemo(
    () => getOrderedSelectedCities(countryCities, selectedCountryCodes, selectedCityKeys),
    [countryCities, selectedCityKeys, selectedCountryCodes],
  );

  const selectedCitiesForRequest = useMemo(
    () =>
      areAllSelectedCountryCitiesSelected(countryCities, selectedCountryCodes, selectedCityKeys)
        ? []
        : selectedCityList,
    [countryCities, selectedCityKeys, selectedCityList, selectedCountryCodes],
  );

  const missingCityCountries = useMemo(
    () => selectedCountryCodes.filter((country) => (countryCities[country] ?? []).length === 0),
    [countryCities, selectedCountryCodes],
  );

  const selectedCountriesWithoutSelectedCities = useMemo(
    () =>
      selectedCountryCodes.filter((country) => {
        const cities = countryCities[country] ?? [];
        return cities.length > 0 && !cities.some((city) => selectedCityKeys.has(citySelectionKey(country, city)));
      }),
    [countryCities, selectedCityKeys, selectedCountryCodes],
  );

  // Reset city selection when country selection changes.
  useEffect(() => {
    if (selectedCountryCodes.length === 0) {
      return;
    }

    setSelectedCityKeys((prev) => {
      const citySet = new Set(getCitySelectionKeysForCountries(countryCities, selectedCountryCodes));
      const filtered = new Set(Array.from(prev).filter((cityKey) => citySet.has(cityKey)));
      return filtered.size !== prev.size ? filtered : prev;
    });
  }, [countryCities, selectedCountryCodes]);

  const toggleCountry = (country: DiscoveryCountryCodeContract) => {
    const countryCityList = countryCities[country] ?? [];
    setSubmitError(null);
    setSelectedCountryCodes((prev) => {
      if (prev.includes(country)) {
        setHiddenCountryCodes((prevHiddenCountries) => new Set(prevHiddenCountries).add(country));
        setExpandedCountryCodes((prevExpandedCountries) => {
          const next = new Set(prevExpandedCountries);
          next.delete(country);
          return next;
        });
        setCitySearchByCountry((prevSearches) => ({ ...prevSearches, [country]: '' }));
        setSelectedCityKeys((prevCities) => {
          const next = new Set(prevCities);
          for (const city of countryCityList) {
            next.delete(citySelectionKey(country, city));
          }
          return next;
        });
        return prev.filter((selectedCountry) => selectedCountry !== country);
      }

      setHiddenCountryCodes((prevHiddenCountries) => {
        const next = new Set(prevHiddenCountries);
        next.delete(country);
        return next;
      });
      setSelectedCityKeys((prevCities) => {
        const next = new Set(prevCities);
        for (const city of countryCityList) {
          next.add(citySelectionKey(country, city));
        }
        return next;
      });

      const nextCountries = new Set([...prev, country]);
      return displayedCountryCodes.filter((displayedCountry) => nextCountries.has(displayedCountry));
    });
  };

  const toggleCountryExpansion = (country: DiscoveryCountryCodeContract) => {
    setExpandedCountryCodes((prev) => {
      const next = new Set(prev);
      if (next.has(country)) {
        next.delete(country);
      } else {
        next.add(country);
      }
      return next;
    });
  };

  const selectAllCountries = () => {
    setSubmitError(null);
    setSelectedCountryCodes(displayedCountryCodes);
    setSelectedCityKeys(new Set(getCitySelectionKeysForCountries(countryCities, displayedCountryCodes)));
  };

  const clearSelectedCountries = () => {
    setSubmitError(null);
    setHiddenCountryCodes((prevHiddenCountries) => new Set([...prevHiddenCountries, ...displayedCountryCodes]));
    setExpandedCountryCodes(new Set());
    setCitySearchByCountry({});
    setSelectedCountryCodes([]);
    setSelectedCityKeys(new Set());
  };

  const addCountryToSelection = (
    inputValue = addCountryInput,
    options: {
      showInvalidError?: boolean;
      country?: DiscoveryCountryCodeContract | null;
    } = { showInvalidError: true },
  ) => {
    const country =
      options.country ?? resolveCountrySearchInput(inputValue) ?? getCountrySearchMatches(inputValue)[0] ?? null;

    if (!country) {
      if (options.showInvalidError ?? true) {
        setAddCountryError('Select a supported country.');
      }
      return false;
    }

    const cities = countryCities[country] ?? [];
    if (cities.length === 0) {
      setAddCountryError(`No cities configured for ${countryName(country)}.`);
      return false;
    }

    setAddedCountryCities((prev) => ({
      ...prev,
      [country]: dedupeCityList([...(prev[country] ?? []), ...cities]),
    }));

    setHiddenCountryCodes((prev) => {
      const next = new Set(prev);
      next.delete(country);
      return next;
    });
    setSelectedCountryCodes((prev) => orderDiscoveryCountryCodes([...prev, country]));
    setSelectedCityKeys((prev) => {
      const next = new Set(prev);
      for (const city of cities) {
        next.add(citySelectionKey(country, city));
      }
      return next;
    });
    setExpandedCountryCodes((prev) => {
      const next = new Set(prev);
      next.delete(country);
      return next;
    });
    setAddCountryInput('');
    setCountryInputResetKey((key) => key + 1);
    setAddCountryError(null);
    setSubmitError(null);
    return true;
  };

  const toggleCity = (country: DiscoveryCountryCodeContract, city: string) => {
    setSubmitError(null);
    setSelectedCountryCodes((prevCountries) => {
      if (prevCountries.includes(country)) {
        return prevCountries;
      }
      const nextCountries = new Set([...prevCountries, country]);
      return displayedCountryCodes.filter((displayedCountry) => nextCountries.has(displayedCountry));
    });
    setSelectedCityKeys((prev) => {
      const next = new Set(prev);
      const cityKey = citySelectionKey(country, city);
      if (next.has(cityKey)) {
        next.delete(cityKey);
      } else {
        next.add(cityKey);
      }
      return next;
    });
  };

  const selectAllCitiesForCountry = (country: DiscoveryCountryCodeContract) => {
    setSubmitError(null);
    setCitySearchByCountry((prev) => ({ ...prev, [country]: '' }));
    setSelectedCountryCodes((prev) => {
      if (prev.includes(country)) {
        return prev;
      }
      const nextCountries = new Set([...prev, country]);
      return displayedCountryCodes.filter((displayedCountry) => nextCountries.has(displayedCountry));
    });
    setSelectedCityKeys((prev) => {
      const next = new Set(prev);
      for (const city of countryCities[country] ?? []) {
        next.add(citySelectionKey(country, city));
      }
      return next;
    });
  };

  const clearCitiesForCountry = (country: DiscoveryCountryCodeContract) => {
    setSubmitError(null);
    setCitySearchByCountry((prev) => ({ ...prev, [country]: '' }));
    setSelectedCityKeys((prev) => {
      const next = new Set(prev);
      for (const city of countryCities[country] ?? []) {
        next.delete(citySelectionKey(country, city));
      }
      return next;
    });
  };

  const selectIcp = (id: string) => {
    setSubmitError(null);
    setSelectedIcpIds((currentSelectedIcpIds) => getNextSelectedIcpId(currentSelectedIcpIds, id));
  };

  const selectAllIcps = () => {
    if (!icps.data) {
      return;
    }
    setSubmitError(null);
    setSelectedIcpIds(icps.data.items.map((item) => item.id));
  };

  const clearSelectedIcps = () => {
    setSubmitError(null);
    setSelectedIcpIds([]);
  };

  const parsedSearchTaskLimit = parseSearchTaskLimit(searchTaskLimit);
  const isPresetSearchTaskLimit = SEARCH_TASK_OPTIONS.some((option) => option === searchTaskLimit);

  const handleStartDiscovery = async () => {
    if (selectedIcpIds.length === 0) {
      setShowTargetingControls(true);
      setSubmitError('Choose one or more ICPs for the discovery run.');
      return;
    }

    if (selectedCountryCodes.length === 0) {
      setShowTargetingControls(true);
      setSubmitError('Select at least one country for the discovery run.');
      return;
    }

    if (missingCityCountries.length > 0) {
      setShowTargetingControls(true);
      setSubmitError(
        `Add at least one city for ${missingCityCountries.map((country) => countryName(country)).join(', ')} in Controls & Settings before starting discovery.`,
      );
      return;
    }

    if (selectedCountriesWithoutSelectedCities.length > 0) {
      setShowTargetingControls(true);
      setSubmitError(
        `Select at least one city for ${selectedCountriesWithoutSelectedCities.map((country) => countryName(country)).join(', ')} or clear those countries.`,
      );
      return;
    }

    if (parsedSearchTaskLimit === null) {
      setSubmitError(null);
      setShowSearchTaskLimitError(true);
      return;
    }

    setShowSearchTaskLimitError(false);

    const request = buildDiscoveryRequest({
      selectedIcpIds,
      countries: selectedCountryCodes,
      cities: selectedCitiesForRequest,
      includeWebsiteAnalysis,
      includeSocialMediaAnalysis,
      searchTaskLimit: parsedSearchTaskLimit,
      requestedByUserId: user?.id,
    });
    if (!request) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      await apiClient.createDiscoveryRun(request);

      setRunsRefreshKey((k) => k + 1);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to start discovery');
    } finally {
      setIsSubmitting(false);
    }
  };

  const countryColumns = useMemo(() => {
    const columns: [DiscoveryCountryCodeContract[], DiscoveryCountryCodeContract[]] = [[], []];
    displayedCountryCodes.forEach((country, index) => {
      const column = index % 2 === 0 ? columns[0] : columns[1];
      column.push(country);
    });
    return columns;
  }, [displayedCountryCodes]);

  const renderCountryCard = (country: DiscoveryCountryCodeContract) => {
    const countrySelected = selectedCountryCodes.includes(country);
    const countryExpanded = expandedCountryCodes.has(country);
    const cities = countryCities[country] ?? [];
    const citySearchValue = citySearchByCountry[country] ?? '';
    const normalizedCitySearchValue = citySearchValue.trim().toLowerCase();
    const selectedCityCount = cities.filter((city) => selectedCityKeys.has(citySelectionKey(country, city))).length;
    const visibleCities = normalizedCitySearchValue
      ? cities.filter((city) => city.toLowerCase().includes(normalizedCitySearchValue))
      : cities.filter((city) => selectedCityKeys.has(citySelectionKey(country, city)));

    return (
      <div
        key={country}
        className={cn(
          'rounded-xl border transition-all duration-150',
          countrySelected
            ? 'border-zbooni-teal/40 bg-zbooni-teal/5 shadow-sm'
            : 'border-border/30 bg-zbooni-dark/20 hover:border-border/50 hover:bg-zbooni-dark/40',
        )}
      >
        <div className="flex items-center gap-3 p-3">
          <button
            type="button"
            onClick={() => toggleCountryExpansion(country)}
            aria-expanded={countryExpanded}
            aria-controls={`country-cities-${country}`}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/20 hover:text-foreground"
          >
            <ChevronRight
              className={cn(
                'h-4 w-4 transition-transform',
                countryExpanded ? 'rotate-90' : '',
              )}
            />
          </button>

          <button
            type="button"
            onClick={() => toggleCountry(country)}
            role="checkbox"
            aria-checked={countrySelected}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <span className={cn('truncate text-sm font-semibold', countrySelected ? 'text-foreground' : 'text-muted-foreground')}>
              {countryName(country)}
            </span>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground/60">
              {selectedCityCount} / {cities.length} cities
            </span>
          </button>
        </div>

        {countryExpanded ? (
          <div id={`country-cities-${country}`} className="border-t border-border/20 px-4 pb-3 pt-2">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" />
                Cities
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => selectAllCitiesForCountry(country)}
                  disabled={selectedCityCount === cities.length}
                  className="rounded-md bg-muted/20 px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Select all cities
                </button>
                <button
                  type="button"
                  onClick={() => clearCitiesForCountry(country)}
                  disabled={selectedCityCount === 0}
                  className="rounded-md bg-muted/20 px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Clear all cities
                </button>
              </div>
            </div>
            <input
              type="text"
              value={citySearchValue}
              onChange={(event) =>
                setCitySearchByCountry((prev) => ({ ...prev, [country]: event.target.value }))
              }
              placeholder="Search cities"
              className="mb-3 h-9 w-full max-w-72 rounded-lg border border-border/40 bg-card px-3 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-zbooni-teal/50"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />

            {cities.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {visibleCities.map((city) => (
                  <PillOption
                    key={`${country}-${city}`}
                    selected={selectedCityKeys.has(citySelectionKey(country, city))}
                    onClick={() => toggleCity(country, city)}
                    className="px-2.5 py-1 text-xs"
                  >
                    {city}
                  </PillOption>
                ))}
                {visibleCities.length === 0 && normalizedCitySearchValue ? (
                  <p className="text-xs text-muted-foreground/50">No matching cities.</p>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/50">
                No cities configured for {countryName(country)}.
              </p>
            )}
          </div>
        ) : null}
      </div>
    );
  };

  const isRunning = hasActiveRuns;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Discovery Pipeline</h1>
      </div>

      {/* Configuration Form */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="space-y-6">
          {/* Step 1: Search task budget */}
          <div>
            <div className="mb-3 flex items-center gap-2">
              <label htmlFor="search-task-limit" className="text-sm font-semibold">Number of Search Tasks</label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {SEARCH_TASK_OPTIONS.map((option) => (
                <PillOption
                  key={option}
                  selected={searchTaskLimit === option}
                  onClick={() => {
                    setSearchTaskLimit(option);
                    setShowSearchTaskLimitError(false);
                  }}
                  className="min-w-[56px] justify-center"
                >
                  {option}
                </PillOption>
              ))}
              <input
                id="search-task-limit"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                aria-label="Custom number of search tasks"
                placeholder="Custom"
                value={isPresetSearchTaskLimit ? '' : searchTaskLimit}
                onChange={(event) => {
                  setSearchTaskLimit(event.target.value.replace(/\D/g, ''));
                  setShowSearchTaskLimitError(false);
                }}
                className="h-10 w-24 rounded-xl border border-border/40 bg-background px-3 py-2 text-center text-sm font-mono text-foreground placeholder:text-muted-foreground/60 focus:border-zbooni-teal/50 focus:outline-none"
              />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleStartDiscovery}
                disabled={
                  isSubmitting ||
                  !!isRunning
                }
                className="inline-flex h-10 w-full items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-zbooni-green to-zbooni-teal px-6 text-sm font-bold text-zbooni-dark shadow-lg shadow-zbooni-green/20 transition-all hover:shadow-xl hover:shadow-zbooni-green/30 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {isSubmitting
                  ? 'Creating...'
                  : isRunning
                    ? 'Run Active...'
                    : 'Create Run'}
              </button>

              <button
                type="button"
                onClick={() => setShowTargetingControls((current) => !current)}
                aria-expanded={showTargetingControls}
                aria-controls="discovery-targeting-controls"
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-border/30 bg-zbooni-dark/20 px-4 text-sm font-semibold text-white transition-colors hover:bg-zbooni-dark/40 sm:w-auto"
              >
                <Settings2 className="h-4 w-4" />
                {showTargetingControls ? 'Hide options' : 'Show options'}
              </button>
            </div>
            {showSearchTaskLimitError && parsedSearchTaskLimit === null ? (
              <p className="mt-2 text-xs text-red-400">
                Enter a whole number from {MIN_SEARCH_TASK_LIMIT} to {MAX_SEARCH_TASK_LIMIT}.
              </p>
            ) : null}

            {submitError ? (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {submitError}
              </div>
            ) : null}
          </div>

          {showTargetingControls ? (
            <div id="discovery-targeting-controls" className="space-y-6">
              {/* Step 2: Select ICP */}
              <div>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-semibold">Select ICP Profiles</label>
                  </div>

                  {icps.data && icps.data.items.length > 0 ? (
                    <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={selectAllIcps}
                        disabled={selectedIcpIds.length === icps.data.items.length}
                        className="rounded-md bg-muted/20 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:hover:bg-muted/20"
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        onClick={clearSelectedIcps}
                        disabled={selectedIcpIds.length === 0}
                        className="rounded-md bg-muted/20 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:hover:bg-muted/20"
                      >
                        Clear all
                      </button>
                    </div>
                  ) : null}
                </div>

                {missingCityCountries.length > 0 ? (
                  <p className="mb-3 text-xs text-amber-300/80">
                    Add cities in Controls &amp; Settings for {missingCityCountries.map((country) => countryName(country)).join(', ')} before starting discovery.
                  </p>
                ) : null}

                <div role="group" aria-label="ICP profile selection">
                  {icps.isLoading ? (
                    <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
                      Loading profiles...
                    </div>
                  ) : null}

                  {!icps.isLoading && icps.error ? (
                    <div className="flex items-center gap-3 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <span className="flex-1">Failed to load ICP profiles: {icps.error}</span>
                      <button
                        type="button"
                        onClick={icps.refetch}
                        className="shrink-0 rounded-md bg-red-500/20 px-2.5 py-1 text-xs font-semibold text-red-300 transition-colors hover:bg-red-500/30"
                      >
                        Retry
                      </button>
                    </div>
                  ) : null}

                  {icps.data && icps.data.items.length > 0 ? (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {icps.data.items.map((icp) => (
                        <IcpOption
                          key={icp.id}
                          icp={icp}
                          selected={selectedIcpIds.includes(icp.id)}
                          onSelect={selectIcp}
                        />
                      ))}
                    </div>
                  ) : null}

                  {icps.data && icps.data.items.length === 0 ? (
                    <p className="text-sm text-muted-foreground/60">No active ICP profiles found. Create one first.</p>
                  ) : null}
                </div>
              </div>

              {/* Step 3: Countries — country/city targeting and analysis toggles */}
              <div>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-semibold">Countries</label>
                  </div>

                  {displayedCountryCodes.length > 0 ? (
                    <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={selectAllCountries}
                        disabled={selectedCountryCodes.length === displayedCountryCodes.length}
                        className="rounded-md bg-muted/20 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:hover:bg-muted/20"
                      >
                        Select all countries
                      </button>
                      <button
                        type="button"
                        onClick={clearSelectedCountries}
                        disabled={selectedCountryCodes.length === 0}
                        className="rounded-md bg-muted/20 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:hover:bg-muted/20"
                      >
                        Clear all countries
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="space-y-4">
                  <div>
                    <div className="mb-3 space-y-2">
                      <div className="flex">
                        <input
                          key={countryInputResetKey}
                          type="text"
                          list="discovery-country-options"
                          value={addCountryInput}
                          autoComplete="off"
                          autoCorrect="off"
                          spellCheck={false}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setAddCountryError(null);
                            if (
                              isBrowserDatalistSelection(event.nativeEvent) &&
                              addCountryToSelection(nextValue, {
                                country: resolveCountrySearchInput(nextValue),
                                showInvalidError: false,
                              })
                            ) {
                              return;
                            }
                            setAddCountryInput(nextValue);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              addCountryToSelection();
                            }
                          }}
                          placeholder="Search country"
                          className="h-10 w-full max-w-72 rounded-xl border border-border/30 bg-zbooni-dark/20 px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-zbooni-teal/50 sm:w-72"
                        />
                        <datalist id="discovery-country-options">
                          {SupportedCountryPickerOptions.map((country) => (
                            <option
                              key={country.code}
                              value={countrySearchOptionValue(country.code)}
                            />
                          ))}
                        </datalist>
                      </div>
                      {addCountryError ? (
                        <p className="text-xs text-red-400">{addCountryError}</p>
                      ) : null}
                    </div>

                    {displayedCountryCodes.length > 0 ? (
                      <>
                        <div className="space-y-2 sm:hidden">
                          {displayedCountryCodes.map(renderCountryCard)}
                        </div>
                        <div className="hidden gap-2 sm:grid sm:grid-cols-2">
                          {countryColumns.map((countries, columnIndex) => (
                            <div key={`country-column-${columnIndex}`} className="space-y-2">
                              {countries.map(renderCountryCard)}
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground/50">
                        No countries configured.
                      </p>
                    )}
                  </div>

                  {/* Analysis toggles */}
                  <div className="flex flex-wrap gap-4">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={includeWebsiteAnalysis}
                        onChange={(e) => setIncludeWebsiteAnalysis(e.target.checked)}
                        className="h-4 w-4 rounded border-border/50 bg-zbooni-dark/30 text-zbooni-teal accent-zbooni-teal"
                      />
                      <span className="text-sm font-medium">Website analysis</span>
                      <span className="text-[10px] text-muted-foreground/50">Scrape website</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={includeSocialMediaAnalysis}
                        onChange={(e) => setIncludeSocialMediaAnalysis(e.target.checked)}
                        className="h-4 w-4 rounded border-border/50 bg-zbooni-dark/30 text-zbooni-teal accent-zbooni-teal"
                      />
                      <span className="text-sm font-medium">Social media analysis</span>
                      <span className="text-[10px] text-muted-foreground/50">Instagram data</span>
                    </label>
                  </div>

                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Discovery Runs */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-bold tracking-tight">
            <Zap className="h-4 w-4 text-zbooni-green" />
            Discovery Runs
          </h2>
          <button
            type="button"
            onClick={() => setRunsRefreshKey((k) => k + 1)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-muted/20 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40"
          >
            <Loader2 className={cn('h-3 w-3', discoveryRuns.isLoading && 'animate-spin')} />
            Refresh
          </button>
        </div>

        {discoveryRuns.isLoading && !discoveryRuns.data ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
            Loading runs...
          </div>
        ) : null}

        {runBatches.length === 0 && discoveryRuns.data ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-zbooni-dark/60">
              <Search className="h-7 w-7 text-muted-foreground/40" />
            </div>
            <p className="font-medium text-muted-foreground/60">No discovery runs yet</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground/40">
              Configure search above and start discovering leads.
            </p>
          </div>
        ) : null}

        {runBatches.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {runBatches.map((batch) => {
              const statusColors: Record<string, string> = {
                QUEUED: 'bg-gray-500/15 text-gray-400',
                RUNNING: 'bg-zbooni-teal/15 text-zbooni-teal',
                SUCCEEDED: 'bg-zbooni-green/15 text-zbooni-green',
                FAILED: 'bg-red-500/15 text-red-400',
                PARTIAL: 'bg-yellow-500/15 text-yellow-400',
              };
              const isTerminal = batch.overallStatus === 'SUCCEEDED' || batch.overallStatus === 'FAILED' || batch.overallStatus === 'PARTIAL';
              const duration = batch.startedAt
                ? batch.finishedAt
                  ? `${Math.round((new Date(batch.finishedAt).getTime() - new Date(batch.startedAt).getTime()) / 1000)}s`
                  : isTerminal
                    ? 'Completed'
                    : 'Running...'
                : 'Queued';
              const firstWords = batch.icpNames.map((n) => n.split(/\s+/)[0] ?? n);
              const icpLabel = firstWords.length <= 3
                ? firstWords.join(' & ')
                : `${firstWords.slice(0, 2).join(' & ')} +${firstWords.length - 2}`;

              const primaryRunId = batch.runs[0]?.runId;

              return (
                <Link
                  key={batch.batchKey}
                  href={primaryRunId ? `/dashboard/jobs/${primaryRunId}` : '#'}
                  className="block rounded-xl border border-border/30 bg-zbooni-dark/20 p-4 transition-colors hover:border-border/50 hover:bg-zbooni-dark/30"
                >
                  {/* Header: status + time */}
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <StatusIcon status={batch.overallStatus} />
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                          statusColors[batch.overallStatus] ?? 'bg-muted/20 text-muted-foreground',
                        )}
                      >
                        {batch.overallStatus}
                      </span>
                      {batch.runs.length > 1 ? (
                        <span className="text-[10px] text-muted-foreground/40">
                          {batch.runs.length} runs
                        </span>
                      ) : null}
                    </div>
                    <span className="text-[10px] tabular-nums text-muted-foreground/50">
                      {new Date(batch.createdAt).toLocaleString()}
                    </span>
                  </div>

                  {/* ICP + countries */}
                  <div className="mb-3 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <Target className="h-3 w-3 text-zbooni-teal" />
                      <span className="text-xs font-semibold">{icpLabel}</span>
                    </div>
                    {batch.countries.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {batch.countries.map((c) => (
                          <span key={c} className="rounded bg-zbooni-teal/10 px-1.5 py-0.5 text-[10px] text-zbooni-teal">
                            {countryName(c)}
                          </span>
                        ))}
                        {batch.totalTaskLimit > 0 ? (
                          <span className="rounded bg-muted/20 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {batch.totalTaskLimit} search tasks
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  {/* Progress bar — shows search task progress, not lead count */}
                  {batch.totalItems > 0 || batch.overallStatus === 'RUNNING' ? (
                    <ProgressBar
                      processed={batch.totalProcessed}
                      total={batch.totalItems || 1}
                      label="tasks"
                    />
                  ) : null}

                  {/* Stats row */}
                  <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground/60">
                    <span>
                      Processed: <strong className="text-foreground">{batch.totalProcessed}</strong>
                    </span>
                    {batch.totalFailed > 0 ? (
                      <span>
                        Failed: <strong className="text-red-400">{batch.totalFailed}</strong>
                      </span>
                    ) : null}
                    <span className="ml-auto">{duration}</span>
                  </div>

                  {/* Errors */}
                  {batch.errorMessages.length > 0 ? (
                    <p className="mt-2 truncate rounded bg-red-500/10 px-2 py-1 text-[10px] text-red-400" title={batch.errorMessages.join('; ')}>
                      {batch.errorMessages[0]}
                    </p>
                  ) : null}
                  {batch.overallStatus === 'PARTIAL' ? (
                    <p className="mt-2 rounded bg-yellow-500/10 px-2 py-1 text-[10px] text-yellow-300">
                      Partial completion: {batch.totalFailed} item{batch.totalFailed === 1 ? '' : 's'} failed while other items succeeded.
                    </p>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* How it Works */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-base font-bold tracking-tight">How Discovery Works</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          {[
            { step: 1, title: 'Select ICP', desc: 'Choose which customer profile to target', icon: Target },
            { step: 2, title: 'Seed Search Tasks', desc: 'Search tasks are generated from selected ICPs and locations', icon: Search },
            { step: 3, title: 'Enrich & Score', desc: 'Discovered businesses are scraped, enriched, and scored', icon: TrendingUp },
            { step: 4, title: 'Message & Follow-up', desc: 'Approved messages are sent via email or WhatsApp', icon: Zap },
          ].map(({ step, title, desc, icon: Icon }, idx) => (
            <div key={step} className="relative flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zbooni-teal/10">
                <Icon className="h-5 w-5 text-zbooni-teal" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground/60">Step {step}</p>
                <p className="font-semibold">{title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground/60">{desc}</p>
              </div>
              {idx < 3 ? (
                <ChevronRight className="absolute -right-2 top-3 hidden h-4 w-4 text-muted-foreground/20 sm:block" />
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
