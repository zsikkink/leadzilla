export interface InstagramScraperConfig {
  timeoutMs?: number | undefined;
  userAgent?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
  username?: string | undefined;
  password?: string | undefined;
  rateLimitPerMinute?: number | undefined;
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
  isVerified: boolean;
  businessCategory: string | null;
  businessEmail: string | null;
  businessPhone: string | null;
  mediaCount: number;
  storyHighlightsCount: number;
  isProfessionalAccount: boolean;
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
const AUTH_TIMEOUT_MS = 20_000;
const SESSION_DURATION_MS = 3_600_000; // 1 hour
const IG_APP_ID = '936619743392459';

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
  isVerified: false,
  businessCategory: null,
  businessEmail: null,
  businessPhone: null,
  mediaCount: 0,
  storyHighlightsCount: 0,
  isProfessionalAccount: false,
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
      mediaCount,
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
    if (partial.isVerified && !merged.isVerified) {
      merged.isVerified = partial.isVerified;
    }
    if (partial.businessCategory && !merged.businessCategory) {
      merged.businessCategory = partial.businessCategory;
    }
    if (partial.businessEmail && !merged.businessEmail) {
      merged.businessEmail = partial.businessEmail;
    }
    if (partial.businessPhone && !merged.businessPhone) {
      merged.businessPhone = partial.businessPhone;
    }
    if (partial.mediaCount && partial.mediaCount > 0 && merged.mediaCount === 0) {
      merged.mediaCount = partial.mediaCount;
    }
    if (partial.storyHighlightsCount && partial.storyHighlightsCount > 0 && merged.storyHighlightsCount === 0) {
      merged.storyHighlightsCount = partial.storyHighlightsCount;
    }
    if (partial.isProfessionalAccount && !merged.isProfessionalAccount) {
      merged.isProfessionalAccount = partial.isProfessionalAccount;
    }
  }

  return merged;
}

/**
 * Extract CSRF token from Instagram HTML page or Set-Cookie headers.
 */
function extractCsrfToken(html: string, setCookieHeaders: string[]): string | null {
  // Try Set-Cookie headers first
  for (const cookie of setCookieHeaders) {
    const csrfMatch = cookie.match(/csrftoken=([^;]+)/);
    if (csrfMatch && csrfMatch[1]) {
      return csrfMatch[1];
    }
  }

  // Try meta tag
  const metaMatch = html.match(/<meta\s+name="csrf-token"\s+content="([^"]+)"/i);
  if (metaMatch && metaMatch[1]) {
    return metaMatch[1];
  }

  // Try window._sharedData
  const sharedMatch = html.match(/"csrf_token"\s*:\s*"([^"]+)"/);
  if (sharedMatch && sharedMatch[1]) {
    return sharedMatch[1];
  }

  return null;
}

/**
 * Parse Set-Cookie headers into key-value pairs.
 */
function parseCookiesFromHeaders(setCookieHeaders: string[]): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const header of setCookieHeaders) {
    // Each Set-Cookie header: "name=value; Path=/; ..."
    const firstPart = header.split(';')[0];
    if (!firstPart) continue;
    const eqIdx = firstPart.indexOf('=');
    if (eqIdx === -1) continue;
    const name = firstPart.slice(0, eqIdx).trim();
    const value = firstPart.slice(eqIdx + 1).trim();
    if (name && value) {
      cookies.set(name, value);
    }
  }
  return cookies;
}

/**
 * Format cookies map into Cookie header string.
 */
function formatCookieHeader(cookies: Map<string, string>): string {
  const parts: string[] = [];
  cookies.forEach((value, key) => {
    parts.push(`${key}=${value}`);
  });
  return parts.join('; ');
}

/**
 * Get all Set-Cookie headers from a Response.
 * Handles the fact that response.headers.getSetCookie() may not be available in all runtimes.
 */
