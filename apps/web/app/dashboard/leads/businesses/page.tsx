'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  ExternalLink,
  Globe,
  Instagram,
  Loader2,
  Search,
  Star,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';

import { AboutBusinessCard } from '@/components/about-business-card.js';
import { LeadsNav } from '@/components/leads-nav.js';
import { useDiscoveryAdminAccess } from '@/hooks/use-discovery-admin-access.js';
import { countryName } from '@/lib/countries.js';
import { getSupabaseBrowserClient } from '@/lib/supabase-client.js';
import { cn } from '@/lib/utils.js';

// ── Types ────────────────────────────────────────────────────────────────────

interface BusinessIntelRow {
  id: string;
  name: string;
  countryCode: string | null;
  city: string | null;
  category: string | null;
  rating: number | null;
  reviewCount: number | null;
  websiteDomain: string | null;
  instagramHandle: string | null;
  deterministicScore: number | null;
  scoreBand: string | null;
  businessInsights: string | null;
  metaDescription: string | null;
  instagramBio: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseBusinessInsights(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && 'insights' in parsed) {
      return String((parsed as Record<string, unknown>).insights);
    }
    return raw;
  } catch {
    return raw;
  }
}

function extractMetaDescription(scrapeJson: unknown): string | null {
  if (!scrapeJson || typeof scrapeJson !== 'object') return null;
  const obj = scrapeJson as Record<string, unknown>;
  if (typeof obj.metaDescription === 'string' && obj.metaDescription.length > 0) {
    return obj.metaDescription;
  }
  if (typeof obj.description === 'string' && obj.description.length > 0) {
    return obj.description;
  }
  return null;
}

function extractInstagramBio(scrapeJson: unknown): string | null {
  if (!scrapeJson || typeof scrapeJson !== 'object') return null;
  const obj = scrapeJson as Record<string, unknown>;
  if (typeof obj.biography === 'string' && obj.biography.length > 0) return obj.biography;
  if (typeof obj.bio === 'string' && obj.bio.length > 0) return obj.bio;
  return null;
}

// ── Score badge ──────────────────────────────────────────────────────────────

function ScoreBadge({ score, band }: { score: number | null; band: string | null }) {
  if (score == null || score === 0) {
    return (
      <span className="rounded-md bg-muted/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50">
        Not scored
      </span>
    );
  }
  const color =
    band === 'HIGH'
      ? 'text-zbooni-green bg-zbooni-green/10'
      : band === 'MEDIUM'
        ? 'text-yellow-400 bg-yellow-400/10'
        : 'text-red-400 bg-red-400/10';
  return (
    <span className={cn('rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider', color)}>
      {score.toFixed(2)} {band ?? ''}
    </span>
  );
}

// ── List card (left sidebar) ─────────────────────────────────────────────────

function BusinessListCard({
  biz,
  isSelected,
  onSelect,
}: {
  biz: BusinessIntelRow;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const location = [
    biz.countryCode ? countryName(biz.countryCode) : null,
    biz.city,
  ]
    .filter(Boolean)
    .join(' / ');

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-xl border p-4 text-left transition-all duration-200',
        isSelected
          ? 'border-zbooni-teal/40 bg-zbooni-teal/[0.04] shadow-[0_0_20px_rgba(60,200,224,0.06)]'
          : 'border-border/30 bg-zbooni-dark/20 hover:border-border/50 hover:bg-zbooni-dark/40',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold tracking-tight">{biz.name}</p>
          <p className="text-[11px] text-muted-foreground/60">
            {biz.category ?? 'N/A'}
          </p>
        </div>
        <ScoreBadge score={biz.deterministicScore} band={biz.scoreBand} />
      </div>
      <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground/40">
        <span className="flex items-center gap-1">
          <Globe className="h-3 w-3" />
          {location || 'N/A'}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {biz.websiteDomain ? (
          <span className="rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-blue-400">
            Web
          </span>
        ) : null}
        {biz.instagramHandle ? (
          <span className="rounded-full bg-pink-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-pink-400">
            IG
          </span>
        ) : null}
        {biz.rating != null ? (
          <span className="flex items-center gap-0.5 rounded-full bg-yellow-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-yellow-400">
            <Star className="h-2.5 w-2.5" />
            {biz.rating}
          </span>
        ) : null}
      </div>
    </button>
  );
}

// ── Detail panel (right side) ────────────────────────────────────────────────

