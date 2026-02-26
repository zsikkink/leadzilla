export interface InstagramScraperConfig {
  timeoutMs?: number | undefined;
  userAgent?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
}

export interface InstagramScraperData {
  followerCount: number;
  followingCount: number;
  engagementRate: number | null;
  recentPostCount: number;
  lastPostDate: string | null;
  bio: string | null;
  bioLink: string | null;
  isBusinessAccount: boolean;
}

export interface InstagramScraperFailure {
  classification: 'retryable' | 'terminal';
  statusCode: number | null;
  message: string;
  raw: unknown;
}

export type InstagramScraperResult =
  | { status: 'success'; data: InstagramScraperData }
  | { status: 'retryable_error'; failure: InstagramScraperFailure }
  | { status: 'terminal_error'; failure: InstagramScraperFailure };

const DEFAULT_TIMEOUT_MS = 15_000;

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const EMPTY_DATA: InstagramScraperData = {
  followerCount: 0,
  followingCount: 0,
  engagementRate: null,
  recentPostCount: 0,
  lastPostDate: null,
  bio: null,
  bioLink: null,
  isBusinessAccount: false,
};

function safeNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return 0;
}

function safeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Parse follower/following/post counts from Instagram meta description.
 * Format: "1,234 Followers, 567 Following, 89 Posts - ..."
 * Also handles compact forms: "1.2m Followers" or "12K Following"
 */