function getSetCookieHeaders(response: Response): string[] {
  // Modern runtimes support getSetCookie()
  if (typeof response.headers.getSetCookie === 'function') {
    return response.headers.getSetCookie();
  }
  // Fallback: try to get the raw header (may be comma-joined)
  const raw = response.headers.get('set-cookie');
  if (!raw) return [];
  // Split on comma followed by a cookie name pattern to avoid splitting within cookie values
  return raw.split(/,(?=\s*\w+=)/);
}

export class InstagramScraperAdapter {
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly username: string | null;
  private readonly password: string | null;
  private readonly rateLimitPerMinute: number;

  private sessionCookies: Map<string, string> = new Map();
  private sessionExpiresAt: number = 0;
  private requestTimestamps: number[] = [];

  constructor(config: InstagramScraperConfig) {
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.userAgent = config.userAgent ?? DEFAULT_USER_AGENT;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.username = config.username ?? null;
    this.password = config.password ?? null;
    this.rateLimitPerMinute = config.rateLimitPerMinute ?? 10;
  }

  get isConfigured(): boolean {
    return true;
  }

  private get hasCredentials(): boolean {
    return this.username !== null && this.password !== null;
  }

  private get hasValidSession(): boolean {
    return (
      this.sessionCookies.has('sessionid') &&
      this.sessionCookies.has('csrftoken') &&
      Date.now() < this.sessionExpiresAt
    );
  }

  /**
   * Sliding window rate limiter. Waits if at capacity instead of rejecting.
   */
  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const windowMs = 60_000;
    // Remove timestamps older than window
    this.requestTimestamps = this.requestTimestamps.filter(t => now - t < windowMs);

    if (this.requestTimestamps.length >= this.rateLimitPerMinute) {
      const oldestInWindow = this.requestTimestamps[0]!;
      const waitMs = windowMs - (now - oldestInWindow) + 100; // +100ms buffer
      if (waitMs > 0) {
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
    }

    this.requestTimestamps.push(Date.now());
  }

