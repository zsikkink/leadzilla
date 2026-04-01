'use client';

import type {
  DiscoveryCountryCodeContract,
  IcpProfileResponse,
  PipelineRunStatus,
} from '@lead-flood/contracts';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Globe,
  Loader2,
  MapPin,
  Play,
  Rocket,
  Search,
  Target,
  TrendingUp,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useApiQuery } from '../../../src/hooks/use-api-query.js';
import { useAuth } from '../../../src/hooks/use-auth.js';
import { countryName, toDiscoveryCountryCodes } from '../../../src/lib/countries.js';
import { cn } from '../../../src/lib/utils.js';

// ── City mapping by country ──────────────────────────────
const COUNTRY_CITIES: Record<DiscoveryCountryCodeContract, string[]> = {
  AE: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Fujairah', 'Umm Al Quwain', 'Al Ain'],
  SA: ['Riyadh', 'Jeddah', 'Dammam', 'Mecca', 'Medina', 'Khobar', 'Tabuk', 'Abha'],
  BH: ['Manama', 'Muharraq', 'Riffa', 'Hamad Town'],
  KW: ['Kuwait City', 'Hawalli', 'Salmiya', 'Jahra'],
  QA: ['Doha', 'Al Wakrah', 'Al Khor', 'Lusail'],
  OM: ['Muscat', 'Salalah', 'Sohar', 'Nizwa'],
  EG: ['Cairo', 'Alexandria', 'Giza', 'Sharm El Sheikh'],
  JO: ['Amman', 'Irbid', 'Zarqa', 'Aqaba'],
  LB: ['Beirut', 'Tripoli', 'Sidon', 'Jounieh'],
  IQ: ['Baghdad', 'Erbil', 'Basra', 'Sulaymaniyah'],
  MA: ['Casablanca', 'Rabat', 'Marrakech', 'Fez', 'Tangier'],
  TN: ['Tunis', 'Sfax', 'Sousse', 'Kairouan'],
  DZ: ['Algiers', 'Oran', 'Constantine', 'Annaba'],
  LY: ['Tripoli', 'Benghazi', 'Misrata', 'Sabha'],
  YE: ['Sanaa', 'Aden', 'Taiz', 'Hodeidah'],
  SY: ['Damascus', 'Aleppo', 'Homs', 'Latakia'],
  PS: ['Ramallah', 'Gaza', 'Nablus', 'Hebron', 'Bethlehem'],
  SD: ['Khartoum', 'Omdurman', 'Port Sudan', 'Kassala'],
};

const ICP_COUNTRY_NAME_TO_CODE: Record<string, DiscoveryCountryCodeContract> = {
  'united arab emirates': 'AE',
  'saudi arabia': 'SA',
  egypt: 'EG',
  jordan: 'JO',
  bahrain: 'BH',
  kuwait: 'KW',
  qatar: 'QA',
  oman: 'OM',
  lebanon: 'LB',
  iraq: 'IQ',
  morocco: 'MA',
  tunisia: 'TN',
  algeria: 'DZ',
  libya: 'LY',
  yemen: 'YE',
  syria: 'SY',
  palestine: 'PS',
  sudan: 'SD',
  uae: 'AE',
  ksa: 'SA',
};

const LIMIT_OPTIONS = [
  { value: '5', label: '5' },
  { value: '10', label: '10' },
  { value: '25', label: '25' },
  { value: '50', label: '50' },
  { value: '100', label: '100' },
  { value: '250', label: '250' },
  { value: '500', label: '500' },
  { value: '1000', label: '1000' },
];

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