function parseMetaDescription(description: string): {
  followerCount: number;
  followingCount: number;
  postCount: number;
  bioFragment: string | null;
} {
  const result = { followerCount: 0, followingCount: 0, postCount: 0, bioFragment: null as string | null };

  // Match "X Followers" pattern (handles commas, K, M suffixes)
  const followerMatch = description.match(/([\d,.]+[kKmM]?)\s*Followers/i);
  if (followerMatch && followerMatch[1]) {
    result.followerCount = parseCompactNumber(followerMatch[1]);
  }

  const followingMatch = description.match(/([\d,.]+[kKmM]?)\s*Following/i);
  if (followingMatch && followingMatch[1]) {
    result.followingCount = parseCompactNumber(followingMatch[1]);
  }

  const postMatch = description.match(/([\d,.]+[kKmM]?)\s*Posts/i);
  if (postMatch && postMatch[1]) {
    result.postCount = parseCompactNumber(postMatch[1]);
  }

  // Bio fragment is typically after the dash separator
  const dashIndex = description.indexOf(' - ');
  if (dashIndex !== -1) {
    const fragment = description.slice(dashIndex + 3).trim();
    if (fragment.length > 0) {
      // Remove trailing quotes or artifacts
      result.bioFragment = fragment.replace(/^["']|["']$/g, '').trim() || null;
    }
  }

  return result;
}

/**
 * Parse compact number strings like "1,234", "12.5K", "1.2M"
 */
function parseCompactNumber(raw: string): number {
  const cleaned = raw.replace(/,/g, '').trim().toLowerCase();

  const mMatch = cleaned.match(/^([\d.]+)m$/);
  if (mMatch && mMatch[1]) {
    return Math.round(parseFloat(mMatch[1]) * 1_000_000);
  }

  const kMatch = cleaned.match(/^([\d.]+)k$/);
  if (kMatch && kMatch[1]) {
    return Math.round(parseFloat(kMatch[1]) * 1_000);
  }

  const num = parseInt(cleaned, 10);
  return Number.isFinite(num) ? num : 0;
}

/**
 * Try to extract data from window._sharedData JSON embedded in the HTML.
 */
function extractFromSharedData(html: string): Partial<InstagramScraperData> | null {
  const match = html.match(/window\._sharedData\s*=\s*({.+?});\s*<\/script>/s);
  if (!match || !match[1]) {
    return null;
  }

  try {
    const shared = JSON.parse(match[1]) as Record<string, unknown>;
    const entryData = shared.entry_data as Record<string, unknown> | undefined;
    if (!entryData) return null;

    const profilePage = entryData.ProfilePage as unknown[] | undefined;
    if (!Array.isArray(profilePage) || profilePage.length === 0) return null;

    const page = profilePage[0] as Record<string, unknown>;
    const graphql = page.graphql as Record<string, unknown> | undefined;
    const user = (graphql?.user ?? page.user) as Record<string, unknown> | undefined;
    if (!user) return null;

    const edgeFollowedBy = user.edge_followed_by as Record<string, unknown> | undefined;
    const edgeFollow = user.edge_follow as Record<string, unknown> | undefined;
    const edgeTimelineMedia = user.edge_owner_to_timeline_media as Record<string, unknown> | undefined;

    const followerCount = safeNumber(edgeFollowedBy?.count ?? user.follower_count);
    const followingCount = safeNumber(edgeFollow?.count ?? user.following_count);
    const mediaCount = safeNumber(edgeTimelineMedia?.count ?? user.media_count);

    // Extract recent posts for engagement and last post date
    const edges = (edgeTimelineMedia?.edges ?? []) as Array<Record<string, unknown>>;
    let recentPostCount = 0;
    let lastPostDate: string | null = null;
    let totalEngagement = 0;

    for (const edge of edges) {
      const node = edge.node as Record<string, unknown> | undefined;
      if (!node) continue;
      recentPostCount++;

      if (recentPostCount === 1) {
        const timestamp = safeNumber(node.taken_at_timestamp);
        if (timestamp > 0) {
          lastPostDate = new Date(timestamp * 1000).toISOString();
        }
      }

      const likes = safeNumber(
        (node.edge_liked_by as Record<string, unknown> | undefined)?.count ?? node.like_count,
      );
      const comments = safeNumber(
        (node.edge_media_to_comment as Record<string, unknown> | undefined)?.count ?? node.comment_count,
      );
      totalEngagement += likes + comments;
    }

    let engagementRate: number | null = null;
    if (recentPostCount > 0 && followerCount > 0) {
      const avgEngagement = totalEngagement / recentPostCount;
      engagementRate = Math.round((avgEngagement / followerCount) * 10000) / 10000;
    }

    return {
      followerCount,
      followingCount,
      engagementRate,
      recentPostCount: recentPostCount > 0 ? recentPostCount : mediaCount,
      lastPostDate,
      bio: safeString(user.biography),
      bioLink: safeString(user.external_url),
      isBusinessAccount: Boolean(user.is_business_account ?? user.is_professional_account ?? false),
    };
  } catch {
    return null;
  }
}

/**
 * Try to extract data from application/ld+json script blocks.
 */
function extractFromLdJson(html: string): Partial<InstagramScraperData> | null {
  const regex = /<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    if (!match[1]) continue;
    try {
      const ld = JSON.parse(match[1]) as Record<string, unknown>;

      // Instagram ld+json often has @type: "ProfilePage" or "Person"
      const type = ld['@type'] as string | undefined;
      if (type !== 'ProfilePage' && type !== 'Person') continue;

      const interactionStatistic = ld.interactionStatistic as Array<Record<string, unknown>> | undefined;
      let followerCount = 0;
      const followingCount = 0;

      if (Array.isArray(interactionStatistic)) {
        for (const stat of interactionStatistic) {
          const interactionType = safeString(stat.interactionType) ?? '';
          const count = safeNumber(stat.userInteractionCount);
          if (interactionType.includes('Follow')) {
            // "http://schema.org/FollowAction"
            followerCount = count;
          }
        }
      }

      // mainEntityOfPage sometimes carries follower data
      const mainEntity = ld.mainEntityOfPage as Record<string, unknown> | undefined;
      if (mainEntity) {
        const mInteraction = mainEntity.interactionStatistic as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(mInteraction)) {
          for (const stat of mInteraction) {
            const interactionType = safeString(stat.interactionType) ?? '';
            const count = safeNumber(stat.userInteractionCount);
            if (interactionType.includes('Follow')) {
              followerCount = followerCount || count;
            }
          }
        }
      }

      if (followerCount > 0 || ld.description) {
        return {
          followerCount,
          followingCount,
          bio: safeString(ld.description),
          bioLink: safeString(ld.url),
        };
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Extract data from meta tags (og:description, description).
 */
function extractFromMetaTags(html: string): Partial<InstagramScraperData> | null {
  // Try og:description first, then regular description
  const ogDescMatch = html.match(
    /<meta\s+(?:property|name)="og:description"\s+content="([^"]*)"/i,
  ) ?? html.match(
    /<meta\s+content="([^"]*)"\s+(?:property|name)="og:description"/i,
  );

  const descMatch = html.match(
    /<meta\s+(?:property|name)="description"\s+content="([^"]*)"/i,
  ) ?? html.match(
    /<meta\s+content="([^"]*)"\s+(?:property|name)="description"/i,
  );

  const description = ogDescMatch?.[1] ?? descMatch?.[1];
  if (!description) {
    return null;
  }

  // Decode HTML entities
  const decoded = description
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  const parsed = parseMetaDescription(decoded);

  if (parsed.followerCount === 0 && parsed.followingCount === 0 && !parsed.bioFragment) {
    return null;
  }

  return {
    followerCount: parsed.followerCount,
    followingCount: parsed.followingCount,
    recentPostCount: parsed.postCount,
    bio: parsed.bioFragment,
  };
}

