import { Building2, ExternalLink, MapPin, Star, Tag } from 'lucide-react';
import Link from 'next/link';

import { countryName } from '../lib/countries.js';

interface AboutBusinessCardProps {
  category: string | null;
  metaDescription: string | null;
  instagramBio: string | null;
  countryCode: string | null;
  city: string | null;
  rating: number | null;
  reviewCount: number | null;
  icpProfileName?: string | null | undefined;
  websiteDomain?: string | null | undefined;
  businessId?: string | null | undefined;
}

export function AboutBusinessCard({
  category,
  metaDescription,
  instagramBio,
  countryCode,
  city,
  rating,
  reviewCount,
  icpProfileName,
  websiteDomain,
  businessId,
}: AboutBusinessCardProps) {
  const location = [countryCode ? countryName(countryCode) : null, city]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
      <h2 className="mb-4 flex items-center gap-2 text-base font-bold tracking-tight">
        <Building2 className="h-4 w-4 text-zbooni-teal" />
        About This Business
      </h2>

      <div className="space-y-3">
        {/* Category + ICP + Website + Business Intel */}
        {(category || icpProfileName || websiteDomain || businessId) && (
          <div className="flex flex-wrap items-center gap-2">
            {category && (
              <span className="rounded-full bg-zbooni-teal/10 px-2.5 py-0.5 text-[11px] font-semibold text-zbooni-teal">
                {category}
              </span>
            )}
            {icpProfileName && (
              <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-purple-300">
                <Tag className="h-3 w-3" />
                {icpProfileName}
              </span>
            )}
            {websiteDomain && (
              <a
                href={`https://${websiteDomain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-border/30 px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-zbooni-teal"
              >
                <ExternalLink className="h-3 w-3" />
                {websiteDomain}
              </a>
            )}
            {businessId && (
              <Link
                href={`/dashboard/leads/businesses?selected=${businessId}`}
                className="inline-flex items-center gap-1 rounded-full border border-border/30 px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-zbooni-teal"
              >
                <Building2 className="h-3 w-3" />
                Business Intel
              </Link>
            )}
          </div>
        )}

        {/* Description */}
        <p className="text-sm text-muted-foreground/70 leading-relaxed">
          {metaDescription ?? 'No description available'}
        </p>

        {/* Instagram Bio */}
        {instagramBio && (
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
