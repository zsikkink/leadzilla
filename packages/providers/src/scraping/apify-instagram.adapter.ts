export interface ApifyInstagramAdapterConfig {
  apiKey: string | undefined;
  actorId: string | undefined;
  timeoutMs?: number | undefined;
  fetchImpl?: typeof fetch | undefined;
}

export interface ApifyInstagramProfileData {
  followerCount: number;
  followingCount: number;
  engagementRate: number;
  recentPostCount: number;
  lastPostDate: string | null;
  bio: string | null;
  bioLink: string | null;
  isBusinessAccount: boolean;
}

export interface ApifyInstagramFailure {
  classification: 'retryable' | 'terminal';
  statusCode: number | null;
  message: string;
  raw: unknown;
}

export type ApifyInstagramResult =
  | { status: 'success'; data: ApifyInstagramProfileData }
  | { status: 'retryable_error'; failure: ApifyInstagramFailure }
  | { status: 'terminal_error'; failure: ApifyInstagramFailure };

const DEFAULT_TIMEOUT_MS = 60_000;

function classifyStatus(statusCode: number): 'retryable' | 'terminal' {
  if (statusCode === 429 || statusCode >= 500) {
    return 'retryable';
  }
  return 'terminal';
}

function parseJsonSafe(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function safeNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return 0;
}

function safeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function computeEngagementRate(profile: Record<string, unknown>): number {
  const followers = safeNumber(profile.followersCount ?? profile.followerCount);
  if (followers <= 0) {
    return 0;
  }

  // Try to get engagement from recent posts
  const posts = Array.isArray(profile.latestPosts) ? profile.latestPosts : [];
  if (posts.length === 0) {
    return 0;
  }

  let totalEngagement = 0;
  for (const post of posts) {
    if (post && typeof post === 'object') {
      const p = post as Record<string, unknown>;
      totalEngagement += safeNumber(p.likesCount ?? p.likes) + safeNumber(p.commentsCount ?? p.comments);
    }
  }

  const avgEngagement = totalEngagement / posts.length;
  return Math.round((avgEngagement / followers) * 10000) / 10000;
}

function extractLastPostDate(profile: Record<string, unknown>): string | null {
  const posts = Array.isArray(profile.latestPosts) ? profile.latestPosts : [];
  if (posts.length === 0) {
    return null;
  }

  const first = posts[0];
  if (first && typeof first === 'object') {
    const p = first as Record<string, unknown>;
    const timestamp = safeString(p.timestamp) ?? safeString(p.date) ?? safeString(p.takenAtTimestamp as unknown);
    return timestamp;
  }

  return null;
}

function extractFromItems(items: unknown[]): ApifyInstagramProfileData {
  // Apify Instagram scraper returns an array of profile objects
  const profile = items.length > 0 && items[0] && typeof items[0] === 'object'
    ? (items[0] as Record<string, unknown>)
    : {};

  const followerCount = safeNumber(profile.followersCount ?? profile.followerCount);
  const followingCount = safeNumber(profile.followingCount ?? profile.followsCount);
  const posts = Array.isArray(profile.latestPosts) ? profile.latestPosts : [];

  return {
    followerCount,
    followingCount,
    engagementRate: computeEngagementRate(profile),
    recentPostCount: posts.length,
    lastPostDate: extractLastPostDate(profile),
    bio: safeString(profile.biography ?? profile.bio),
    bioLink: safeString(profile.externalUrl ?? profile.externalLink ?? profile.bioLink),
    isBusinessAccount: Boolean(profile.isBusinessAccount ?? profile.isBusiness ?? false),
  };
}

export class ApifyInstagramAdapter {
  private readonly apiKey: string | undefined;
  private readonly actorId: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: ApifyInstagramAdapterConfig) {
    this.apiKey = config.apiKey;
    this.actorId = config.actorId;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  get isConfigured(): boolean {
    return Boolean(this.apiKey) && Boolean(this.actorId);
  }

  async scrapeProfile(handle: string): Promise<ApifyInstagramResult> {
    if (!this.apiKey || !this.actorId) {
      return {
        status: 'terminal_error',
        failure: {
          classification: 'terminal',
          statusCode: null,
          message: 'APIFY_API_KEY or APIFY_INSTAGRAM_ACTOR_ID is not configured',
          raw: null,
        },
      };
    }

    // Strip leading @ if present
    const cleanHandle = handle.startsWith('@') ? handle.slice(1) : handle;

    const url = `https://api.apify.com/v2/acts/${encodeURIComponent(this.actorId)}/run-sync-get-dataset-items?token=${encodeURIComponent(this.apiKey)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          usernames: [cleanHandle],
        }),
        signal: controller.signal,
      });
    } catch (error: unknown) {
      return {
        status: 'retryable_error',
        failure: {
          classification: 'retryable',
          statusCode: null,
          message: error instanceof Error ? error.message : 'Apify Instagram scrape request failed',
          raw: error,
        },
      };
    } finally {
      clearTimeout(timeout);
    }

    const rawText = await response.text();

    if (!response.ok) {
      const classification = classifyStatus(response.status);
      const failure: ApifyInstagramFailure = {
        classification,
        statusCode: response.status,
        message: `Apify Instagram scrape failed with status ${response.status}`,
        raw: parseJsonSafe(rawText),
      };
      return classification === 'retryable'
        ? { status: 'retryable_error', failure }
        : { status: 'terminal_error', failure };
    }

    const parsed = parseJsonSafe(rawText);
    const items = Array.isArray(parsed) ? parsed : [];

    return {
      status: 'success',
      data: extractFromItems(items),
    };
  }
}