function IcpCheckbox({
  icp,
  selected,
  onToggle,
}: {
  icp: IcpProfileResponse;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(icp.id)}
      className={cn(
        'flex items-start gap-3 rounded-xl border p-3 text-left transition-all duration-150',
        selected
          ? 'border-zbooni-teal/40 bg-zbooni-teal/5 shadow-sm'
          : 'border-border/30 bg-zbooni-dark/20 hover:border-border/50 hover:bg-zbooni-dark/40',
      )}
    >
      {/* Checkbox indicator */}
      <div
        className={cn(
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors duration-150',
          selected
            ? 'border-zbooni-teal bg-zbooni-teal text-zbooni-dark'
            : 'border-border/50 bg-transparent',
        )}
      >
        {selected ? (
          <svg className="h-3 w-3" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2.5}>
            <path d="M2 6l3 3 5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
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
  totalLimit: number;
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
    totalLimit: runs.reduce((sum, r) => sum + r.limit, 0),
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

function toCountryCodeFromIcpTarget(
  value: string | null | undefined,
): DiscoveryCountryCodeContract | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const normalized = trimmed.toLowerCase();
  const directMapped = ICP_COUNTRY_NAME_TO_CODE[normalized];
  if (directMapped) {
    return directMapped;
  }

  const upper = trimmed.toUpperCase();
  if (upper in COUNTRY_CITIES) {
    return upper as DiscoveryCountryCodeContract;
  }

  return toDiscoveryCountryCodes([trimmed])[0] ?? null;
}

// ── Main page ──────────────────────────────────────

export default function DiscoverPage() {
  const { apiClient, user } = useAuth();

  // Form state: multi-ICP selection + pipeline v2 settings
  const [selectedIcpIds, setSelectedIcpIds] = useState<Set<string>>(new Set());
  const [selectedCities, setSelectedCities] = useState<Set<string>>(new Set());
  const [selectedCountryForCities, setSelectedCountryForCities] = useState<DiscoveryCountryCodeContract | null>(null);
  const [includeWebsiteAnalysis, setIncludeWebsiteAnalysis] = useState(true);
  const [includeSocialMediaAnalysis, setIncludeSocialMediaAnalysis] = useState(true);
  const [limit, setLimit] = useState('25');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Discovery rates for cost estimate: yield rate (businesses/task) + conversion rate (leads/business)
  const [yieldRates, setYieldRates] = useState<Map<string, number>>(new Map());
  const [conversionRates, setConversionRates] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    let cancelled = false;
    async function fetchDiscoveryRates() {
      try {
        const { items } = await apiClient.listPipelineSettings();
        if (cancelled) return;
        const yieldMap = new Map<string, number>();
        const convMap = new Map<string, number>();
        for (const item of items) {
          const key = item.key;
          const rate = typeof item.value === 'number' ? item.value : Number(item.value);
          if (isNaN(rate) || rate <= 0) continue;
          if (key.startsWith('discovery_yield_rate:')) {
            const icpId = key.replace('discovery_yield_rate:', '');
            yieldMap.set(icpId, rate);
          } else if (key.startsWith('discovery_conversion_rate:')) {
            const icpId = key.replace('discovery_conversion_rate:', '');
            convMap.set(icpId, rate);
          }
        }
        setYieldRates(yieldMap);
        setConversionRates(convMap);
      } catch {
        // Non-critical
      }
    }
    void fetchDiscoveryRates();
    return () => { cancelled = true; };
  }, [apiClient]);

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

  // Group discovery runs into batches (runs within 5s = same batch)
  const runBatches = useMemo(
    () => groupRunsIntoBatches(discoveryRuns.data?.runs ?? [], icps.data?.items),
    [discoveryRuns.data, icps.data],
  );

  // Derive country codes from selected ICPs
  const selectedIcpCountryCodes = useMemo<DiscoveryCountryCodeContract[]>(() => {
    if (!icps.data) return [];
    const countryCodes = new Set<DiscoveryCountryCodeContract>();
    for (const id of selectedIcpIds) {
      const icp = icps.data.items.find((i) => i.id === id);
      if (icp) {
        for (const countryNameValue of icp.targetCountries) {
          const countryCode = toCountryCodeFromIcpTarget(countryNameValue);
          if (countryCode) {
            countryCodes.add(countryCode);
          }
        }
      }
    }
    return Array.from(countryCodes).sort((a, b) => a.localeCompare(b));
  }, [selectedIcpIds, icps.data]);

  const countriesForCityPicker = useMemo<DiscoveryCountryCodeContract[]>(
    () =>
      selectedIcpIds.size === 0
        ? (Object.keys(COUNTRY_CITIES) as DiscoveryCountryCodeContract[]).sort((a, b) => a.localeCompare(b))
        : selectedIcpCountryCodes,
    [selectedIcpIds, selectedIcpCountryCodes],
  );

  // Available cities based on selected ICP countries (or all countries if no ICP selected)
  const availableCities = useMemo(() => {
    const cities = new Set<string>();
    for (const country of countriesForCityPicker) {
      const mapped = COUNTRY_CITIES[country];
      if (mapped) for (const c of mapped) cities.add(c);
    }
    return Array.from(cities).sort();
  }, [countriesForCityPicker]);

  // Reset city selection when countries change
  useEffect(() => {
    setSelectedCities((prev) => {
      const citySet = new Set(availableCities);
      const filtered = new Set(Array.from(prev).filter((c) => citySet.has(c)));
      return filtered.size !== prev.size ? filtered : prev;
    });
  }, [availableCities]);

  const toggleCity = (city: string) => {
    setSelectedCities((prev) => {
      const next = new Set(prev);
      if (next.has(city)) {
        next.delete(city);
      } else {
        next.add(city);
      }
      return next;
    });
  };

  // Auto-select first country when countries list changes
  useEffect(() => {
    if (countriesForCityPicker.length > 0 && (!selectedCountryForCities || !countriesForCityPicker.includes(selectedCountryForCities))) {
      setSelectedCountryForCities(countriesForCityPicker[0] ?? null);
    }
  }, [countriesForCityPicker, selectedCountryForCities]);

  const toggleIcp = (id: string) => {
    setSelectedIcpIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Cities for the country selected in the left panel
  const citiesForSelectedCountry = useMemo(() => {
    if (!selectedCountryForCities) return [];
    return COUNTRY_CITIES[selectedCountryForCities] ?? [];
  }, [selectedCountryForCities]);

  // Count of selected cities per country (for badge display)
  const selectedCityCountByCountry = useMemo(() => {
    const counts = new Map<DiscoveryCountryCodeContract, number>();
    for (const code of countriesForCityPicker) {
      const countryCities = COUNTRY_CITIES[code] ?? [];
      const count = countryCities.filter((c) => selectedCities.has(c)).length;
      if (count > 0) counts.set(code, count);
    }
    return counts;
  }, [countriesForCityPicker, selectedCities]);

  // Reset selected country when available countries change
  useEffect(() => {
    setSelectedCountryForCities((prev) => {
      if (prev && countriesForCityPicker.includes(prev)) return prev;
      return countriesForCityPicker[0] ?? null;
    });
  }, [countriesForCityPicker]);

  const handleStartDiscovery = async () => {
    if (selectedIcpIds.size === 0 || selectedIcpCountryCodes.length === 0) return;

    setIsSubmitting(true);
    setSubmitError(null);

    const cities = selectedCities.size > 0 ? Array.from(selectedCities) : undefined;

    try {
      // Single API call with all selected ICPs — limit is split server-side
      await apiClient.createDiscoveryRun({
        icpProfileIds: Array.from(selectedIcpIds),
        countries: selectedIcpCountryCodes,
        ...(cities ? { cities } : {}),
        includeWebsiteAnalysis,
        includeSocialMediaAnalysis,
        limit: parseInt(limit, 10),
        ...(user?.id ? { requestedByUserId: user.id } : {}),
      });

      // Refresh run list to show new runs
      setRunsRefreshKey((k) => k + 1);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to start discovery');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isRunning = hasActiveRuns;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-zbooni-green to-zbooni-teal">
            <Rocket className="h-5 w-5 text-zbooni-dark" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Discover Leads</h1>
            <p className="text-sm text-muted-foreground">
              Find new prospects matching your Ideal Customer Profiles
            </p>
          </div>
        </div>
      </div>

      {/* Configuration Form */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <h2 className="mb-5 flex items-center gap-2 text-base font-bold tracking-tight">
          <Search className="h-4 w-4 text-zbooni-teal" />
          Configure Search
        </h2>

        <div className="space-y-6">
          {/* Step 1: Select ICPs (multi-select with checkboxes) */}
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-zbooni-teal/10 text-xs font-bold text-zbooni-teal">
                1
              </span>
              <label className="text-sm font-semibold">Select ICP Profiles</label>
              {selectedIcpIds.size > 0 ? (
                <span className="rounded-full bg-zbooni-teal/10 px-2 py-0.5 text-[11px] font-semibold text-zbooni-teal">
                  {selectedIcpIds.size} selected
                </span>
              ) : null}
            </div>

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
                  <IcpCheckbox
                    key={icp.id}
                    icp={icp}
                    selected={selectedIcpIds.has(icp.id)}
                    onToggle={toggleIcp}
                  />
                ))}
              </div>
            ) : null}

            {icps.data && icps.data.items.length === 0 ? (
              <p className="text-sm text-muted-foreground/60">No active ICP profiles found. Create one first.</p>
            ) : null}
          </div>

          {/* Step 2: Search Settings — countries, cities, analysis toggles */}
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-zbooni-teal/10 text-xs font-bold text-zbooni-teal">
                2
              </span>
              <label className="text-sm font-semibold">Search Settings</label>
            </div>

            <div className="space-y-4 rounded-xl border border-border/30 bg-zbooni-dark/10 p-4">
              {/* Countries + Cities — two-panel grid layout */}
              {countriesForCityPicker.length > 0 ? (
                <div className="grid grid-cols-1 lg:grid-cols-[65fr_35fr] gap-4">
                  {/* LEFT: Country selector panel */}
                  <div className="rounded-xl border border-border/40 bg-card/50 p-4 max-h-[400px] overflow-y-auto">
                    <div className="mb-3 flex items-center gap-1.5">
                      <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs font-semibold text-muted-foreground">Target Countries</span>
                      <span className="ml-auto rounded-full bg-zbooni-teal/10 px-2 py-0.5 text-[10px] font-bold text-zbooni-teal">
                        {countriesForCityPicker.length}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {countriesForCityPicker.map((c) => {
                        const isSelected = selectedCountryForCities === c;
                        const cityCount = COUNTRY_CITIES[c]?.length ?? 0;
                        const selectedCount = selectedCityCountByCountry.get(c) ?? 0;
                        return (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setSelectedCountryForCities(c)}
                            className={cn(
                              'flex items-center justify-between w-full rounded-lg border px-3 py-2.5 text-sm transition-colors',
                              isSelected
                                ? 'border-zbooni-teal/40 bg-zbooni-teal/[0.06] text-foreground'
                                : 'border-border/30 bg-zbooni-dark/30 text-muted-foreground hover:border-border/50 hover:text-foreground',
                            )}
                          >
                            <span className="truncate text-center font-medium flex-1">{countryName(c)}</span>
                            <span className={cn(
                              'ml-2 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                              selectedCount > 0
                                ? 'bg-zbooni-teal/15 text-zbooni-teal'
                                : 'bg-muted/20 text-muted-foreground/50',
                            )}>
                              {selectedCount > 0 ? `${selectedCount}/${cityCount}` : cityCount}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* RIGHT: Cities panel for selected country */}
                  <div className="rounded-xl border border-border/40 bg-card/50 p-4 lg:sticky lg:top-20">
                    {selectedCountryForCities ? (
                      <>
                        <div className="mb-3 flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-xs font-semibold text-muted-foreground">
                              {countryName(selectedCountryForCities)} Cities
                            </span>
                            <span className="text-[10px] text-muted-foreground/50">(optional)</span>
                          </div>
                          {(selectedCityCountByCountry.get(selectedCountryForCities) ?? 0) > 0 ? (
                            <button
                              type="button"
                              onClick={() => {
                                const countryCities = COUNTRY_CITIES[selectedCountryForCities] ?? [];
                                setSelectedCities((prev) => {
                                  const next = new Set(prev);
                                  for (const c of countryCities) next.delete(c);
                                  return next;
                                });
                              }}
                              className="text-[10px] font-medium text-muted-foreground/60 hover:text-foreground"
                            >
                              Clear
                            </button>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {citiesForSelectedCountry.map((city) => (
                            <PillOption
                              key={city}
                              selected={selectedCities.has(city)}
                              onClick={() => toggleCity(city)}
                              className="px-2.5 py-1 text-xs"
                            >
                              {city}
                            </PillOption>
                          ))}
                        </div>
                        {selectedCities.size > 0 ? (
                          <div className="mt-3 flex items-center justify-between border-t border-border/20 pt-2">
                            <span className="text-[10px] text-muted-foreground/50">
                              {selectedCities.size} {selectedCities.size === 1 ? 'city' : 'cities'} selected across all countries
                            </span>
                            <button
                              type="button"
                              onClick={() => setSelectedCities(new Set())}
                              className="text-[10px] font-medium text-muted-foreground/60 hover:text-foreground"
                            >
                              Clear all
                            </button>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-8 text-center">
                        <MapPin className="h-6 w-6 text-muted-foreground/20" />
                        <p className="mt-2 text-xs text-muted-foreground/50">Select a country to manage its cities</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground/50">No mapped target countries found for the selected ICP profiles</p>
                </div>
              )}

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

          {/* Step 3: Limit — expanded inline pill selector */}
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-zbooni-teal/10 text-xs font-bold text-zbooni-teal">
                3
              </span>
              <label className="text-sm font-semibold">Number of Leads</label>
            </div>
            <div className="flex flex-wrap gap-2">
              {LIMIT_OPTIONS.map((opt) => (
                <PillOption
                  key={opt.value}
                  selected={limit === opt.value}
                  onClick={() => setLimit(opt.value)}
                  className="min-w-[56px] justify-center"
                >
                  {opt.label}
                </PillOption>
              ))}
            </div>
          </div>

          {/* Cost Estimate */}
          {selectedIcpIds.size > 0 && parseInt(limit, 10) > 0 ? (() => {
            const desiredLeads = parseInt(limit, 10);
            // Compute effective lead-per-task rate from yield (businesses/task) * conversion (leads/business)
            const selectedLeadRates = Array.from(selectedIcpIds)
              .map((id) => {
                const yieldRate = yieldRates.get(id);
                const convRate = conversionRates.get(id);
                if (yieldRate !== undefined && convRate !== undefined) {
                  return yieldRate * convRate;
                }
                if (yieldRate !== undefined) {
                  // Have yield but no conversion data -- assume 10% conversion (conservative)
                  return yieldRate * 0.10;
                }
                return undefined;
              })
              .filter((r): r is number => r !== undefined);
            const avgLeadRate = selectedLeadRates.length > 0
              ? selectedLeadRates.reduce((a, b) => a + b, 0) / selectedLeadRates.length
              : 0.015; // default fallback: ~1.5% leads per search task
            const hasHistoricalData = selectedLeadRates.length > 0;
            const searchBudget = Math.ceil(desiredLeads / avgLeadRate * 1.5);
            // ~50% of discovered businesses pass prequalification and reach Hunter
            const hunterLookups = Math.ceil(searchBudget * 0.5);
            // ~30% of qualified leads get Apollo enrichment (HIGH score band)
            const apolloReveals = Math.ceil(desiredLeads * 0.3);
            // Brave web search: ~1 search per business that reaches contact discovery (~60% of prequalified)
            const braveSearches = Math.ceil(searchBudget * 0.3);
            const estLeads = desiredLeads;
            // Dollar cost per provider:
            // Google Places: $0.01/search task
            // Hunter: $0.03/lookup (Starter plan: 2000 credits @ ~$49)
            // Apollo: $0.05/reveal (Professional plan pricing)
            // Brave: $0.005/search (Search API pricing)
            const googlePlacesCost = searchBudget * 0.01;
            const hunterCost = hunterLookups * 0.03;
            const apolloCost = apolloReveals * 0.05;
            const braveCost = braveSearches * 0.005;
            const totalCost = googlePlacesCost + hunterCost + apolloCost + braveCost;
            return (
              <div className="rounded-xl border border-zbooni-teal/20 bg-zbooni-teal/5 px-4 py-4">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp className="h-4 w-4 text-zbooni-teal" />
                  <span className="text-sm font-semibold text-zbooni-teal">Cost Estimate</span>
                  {!hasHistoricalData ? (
                    <span className="text-[10px] text-muted-foreground/50">(using default rates)</span>
                  ) : (
                    <span className="text-[10px] text-zbooni-green/60">(based on historical data)</span>
                  )}
                </div>
                {/* Summary */}
                <p className="text-sm text-muted-foreground mb-3">
                  ~<strong className="text-foreground">{searchBudget}</strong> search tasks
                  {' → est. '}<strong className="text-zbooni-green">{estLeads}</strong> leads
                  {hasHistoricalData ? (
                    <span className="text-muted-foreground/60">
                      {' '}({(avgLeadRate * 100).toFixed(1)}% lead rate)
                    </span>
                  ) : null}
                </p>
                {/* Per-provider breakdown */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center justify-between rounded-lg bg-zbooni-dark/20 px-2.5 py-1.5">
                    <span className="text-muted-foreground/70">Google Places</span>
                    <div className="text-right">
                      <span className="font-mono font-semibold text-foreground">${googlePlacesCost.toFixed(2)}</span>
                      <span className="ml-1 text-[10px] text-muted-foreground/40">({searchBudget} searches)</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-zbooni-dark/20 px-2.5 py-1.5">
                    <span className="text-muted-foreground/70">Hunter</span>
                    <div className="text-right">
                      <span className="font-mono font-semibold text-foreground">${hunterCost.toFixed(2)}</span>
                      <span className="ml-1 text-[10px] text-muted-foreground/40">({hunterLookups} lookups)</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-zbooni-dark/20 px-2.5 py-1.5">
                    <span className="text-muted-foreground/70">Apollo</span>
                    <div className="text-right">
                      <span className="font-mono font-semibold text-foreground">${apolloCost.toFixed(2)}</span>
                      <span className="ml-1 text-[10px] text-muted-foreground/40">({apolloReveals} reveals)</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-zbooni-dark/20 px-2.5 py-1.5">
                    <span className="text-muted-foreground/70">Brave Search</span>
                    <div className="text-right">
                      <span className="font-mono font-semibold text-foreground">${braveCost.toFixed(2)}</span>
                      <span className="ml-1 text-[10px] text-muted-foreground/40">({braveSearches} searches)</span>
                    </div>
                  </div>
                </div>
                {/* Total */}
                <div className="mt-3 flex items-center justify-between rounded-lg border border-zbooni-teal/20 bg-zbooni-teal/5 px-3 py-2">
                  <span className="text-xs font-semibold text-muted-foreground">Total estimated cost</span>
                  <span className="font-mono text-sm font-bold text-foreground">~${totalCost.toFixed(2)}</span>
                </div>
              </div>
            );
          })() : null}

          {/* Error */}
          {submitError ? (
            <div className="flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {submitError}
            </div>
          ) : null}

          {/* Launch button */}
          <button
            type="button"
            onClick={handleStartDiscovery}
            disabled={selectedIcpIds.size === 0 || selectedIcpCountryCodes.length === 0 || isSubmitting || !!isRunning}
            className="inline-flex w-full items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-zbooni-green to-zbooni-teal px-6 py-3 text-sm font-bold text-zbooni-dark shadow-lg shadow-zbooni-green/20 transition-all hover:shadow-xl hover:shadow-zbooni-green/30 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {isSubmitting
              ? 'Starting...'
              : isRunning
                ? 'Discovery Running...'
                : selectedIcpIds.size > 1
                  ? `Start Discovery (${selectedIcpIds.size} ICPs)`
                  : 'Start Discovery'}
          </button>
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
                        {batch.totalLimit > 0 ? (
                          <span className="rounded bg-muted/20 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {batch.totalLimit} leads
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
            { step: 2, title: 'Search & Discover', desc: 'AI scans multiple data sources for matching leads', icon: Search },
            { step: 3, title: 'Enrich & Score', desc: 'Each lead is enriched and scored automatically', icon: TrendingUp },
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

      {/* Provider Status */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-base font-bold tracking-tight">Provider Status</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { name: 'Google Places', role: 'Discovery', key: 'GOOGLE_PLACES_API_KEY', icon: Globe },
            { name: 'Brave Search', role: 'CEO/Founder Search', key: 'BRAVE_API_KEY', icon: Search },
            { name: 'Hunter', role: 'Email Lookup', key: 'HUNTER_API_KEY', icon: Target },
            { name: 'Apollo', role: 'Enrichment', key: 'APOLLO_API_KEY', icon: TrendingUp },
          ].map((provider) => {
            const ProviderIcon = provider.icon;
            return (
              <div key={provider.name} className="rounded-xl border border-border/30 bg-zbooni-dark/20 p-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zbooni-teal/10">
                    <ProviderIcon className="h-4 w-4 text-zbooni-teal" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{provider.name}</p>
                    <p className="text-[10px] text-muted-foreground/60">{provider.role}</p>
                  </div>
                </div>
                <div className="mt-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-zbooni-green/10 px-2 py-0.5 text-[10px] font-bold text-zbooni-green">
                    <span className="h-1.5 w-1.5 rounded-full bg-zbooni-green" />
                    Active
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
