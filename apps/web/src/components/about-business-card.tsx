import { Building2, MapPin, Sparkles, Star } from 'lucide-react';

import { countryName } from '../lib/countries.js';

interface AboutBusinessCardProps {
  category: string | null;
  metaDescription: string | null;
  instagramBio: string | null;
  countryCode: string | null;
  city: string | null;
  rating: number | null;
  reviewCount: number | null;
  /** AI-generated business insights from business_conversions.businessInsights */
  businessInsights?: string | null | undefined;
}

export function AboutBusinessCard({
  category,
  metaDescription,
  instagramBio,
  countryCode,
  city,
  rating,
  reviewCount,
  businessInsights,
}: AboutBusinessCardProps) {
  const location = [countryCode ? countryName(countryCode) : null, city]
    .filter(Boolean)
    .join(', ');

  // Prefer AI insights over raw scraped description
  const hasAiInsights = businessInsights && businessInsights.trim().length > 0;
  const descriptionText = hasAiInsights
    ? businessInsights.trim()
    : (metaDescription ?? 'No description available');

  return (
    <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
      <h2 className="mb-4 flex items-center gap-2 text-base font-bold tracking-tight">
        <Building2 className="h-4 w-4 text-zbooni-teal" />
        About This Business
      </h2>

      <div className="space-y-3">
        {/* Category */}
        {category && (
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-zbooni-teal/10 px-2.5 py-0.5 text-[11px] font-semibold text-zbooni-teal">
              {category}
            </span>
          </div>
        )}

        {/* AI Insights or Description */}
        <div>
          {hasAiInsights ? (
            <div className="flex items-start gap-2">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
              <p className="text-sm text-foreground/80 leading-relaxed">
                {descriptionText}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground/70 leading-relaxed">
              {descriptionText}
            </p>
          )}
        </div>

        {/* Instagram Bio — only show if no AI insights (avoid redundancy) */}
        {instagramBio && !hasAiInsights && (
          <p className="text-xs italic text-muted-foreground/60 leading-relaxed">
            &ldquo;{instagramBio}&rdquo;
          </p>
        )}

        {/* Location + Rating row */}
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground/60">
          {location && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {location}
            </span>
          )}
          {rating !== null && (
            <span className="flex items-center gap-1">
              <Star className="h-3 w-3 text-yellow-400" />
              {rating}/5
              {reviewCount !== null && reviewCount > 0 && (
                <span className="text-muted-foreground/40">
                  ({reviewCount.toLocaleString()} reviews)
                </span>
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