  /**
   * Authenticate with Instagram and store session cookies.
   * Returns structured result — never throws.
   */
  private async authenticate(): Promise<{
    success: boolean;
    requiresTwoFactor: boolean;
    message: string;
  }> {
    if (!this.username || !this.password) {
      return { success: false, requiresTwoFactor: false, message: 'No credentials configured' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);

    try {
      // Step 1: GET Instagram homepage to obtain CSRF token
      const homepageResponse = await this.fetchImpl('https://www.instagram.com/', {
        method: 'GET',
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
        signal: controller.signal,
      });

      const homepageHtml = await homepageResponse.text();
      const setCookieHeaders = getSetCookieHeaders(homepageResponse);
      const csrfToken = extractCsrfToken(homepageHtml, setCookieHeaders);

      if (!csrfToken) {
        return { success: false, requiresTwoFactor: false, message: 'Failed to obtain CSRF token from Instagram homepage' };
      }

      // Collect initial cookies from homepage response
      const initialCookies = parseCookiesFromHeaders(setCookieHeaders);
      initialCookies.set('csrftoken', csrfToken);

      // Step 2: POST login request
      const timestamp = Math.floor(Date.now() / 1000);
      const loginBody = new URLSearchParams({
        username: this.username,
        enc_password: `#PWD_BROWSER:0:${timestamp}:${this.password}`,
        queryParams: '{}',
        optIntoOneTap: 'false',
      });

      const loginResponse = await this.fetchImpl(
        'https://www.instagram.com/api/v1/web/accounts/login/ajax/',
        {
          method: 'POST',
          headers: {
            'User-Agent': this.userAgent,
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-CSRFToken': csrfToken,
            'X-Requested-With': 'XMLHttpRequest',
            'X-IG-App-ID': IG_APP_ID,
            Referer: 'https://www.instagram.com/',
            Origin: 'https://www.instagram.com',
            Cookie: formatCookieHeader(initialCookies),
          },
          redirect: 'manual',
          signal: controller.signal,
          body: loginBody.toString(),
        },
      );

      // Parse login response cookies
      const loginSetCookies = getSetCookieHeaders(loginResponse);
      const loginCookies = parseCookiesFromHeaders(loginSetCookies);

      // Merge initial + login cookies
      const allCookies = new Map<string, string>();
      initialCookies.forEach((v, k) => allCookies.set(k, v));
      loginCookies.forEach((v, k) => allCookies.set(k, v));

      // Parse login response body
      let loginData: Record<string, unknown> = {};
      try {
        const contentType = loginResponse.headers.get('content-type') ?? '';
        if (contentType.includes('application/json') || contentType.includes('text/javascript')) {
          loginData = (await loginResponse.json()) as Record<string, unknown>;
        } else {
          const bodyText = await loginResponse.text();
          try {
            loginData = JSON.parse(bodyText) as Record<string, unknown>;
          } catch {
            return {
              success: false,
              requiresTwoFactor: false,
              message: `Login returned non-JSON response (status ${loginResponse.status})`,
            };
          }
        }
      } catch {
        return { success: false, requiresTwoFactor: false, message: 'Failed to parse login response' };
      }

      // Check for 2FA requirement
      if (loginData.two_factor_required === true) {
        return { success: false, requiresTwoFactor: true, message: 'Two-factor authentication required' };
      }

      // Check for checkpoint/challenge
      if (loginData.checkpoint_url || loginData.message === 'checkpoint_required') {
        return {
          success: false,
          requiresTwoFactor: false,
          message: 'Instagram checkpoint/challenge required — account may need manual verification',
        };
      }

      // Check authentication success
      const authenticated = loginData.authenticated === true;
      if (!authenticated) {
        const errorMessage = typeof loginData.message === 'string'
          ? loginData.message
          : 'Authentication failed — invalid credentials';
        return { success: false, requiresTwoFactor: false, message: errorMessage };
      }

      // Verify we got a sessionid cookie
      if (!allCookies.has('sessionid')) {
        return { success: false, requiresTwoFactor: false, message: 'Login succeeded but no sessionid cookie received' };
      }

      // Store session
      this.sessionCookies = allCookies;
      this.sessionExpiresAt = Date.now() + SESSION_DURATION_MS;

      return { success: true, requiresTwoFactor: false, message: 'Authenticated successfully' };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Authentication request failed';
      return { success: false, requiresTwoFactor: false, message: msg };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Fetch profile data using the authenticated internal API endpoint.
   * Returns null to signal "fall back to public scrape" (session expired, unexpected response).
   * Returns a result for definitive outcomes (success, 404, 429, 5xx).
   */
  private async fetchAuthenticatedProfile(
    handle: string,
  ): Promise<InstagramScraperResult | null> {
    const csrfToken = this.sessionCookies.get('csrftoken') ?? '';
    const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          'User-Agent': this.userAgent,
          Accept: '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'X-CSRFToken': csrfToken,
          'X-IG-App-ID': IG_APP_ID,
          'X-Requested-With': 'XMLHttpRequest',
          Referer: `https://www.instagram.com/${encodeURIComponent(handle)}/`,
          Cookie: formatCookieHeader(this.sessionCookies),
        },
        redirect: 'manual',
        signal: controller.signal,
      });

      // Session expired — caller should re-authenticate
      if (response.status === 401 || response.status === 403) {
        await response.text().catch(() => {});
        return null;
      }

      // Rate limited
      if (response.status === 429) {
        return {
          status: 'retryable_error',
          failure: {
            classification: 'retryable',
            statusCode: 429,
            message: 'Instagram API rate limit exceeded (authenticated)',
            raw: null,
          },
        };
      }

      // 404 — handle does not exist
      if (response.status === 404) {
        return {
          status: 'terminal_error',
          failure: {
            classification: 'terminal',
            statusCode: 404,
            message: `Instagram handle "${handle}" not found`,
            raw: null,
          },
        };
      }

      // Redirect — unexpected for API endpoint
      if (response.status >= 300 && response.status < 400) {
        await response.text().catch(() => {});
        return null;
      }

      // Server errors
      if (response.status >= 500) {
        return {
          status: 'retryable_error',
          failure: {
            classification: 'retryable',
            statusCode: response.status,
            message: `Instagram API server error (${response.status})`,
            raw: null,
          },
        };
      }

      // Other client errors
      if (!response.ok) {
        return {
          status: 'terminal_error',
          failure: {
            classification: 'terminal',
            statusCode: response.status,
            message: `Instagram API error (${response.status})`,
            raw: null,
          },
        };
      }

      // Parse JSON response
      let body: Record<string, unknown>;
      try {
        body = (await response.json()) as Record<string, unknown>;
      } catch {
        return null;
      }

      // Navigate to data.user
      const data = body.data as Record<string, unknown> | undefined;
      const user = data?.user as Record<string, unknown> | undefined;

      if (!user) {
        return null;
      }

      // Extract all fields from the authenticated response
      const followerCount = safeNumber(user.follower_count);
      const followingCount = safeNumber(user.following_count);
      const mediaCount = safeNumber(user.media_count);
      const highlightCount = safeNumber(user.highlight_reel_count);

      const isVerified = Boolean(user.is_verified);
      const isBusinessAccount = Boolean(user.is_business_account);
      const isProfessionalAccount = Boolean(user.is_professional_account);
      const businessCategory = safeString(user.business_category_name);
      const businessEmail = safeString(user.business_email);
      const businessPhone = safeString(user.business_phone_number);

      const bio = safeString(user.biography);
      const bioLink = safeString(user.external_url);

      // Extract recent posts for engagement rate and last post date
      const edgeTimelineMedia = user.edge_owner_to_timeline_media as Record<string, unknown> | undefined;
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

      const effectivePostCount = recentPostCount > 0 ? recentPostCount : mediaCount;

      return {
        status: 'success',
        data: {
          followerCount,
          followingCount,
          engagementRate,
          recentPostCount: effectivePostCount,
          lastPostDate,
          bio,
          bioLink,
          isBusinessAccount,
          isVerified,
          businessCategory,
          businessEmail,
          businessPhone,
          mediaCount,
          storyHighlightsCount: highlightCount,
          isProfessionalAccount,
        },
      };
    } catch {
      // Network error during authenticated request — signal fallback
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Public scrape path — fetches the profile HTML page and extracts data
   * using the 3-tier extraction strategy (sharedData, ld+json, meta tags).
   * Identical logic to the original implementation.
   */
  private async scrapePublicProfile(handle: string): Promise<InstagramScraperResult> {
    const url = `https://www.instagram.com/${encodeURIComponent(handle)}/`;

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
          message: `Instagram handle "${handle}" not found`,
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

    // Apply rate limiting for all requests
    await this.waitForRateLimit();

    // ── Authenticated path ──────────────────────────────────────────────
    if (this.hasCredentials) {
      // Ensure we have a valid session
      if (!this.hasValidSession) {
        const authResult = await this.authenticate();

        if (authResult.requiresTwoFactor) {
          console.warn(
            '[InstagramScraper] 2FA required for account — falling back to public scrape',
          );
          return this.scrapePublicProfile(cleanHandle);
        }

        if (!authResult.success) {
          console.warn(
            `[InstagramScraper] Authentication failed: ${authResult.message} — falling back to public scrape`,
          );
          return this.scrapePublicProfile(cleanHandle);
        }
      }

      // Try authenticated endpoint
      const authenticatedResult = await this.fetchAuthenticatedProfile(cleanHandle);

      if (authenticatedResult !== null) {
        return authenticatedResult;
      }

      // null means session expired or unexpected response — try re-auth once
      this.sessionCookies.clear();
      this.sessionExpiresAt = 0;

      const reAuthResult = await this.authenticate();

      if (reAuthResult.success) {
        const retryResult = await this.fetchAuthenticatedProfile(cleanHandle);
        if (retryResult !== null) {
          return retryResult;
        }
      } else {
        console.warn(
          `[InstagramScraper] Re-authentication failed: ${reAuthResult.message} — falling back to public scrape`,
        );
      }

      // All authenticated attempts failed — fall back to public scrape
      return this.scrapePublicProfile(cleanHandle);
    }

    // ── Public path (no credentials) ────────────────────────────────────
    return this.scrapePublicProfile(cleanHandle);
  }
}
