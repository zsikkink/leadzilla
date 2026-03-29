import { z } from 'zod';
import { validateSupabaseRuntimeDatabaseUrl } from '@lead-flood/db/runtime-database-url-policy';

const LEGACY_GOOGLE_CSE_ENV_KEYS = [
  'GOOGLE_SEARCH_ENABLED',
  'GOOGLE_SEARCH_API_KEY',
  'GOOGLE_SEARCH_ENGINE_ID',
  'GOOGLE_SEARCH_BASE_URL',
  'GOOGLE_SEARCH_RATE_LIMIT_MS',
  'GOOGLE_CSE_API_KEY',
  'GOOGLE_CSE_ENGINE_ID',
  'GOOGLE_CSE_BASE_URL',
  'GOOGLE_CUSTOM_SEARCH_API_KEY',
  'GOOGLE_CUSTOM_SEARCH_ENGINE_ID',
  'CUSTOMSEARCH_API_KEY',
  'CUSTOMSEARCH_ENGINE_ID',
] as const;

const optionalNonEmptyString = () =>
  z.preprocess((value) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length === 0 ? undefined : trimmed;
    }
    return value;
  }, z.string().min(1).optional());

const optionalUrlString = () =>
  z.preprocess((value) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length === 0 ? undefined : trimmed;
    }
    return value;
  }, z.string().url().optional());

function findLegacyGoogleCseEnvKeys(source: NodeJS.ProcessEnv): string[] {
  const explicitMatches = LEGACY_GOOGLE_CSE_ENV_KEYS.filter((key) => key in source);
  const inferredMatches = Object.keys(source).filter((key) =>
    key.toUpperCase().includes('CUSTOMSEARCH'),
  );
  return Array.from(new Set([...explicitMatches, ...inferredMatches]));
}

const ApiEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.string().min(1).default('local'),
  API_PORT: z.coerce.number().int().positive().default(5050),
  CORS_ORIGIN: z.string().url().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  PG_BOSS_SCHEMA: z.string().min(1).default('pgboss'),
  DATABASE_URL: z
    .string()
    .min(
      1,
      'DATABASE_URL is required; set it to the remote Supabase runtime connection string',
    ),
  DIRECT_URL: z
    .string()
    .min(1, 'DIRECT_URL is required; set it to the Supabase direct or pooled connection string'),
  SUPABASE_PROJECT_REF: optionalNonEmptyString(),
  SUPABASE_JWT_ISSUER: optionalUrlString(),
  SUPABASE_JWT_AUDIENCE: optionalNonEmptyString(),
  APOLLO_ENABLED: z.coerce.boolean().optional(),
  APOLLO_API_KEY: optionalNonEmptyString(),
  LINKEDIN_SCRAPE_ENABLED: z.coerce.boolean().optional(),
  LINKEDIN_SCRAPE_API_KEY: optionalNonEmptyString(),
  LINKEDIN_SCRAPE_ENDPOINT: optionalUrlString(),
  COMPANY_SEARCH_ENABLED: z.coerce.boolean().optional(),
  PDL_ENABLED: z.coerce.boolean().optional(),
  PDL_API_KEY: optionalNonEmptyString(),
  HUNTER_ENABLED: z.coerce.boolean().optional(),
  HUNTER_API_KEY: optionalNonEmptyString(),
  CLEARBIT_ENABLED: z.coerce.boolean().optional(),
  CLEARBIT_API_KEY: optionalNonEmptyString(),
  DISCOVERY_ENABLED: z.coerce.boolean().optional(),
  ENRICHMENT_ENABLED: z.coerce.boolean().optional(),
  OPENAI_API_KEY: optionalNonEmptyString(),
  OPENAI_GENERATION_MODEL: optionalNonEmptyString(),
  TRENGO_WEBHOOK_SECRET: optionalNonEmptyString(),
  RESEND_WEBHOOK_SECRET: optionalNonEmptyString(),
  ADMIN_API_KEY: optionalNonEmptyString(),
  DISCOVERY_MAX_RUNS_PER_DAY: z.coerce.number().int().min(1).optional(),
  DISCOVERY_MAX_CONCURRENT_RUNS: z.coerce.number().int().min(1).optional(),
  DISCOVERY_MAX_LEADS_PER_RUN: z.coerce.number().int().min(1).optional(),
});

export type ApiEnv = z.infer<typeof ApiEnvSchema>;

const API_RUNTIME_DATABASE_URL_VALIDATION = {
  invalidConfigurationLabel: 'Invalid API environment configuration',
  servicePath: 'apps/api',
  poolerConnectionLimitContext: 'API runtime stability',
} as const;

function withPortFallback(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (source.API_PORT || !source.PORT) {
    return source;
  }

  return {
    ...source,
    API_PORT: source.PORT,
  };
}

export function loadApiEnv(source: NodeJS.ProcessEnv): ApiEnv {
  const legacyGoogleCseKeys = findLegacyGoogleCseEnvKeys(source);
  if (legacyGoogleCseKeys.length > 0) {
    throw new Error(
      `Google CSE is deprecated and not supported in this repository. Remove legacy env vars: ${legacyGoogleCseKeys.join(
        ', ',
      )}`,
    );
  }

  const parsed = ApiEnvSchema.safeParse(withPortFallback(source));

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid API environment configuration:\n${issues.join('\n')}`);
  }

  validateSupabaseRuntimeDatabaseUrl(
    'DATABASE_URL',
    parsed.data.DATABASE_URL,
    parsed.data,
    API_RUNTIME_DATABASE_URL_VALIDATION,
  );
  validateSupabaseRuntimeDatabaseUrl(
    'DIRECT_URL',
    parsed.data.DIRECT_URL,
    parsed.data,
    API_RUNTIME_DATABASE_URL_VALIDATION,
  );

  const hasIssuer = !!parsed.data.SUPABASE_JWT_ISSUER;
  const hasProjectRef = !!parsed.data.SUPABASE_PROJECT_REF;
  if (!hasIssuer && !hasProjectRef) {
    throw new Error(
      'Invalid API environment configuration:\nSUPABASE_JWT_ISSUER or SUPABASE_PROJECT_REF is required for Supabase JWT verification',
    );
  }

  if (parsed.data.APP_ENV !== 'local') {
    const jwtAccessSecret = source.JWT_ACCESS_SECRET;
    const jwtRefreshSecret = source.JWT_REFRESH_SECRET;
    if (
      (typeof jwtAccessSecret === 'string' && jwtAccessSecret.includes('please-change')) ||
      (typeof jwtRefreshSecret === 'string' && jwtRefreshSecret.includes('please-change'))
    ) {
      throw new Error(
        'JWT_ACCESS_SECRET / JWT_REFRESH_SECRET must be changed from placeholder values in non-local environments',
      );
    }
  }

  return parsed.data;
}
