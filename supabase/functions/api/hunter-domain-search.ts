export interface EdgeHunterContact {
  email: string;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  type: "personal" | "generic" | null;
  confidence: number | null;
  verification: string | null;
}

export class HunterDomainSearchError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number | null,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "HunterDomainSearchError";
  }
}

interface HunterDomainSearchInput {
  apiKey: string;
  domain: string;
  baseUrl?: string | undefined;
  timeoutMs?: number | undefined;
  fetchImpl?: typeof fetch | undefined;
}

const DEFAULT_HUNTER_BASE_URL = "https://api.hunter.io/v2";
const DEFAULT_HUNTER_TIMEOUT_MS = 10_000;
const EXECUTIVE_KEYWORDS = [
  "owner",
  "founder",
  "ceo",
  "chief",
  "president",
  "managing director",
] as const;
const DIRECTOR_KEYWORDS = [
  "director",
  "head",
  "vp",
  "vice president",
  "principal",
  "partner",
] as const;
const MANAGER_KEYWORDS = ["manager", "lead", "supervisor"] as const;

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function resolveHunterQuotaLimit(
  value: string | undefined,
  fallback: number,
  maximum: number,
): number {
  const configured = Number(value);
  if (!Number.isInteger(configured) || configured < 1) return fallback;
  return Math.min(configured, maximum);
}

export function utcMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function positionRank(position: string | null): number {
  if (!position) return 99;
  const normalized = position.toLowerCase();
  if (EXECUTIVE_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return 0;
  }
  if (DIRECTOR_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return 1;
  }
  if (MANAGER_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return 2;
  }
  return 99;
}

export function normalizeHunterDomain(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  try {
    const parsed = new URL(
      normalized.includes("://") ? normalized : `https://${normalized}`,
    );
    return parsed.hostname.replace(/^www\./, "") || null;
  } catch {
    return normalized
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]
      ?.trim() || null;
  }
}

export function parseHunterDomainContacts(
  payload: unknown,
): EdgeHunterContact[] {
  const root = payload && typeof payload === "object"
    ? payload as Record<string, unknown>
    : {};
  const data = root.data && typeof root.data === "object"
    ? root.data as Record<string, unknown>
    : {};
  const emails = Array.isArray(data.emails) ? data.emails : [];

  const contacts = emails
    .map((entry): EdgeHunterContact | null => {
      if (!entry || typeof entry !== "object") return null;
      const row = entry as Record<string, unknown>;
      const email = normalizeString(row.value)?.toLowerCase() ?? null;
      if (!email || !email.includes("@")) return null;
      const verificationData =
        row.verification && typeof row.verification === "object"
          ? row.verification as Record<string, unknown>
          : null;

      return {
        email,
        firstName: normalizeString(row.first_name),
        lastName: normalizeString(row.last_name),
        position: normalizeString(row.position),
        type: row.type === "personal"
          ? "personal"
          : row.type === "generic"
          ? "generic"
          : null,
        confidence:
          typeof row.confidence === "number" && Number.isFinite(row.confidence)
            ? row.confidence
            : null,
        verification: normalizeString(
          verificationData?.status ?? row.verification,
        ),
      };
    })
    .filter((contact): contact is EdgeHunterContact => contact !== null);

  contacts.sort((left, right) => {
    const leftTypeRank = left.type === "personal"
      ? 0
      : left.type === "generic"
      ? 2
      : 1;
    const rightTypeRank = right.type === "personal"
      ? 0
      : right.type === "generic"
      ? 2
      : 1;
    if (leftTypeRank !== rightTypeRank) return leftTypeRank - rightTypeRank;
    return positionRank(left.position) - positionRank(right.position);
  });

  return contacts;
}

export async function searchHunterDomainContacts(
  input: HunterDomainSearchInput,
): Promise<EdgeHunterContact[]> {
  const domain = normalizeHunterDomain(input.domain);
  if (!input.apiKey.trim()) {
    throw new HunterDomainSearchError(
      "HUNTER_API_KEY is not configured",
      null,
      false,
    );
  }
  if (!domain) {
    throw new HunterDomainSearchError(
      "A valid company domain is required",
      null,
      false,
    );
  }

  const baseUrl = (input.baseUrl ?? DEFAULT_HUNTER_BASE_URL).replace(
    /\/+$/,
    "",
  );
  const url = new URL(`${baseUrl}/domain-search`);
  url.searchParams.set("api_key", input.apiKey);
  url.searchParams.set("domain", domain);
  url.searchParams.set("limit", "5");

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? DEFAULT_HUNTER_TIMEOUT_MS,
  );
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(url, {
      method: "GET",
      signal: controller.signal,
    });
  } catch (error: unknown) {
    throw new HunterDomainSearchError(
      error instanceof Error
        ? error.message
        : "Hunter domain search request failed",
      null,
      true,
    );
  } finally {
    clearTimeout(timeout);
  }

  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    throw new HunterDomainSearchError(
      `Hunter domain search failed with status ${response.status}`,
      response.status,
      response.status === 429 || response.status >= 500,
    );
  }

  return parseHunterDomainContacts(payload);
}