/**
 * Merge partial extraction results with later sources filling gaps.
 * First non-zero / non-null value wins.
 */
function mergePartials(
  ...partials: Array<Partial<InstagramScraperData> | null>
): InstagramScraperData {
  const merged: InstagramScraperData = { ...EMPTY_DATA };

  for (const partial of partials) {
    if (!partial) continue;

    if (partial.followerCount && partial.followerCount > 0 && merged.followerCount === 0) {
      merged.followerCount = partial.followerCount;
    }
    if (partial.followingCount && partial.followingCount > 0 && merged.followingCount === 0) {
      merged.followingCount = partial.followingCount;
    }
    if (partial.engagementRate != null && merged.engagementRate == null) {
      merged.engagementRate = partial.engagementRate;
    }
    if (partial.recentPostCount && partial.recentPostCount > 0 && merged.recentPostCount === 0) {
      merged.recentPostCount = partial.recentPostCount;
    }
    if (partial.lastPostDate && !merged.lastPostDate) {
      merged.lastPostDate = partial.lastPostDate;
    }
    if (partial.bio && !merged.bio) {
      merged.bio = partial.bio;
    }
    if (partial.bioLink && !merged.bioLink) {
      merged.bioLink = partial.bioLink;
    }
    if (partial.isBusinessAccount && !merged.isBusinessAccount) {
      merged.isBusinessAccount = partial.isBusinessAccount;
    }
  }

  return merged;
}

export class InstagramScraperAdapter {
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: InstagramScraperConfig) {
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.userAgent = config.userAgent ?? DEFAULT_USER_AGENT;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  get isConfigured(): boolean {
    return true;
  }

  async scrapeProfile(handle: string): Promise<InstagramScraperResult> {
    // Strip leading @ if present
    const cleanHandle = handle.startsWith('@') ? handle.slice(1) : handle;

    if (!cleanHandle || cleanHandle.length === 0) {
      return {
        status: 'terminal_error',
        failure: {
          classification: 'terminal',
          statusCode: null,
          message: 'Instagram handle is empty',
          raw: null,
        },
      };
    }

    const url = `https://www.instagram.com/${encodeURIComponent(cleanHandle)}/`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
        },
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (error: unknown) {
      return {
        status: 'retryable_error',
        failure: {
          classification: 'retryable',
          statusCode: null,
          message: error instanceof Error ? error.message : 'Instagram scrape request failed',
          raw: error,
        },
      };
    } finally {
      clearTimeout(timeout);
    }

    // 302 redirect typically means Instagram is requiring login
    if (response.status >= 300 && response.status < 400) {
      return {
        status: 'retryable_error',
        failure: {
          classification: 'retryable',
          statusCode: response.status,
          message: `Instagram redirected (${response.status}) — likely requires login`,
          raw: null,
        },
      };
    }

    // 404 means handle does not exist
    if (response.status === 404) {
      return {
        status: 'terminal_error',
        failure: {
          classification: 'terminal',
          statusCode: 404,
          message: `Instagram handle "${cleanHandle}" not found`,
          raw: null,
        },
      };
    }

    // 429 rate limiting
    if (response.status === 429) {
      return {
        status: 'retryable_error',
        failure: {
          classification: 'retryable',
          statusCode: 429,
          message: 'Instagram rate limit exceeded',
          raw: null,
        },
      };
    }

    // Other non-OK status codes
    if (!response.ok) {
      const classification = response.status >= 500 ? 'retryable' : 'terminal';
      const failure: InstagramScraperFailure = {
        classification,
        statusCode: response.status,
        message: `Instagram scrape failed with status ${response.status}`,
        raw: null,
      };
      return classification === 'retryable'
        ? { status: 'retryable_error', failure }
        : { status: 'terminal_error', failure };
    }

    // Got 200 — attempt to parse HTML
    let html: string;
    try {
      html = await response.text();
    } catch (error: unknown) {
      // Body read failure — retryable
      return {
        status: 'retryable_error',
        failure: {
          classification: 'retryable',
          statusCode: 200,
          message: error instanceof Error ? error.message : 'Failed to read Instagram response body',
          raw: error,
        },
      };
    }

    // Try extraction strategies in order of richness
    const fromSharedData = extractFromSharedData(html);
    const fromLdJson = extractFromLdJson(html);
    const fromMeta = extractFromMetaTags(html);

    // Merge all partial results — sharedData is richest, then ld+json, then meta
    const data = mergePartials(fromSharedData, fromLdJson, fromMeta);

    // Graceful degradation: even if we extracted nothing, return success with zeroed data
    return {
      status: 'success',
      data,
    };
  }
}
