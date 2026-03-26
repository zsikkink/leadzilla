'use client';

import { useEffect, useState } from 'react';
import { Building2, ExternalLink, Globe, Loader2 } from 'lucide-react';

import { LeadsNav } from '../../../../src/components/leads-nav.js';
import { AboutBusinessCard } from '../../../../src/components/about-business-card.js';
import { useDiscoveryAdminAccess } from '../../../../src/hooks/use-discovery-admin-access.js';
import { getSupabaseBrowserClient } from '../../../../src/lib/supabase-client.js';

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
  businessInsights: string | null;
}

export default function BusinessIntelligencePage() {
  const adminAccess = useDiscoveryAdminAccess();
  const [businesses, setBusinesses] = useState<BusinessIntelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (adminAccess.isLoading || !adminAccess.isAllowed) return;
    let cancelled = false;

    async function loadBusinesses() {
      setLoading(true);
      setError(null);

      try {
        const supabase = getSupabaseBrowserClient();

        // Load businesses that have been converted (have a business_conversion record)
        // Join with business_conversions for AI insights
        const { data: conversions, error: convErr } = await supabase
          .from('business_conversions')
          .select('business_id, business_insights')
          .order('created_at', { ascending: false })
          .limit(100);

        if (convErr) throw convErr;
        if (cancelled) return;
        if (!conversions || conversions.length === 0) {
          setBusinesses([]);
          setLoading(false);
          return;
        }

        // Get unique business IDs
        const bizIds = [...new Set(conversions.map((c) => c.business_id))];
        const insightsMap = new Map<string, string | null>();
        for (const c of conversions) {
          if (!insightsMap.has(c.business_id)) {
            insightsMap.set(c.business_id, c.business_insights);
          }
        }

        // Load business details
        const { data: bizRows, error: bizErr } = await supabase
          .from('businesses')
          .select('id, name, country_code, city, category, rating, review_count, website_domain, instagram_handle')
          .in('id', bizIds)
          .limit(100);

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
          businessInsights: insightsMap.get(b.id as string) ?? null,
        }));

        setBusinesses(rows);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load businesses');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadBusinesses();
    return () => { cancelled = true; };
  }, [adminAccess.isLoading, adminAccess.isAllowed]);

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
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Business Intelligence</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {loading ? 'Loading...' : `${businesses.length} businesses with conversion data`}
        </p>
      </div>

      <LeadsNav active="main" />

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading businesses...
        </div>
      )}

      {!loading && businesses.length === 0 && (
        <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm text-center">
          <Building2 className="mx-auto h-8 w-8 text-muted-foreground/30" />
          <p className="mt-2 text-sm text-muted-foreground">No converted businesses found.</p>
        </div>
      )}

      {/* Business cards grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {businesses.map((biz) => (
          <div key={biz.id} className="flex flex-col">
            <AboutBusinessCard
              category={biz.category}
              metaDescription={null}
              instagramBio={null}
              countryCode={biz.countryCode}
              city={biz.city}
              rating={biz.rating}
              reviewCount={biz.reviewCount}
              businessInsights={biz.businessInsights}
            />
            {/* Business name + links footer */}
            <div className="-mt-1 rounded-b-2xl border border-t-0 border-border/50 bg-card/50 px-6 pb-4 pt-2">
              <p className="text-sm font-bold">{biz.name}</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {biz.websiteDomain && (
                  <a
                    href={`https://${biz.websiteDomain}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-zbooni-teal hover:text-zbooni-green transition-colors"
                  >
                    <Globe className="h-3 w-3" />
                    {biz.websiteDomain}
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                )}
                {biz.instagramHandle && (
                  <a
                    href={`https://instagram.com/${biz.instagramHandle}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-pink-400 hover:text-pink-300 transition-colors"
                  >
                    @{biz.instagramHandle}
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