function BusinessDetailPanel({ biz }: { biz: BusinessIntelRow }) {
  const insights = parseBusinessInsights(biz.businessInsights);
  const location = [
    biz.countryCode ? countryName(biz.countryCode) : null,
    biz.city,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="space-y-4">
      {/* Header card */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4 border-b border-border/30 pb-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-zbooni-teal" />
              <h2 className="truncate text-lg font-extrabold tracking-tight">{biz.name}</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground/60">
              {biz.category ?? 'N/A'} &middot; {location || 'N/A'}
            </p>
          </div>
          <ScoreBadge score={biz.deterministicScore} band={biz.scoreBand} />
        </div>

        {/* Quick stats */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-border/20 bg-slate-800 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Rating</p>
            <p className="mt-0.5 text-sm font-bold">
              {biz.rating != null ? `${biz.rating}/5` : 'N/A'}
            </p>
          </div>
          <div className="rounded-lg border border-border/20 bg-slate-800 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Reviews</p>
            <p className="mt-0.5 text-sm font-bold">
              {biz.reviewCount != null ? biz.reviewCount.toLocaleString() : 'N/A'}
            </p>
          </div>
          <div className="rounded-lg border border-border/20 bg-slate-800 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Website</p>
            <p className={cn('mt-0.5 text-sm font-bold', biz.websiteDomain ? 'text-blue-400' : '')}>
              {biz.websiteDomain ? 'Yes' : 'N/A'}
            </p>
          </div>
          <div className="rounded-lg border border-border/20 bg-slate-800 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Instagram</p>
            <p className={cn('mt-0.5 text-sm font-bold', biz.instagramHandle ? 'text-pink-400' : '')}>
              {biz.instagramHandle ? 'Yes' : 'N/A'}
            </p>
          </div>
        </div>

        {/* Contact info links */}
        <div className="mt-4 flex flex-wrap gap-3 text-xs">
          {biz.websiteDomain ? (
            <a
              href={`https://${biz.websiteDomain}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 rounded-full border border-border/30 px-2.5 py-1 text-zbooni-teal transition-colors hover:border-zbooni-teal/40 hover:text-zbooni-green"
            >
              <Globe className="h-3 w-3" />
              {biz.websiteDomain}
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          ) : (
            <span className="flex items-center gap-1 rounded-full border border-border/30 px-2.5 py-1 text-muted-foreground/40">
              <Globe className="h-3 w-3" />
              N/A
            </span>
          )}
          {biz.instagramHandle ? (
            <a
              href={`https://instagram.com/${biz.instagramHandle}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 rounded-full border border-border/30 px-2.5 py-1 text-pink-400 transition-colors hover:border-pink-400/40 hover:text-pink-300"
            >
              <Instagram className="h-3 w-3" />
              @{biz.instagramHandle}
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          ) : (
            <span className="flex items-center gap-1 rounded-full border border-border/30 px-2.5 py-1 text-muted-foreground/40">
              <Instagram className="h-3 w-3" />
              N/A
            </span>
          )}
        </div>

        {/* Business insights */}
        {insights ? (
          <div className="mt-4 rounded-lg border border-border/20 bg-slate-800 px-3 py-2 text-xs leading-relaxed text-muted-foreground/70">
            {insights}
          </div>
        ) : null}
      </div>

      {/* About This Business (shared component) */}
      <AboutBusinessCard
        category={biz.category}
        metaDescription={biz.metaDescription}
        instagramBio={biz.instagramBio}
        countryCode={biz.countryCode}
        city={biz.city}
        rating={biz.rating}
        reviewCount={biz.reviewCount}
      />
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function BusinessIntelligencePage() {
  const adminAccess = useDiscoveryAdminAccess();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [businesses, setBusinesses] = useState<BusinessIntelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('selected'));

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  // Load business data from Supabase
  useEffect(() => {
    if (adminAccess.isLoading || !adminAccess.isAllowed) return;
    let cancelled = false;

    async function loadBusinesses() {
      setLoading(true);
      setError(null);

      try {
        const supabase = getSupabaseBrowserClient();

        // Load conversions for AI insights
        const { data: conversions, error: convErr } = await supabase
          .from('business_conversions')
          .select('businessId, businessInsights')
          .order('createdAt', { ascending: false })
          .limit(200);

        if (convErr) throw convErr;
        if (cancelled) return;
        if (!conversions || conversions.length === 0) {
          setBusinesses([]);
          setLoading(false);
          return;
        }

        // Get unique business IDs and map insights
        const bizIds = [...new Set(conversions.map((c) => c.businessId as string))];
        const insightsMap = new Map<string, string | null>();
        for (const c of conversions) {
          const bId = c.businessId as string;
          if (!insightsMap.has(bId)) {
            insightsMap.set(bId, c.businessInsights as string | null);
          }
        }

        // Load business details (snake_case column names via @map)
        const { data: bizRows, error: bizErr } = await supabase
          .from('businesses')
          .select('id, name, country_code, city, category, rating, review_count, website_domain, instagram_handle, deterministic_score, score_band, apify_website_scrape_json, apify_instagram_scrape_json')
          .in('id', bizIds)
          .limit(200);

        if (bizErr) throw bizErr;
        if (cancelled) return;

        const rows: BusinessIntelRow[] = (bizRows ?? []).map((b) => ({
          id: b.id as string,
          name: b.name as string,
          countryCode: b.country_code as string | null,
          city: b.city as string | null,
          category: b.category as string | null,
          rating: b.rating as number | null,
          reviewCount: b.review_count as number | null,
          websiteDomain: b.website_domain as string | null,
          instagramHandle: b.instagram_handle as string | null,
          deterministicScore: b.deterministic_score as number | null,
          scoreBand: b.score_band as string | null,
          businessInsights: insightsMap.get(b.id as string) ?? null,
          metaDescription: extractMetaDescription(b.apify_website_scrape_json),
          instagramBio: extractInstagramBio(b.apify_instagram_scrape_json),
        }));

        setBusinesses(rows);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load businesses');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadBusinesses();
    return () => {
      cancelled = true;
    };
  }, [adminAccess.isLoading, adminAccess.isAllowed]);

  // Filtered businesses
  const filtered = useMemo(() => {
    if (!debouncedQuery) return businesses;
    return businesses.filter(
      (b) =>
        b.name.toLowerCase().includes(debouncedQuery) ||
        (b.category?.toLowerCase().includes(debouncedQuery) ?? false) ||
        (b.city?.toLowerCase().includes(debouncedQuery) ?? false) ||
        (b.websiteDomain?.toLowerCase().includes(debouncedQuery) ?? false) ||
        (b.instagramHandle?.toLowerCase().includes(debouncedQuery) ?? false),
    );
  }, [businesses, debouncedQuery]);

  // Auto-select first item if nothing selected
  useEffect(() => {
    const firstId = filtered[0]?.id ?? null;
    if (!selectedId && firstId) {
      setSelectedId(firstId);
    }
    if (selectedId && !filtered.some((b) => b.id === selectedId)) {
      setSelectedId(firstId);
    }
  }, [filtered, selectedId]);

  // Sync URL param for selected
  useEffect(() => {
    const requestedSelected = searchParams.get('selected');
    if (requestedSelected) {
      setSelectedId(requestedSelected);
    }
  }, [searchParams]);

  const selected = selectedId ? filtered.find((b) => b.id === selectedId) ?? null : null;

  if (adminAccess.isLoading) {
    return (
      <div className="space-y-4">
        <LeadsNav active="main" />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Verifying admin access...
        </div>
      </div>
    );
  }

  if (!adminAccess.isAllowed) {
    return (
      <div className="space-y-4">
        <LeadsNav active="main" />
        <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
          <p className="text-sm text-muted-foreground">
            {adminAccess.error ?? 'Admin access is required for business intelligence.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <LeadsNav active="main" />

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Business Intelligence</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {loading ? 'Loading...' : `${filtered.length} businesses with conversion data`}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="rounded-2xl border border-border/50 bg-card p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Search className="h-4 w-4 text-muted-foreground/40" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by name, category, city, domain, or Instagram handle..."
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
          />
          <span className="text-[11px] text-muted-foreground/40">{filtered.length} shown</span>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {/* Main layout — master-detail grid matching recovery page */}
      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        {/* Left: business list */}
        <div className="space-y-3 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto lg:pr-1">
          {loading ? (
            <div className="flex items-center gap-2 rounded-xl border border-border/30 bg-zbooni-dark/20 p-6">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/40" />
              <span className="text-sm text-muted-foreground/50">Loading businesses...</span>
            </div>
          ) : filtered.length > 0 ? (
            filtered.map((biz) => (
              <BusinessListCard
                key={biz.id}
                biz={biz}
                isSelected={biz.id === selectedId}
                onSelect={() => {
                  setSelectedId(biz.id);
                  router.replace(`/dashboard/leads/businesses?selected=${biz.id}`);
                }}
              />
            ))
          ) : (
            <div className="rounded-xl border border-border/30 bg-zbooni-dark/20 p-6 text-center">
              <Building2 className="mx-auto h-8 w-8 text-muted-foreground/20" />
              <p className="mt-2 text-sm text-muted-foreground/50">No businesses found</p>
            </div>
          )}
        </div>

        {/* Right: detail panel */}
        {selected ? (
          <div className="lg:sticky lg:top-20 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto">
            <BusinessDetailPanel biz={selected} />
          </div>
        ) : (
          <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
            <div className="flex flex-col items-center justify-center py-20">
              <Building2 className="h-12 w-12 text-muted-foreground/15" />
              <h3 className="mt-4 text-base font-bold tracking-tight text-muted-foreground/60">
                Select a business
              </h3>
              <p className="mt-1 max-w-xs text-center text-[12px] text-muted-foreground/35">
                Click a business to view its intelligence data.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
