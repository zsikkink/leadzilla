const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const SUPABASE_HOST_SUFFIXES = ['.supabase.co', '.supabase.com'] as const;

export type RuntimeDatabaseUrlName = 'DATABASE_URL' | 'DIRECT_URL';

export interface RuntimeDatabaseUrlValidationSource {
  APP_ENV: string;
  NODE_ENV: string;
  ALLOW_LOCAL_DATABASE_URL?: boolean;
}

export interface RuntimeDatabaseUrlValidationOptions {
  invalidConfigurationLabel: string;
  servicePath: string;
  poolerConnectionLimitContext: string;
}

function buildInvalidConfigurationError(
  invalidConfigurationLabel: string,
  name: RuntimeDatabaseUrlName,
  message: string,
): Error {
  return new Error(`${invalidConfigurationLabel}:\n${name}: ${message}`);
}

function parseDatabaseUrl(
  name: RuntimeDatabaseUrlName,
  value: string,
  invalidConfigurationLabel: string,
): URL {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw buildInvalidConfigurationError(
      invalidConfigurationLabel,
      name,
      'must be a valid postgres connection string',
    );
  }

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw buildInvalidConfigurationError(
      invalidConfigurationLabel,
      name,
      'must use the postgres:// or postgresql:// protocol',
    );
  }

  return parsed;
}

function isSupabaseHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return SUPABASE_HOST_SUFFIXES.some(
    (suffix) => normalized === suffix.slice(1) || normalized.endsWith(suffix),
  );
}

function normalizeDatabaseHostname(hostname: string): string {
  const normalized = hostname.toLowerCase();
  return normalized === '[::1]' ? '::1' : normalized;
}

export function validateSupabaseRuntimeDatabaseUrl(
  name: RuntimeDatabaseUrlName,
  value: string,
  source: RuntimeDatabaseUrlValidationSource,
  options: RuntimeDatabaseUrlValidationOptions,
): void {
  if (source.APP_ENV === 'test' || source.APP_ENV === 'ci' || source.NODE_ENV === 'test') {
    return;
  }

  const parsed = parseDatabaseUrl(name, value, options.invalidConfigurationLabel);
  const hostname = normalizeDatabaseHostname(parsed.hostname);

  if (LOCAL_DATABASE_HOSTS.has(hostname)) {
    if (source.ALLOW_LOCAL_DATABASE_URL === true) {
      return;
    }

    throw buildInvalidConfigurationError(
      options.invalidConfigurationLabel,
      name,
      `${options.servicePath} is configured for remote Supabase only. Replace the localhost lead_flood URL with the remote Supabase connection string in ${options.servicePath}/.env.local or Railway service variables.`,
    );
  }

  if (!isSupabaseHost(hostname)) {
    throw buildInvalidConfigurationError(
      options.invalidConfigurationLabel,
      name,
      `expected a Supabase Postgres host, received "${parsed.hostname}"`,
    );
  }

  if (parsed.searchParams.get('sslmode') !== 'require') {
    throw buildInvalidConfigurationError(
      options.invalidConfigurationLabel,
      name,
      'remote Supabase URLs must include sslmode=require',
    );
  }

  const isSupabasePooler = hostname.includes('pooler.supabase.com');
  if (name === 'DATABASE_URL' && isSupabasePooler && !parsed.searchParams.get('connection_limit')) {
    throw buildInvalidConfigurationError(
      options.invalidConfigurationLabel,
      'DATABASE_URL',
      `Supabase pooler URLs should include connection_limit=3 for ${options.poolerConnectionLimitContext}`,
    );
  }
}
