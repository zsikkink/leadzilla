import { describe, expect, it } from 'vitest';

import { loadWorkerEnv } from './env.js';

const remoteSupabaseRuntimeUrl =
  'postgresql://postgres:postgres@db.cbcgrzvqidtrtrtnzlso.supabase.co:5432/postgres?sslmode=require';
const remoteSupabasePoolerUrl =
  'postgresql://postgres:postgres@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require&connection_limit=3';

describe('loadWorkerEnv', () => {
  it('parses required worker variables', () => {
    const env = loadWorkerEnv({
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5434/lead_flood',
      APP_ENV: 'test',
      LOG_LEVEL: 'debug',
      PG_BOSS_SCHEMA: 'pgboss',
      APOLLO_ENABLED: 'false',
      LINKEDIN_SCRAPE_ENABLED: 'false',
      COMPANY_SEARCH_ENABLED: 'true',
      PDL_ENABLED: 'false',
      HUNTER_ENABLED: 'true',
      DISCOVERY_ENABLED: 'false',
      SERPAPI_DISCOVERY_ENABLED: 'true',
      ENRICHMENT_ENABLED: 'true',
    });

    expect(env.DATABASE_URL).toContain('lead_flood');
    expect(env.APP_ENV).toBe('test');
    expect(env.LOG_LEVEL).toBe('debug');
    expect(env.APOLLO_ENABLED).toBe(false);
    expect(env.DISCOVERY_ENABLED).toBe(false);
    expect(env.SERPAPI_DISCOVERY_ENABLED).toBe(true);
    expect(env.SERPAPI_WEB_SEARCH_ENABLED).toBe(true);
    expect(env.DISCOVERY_SEARCH_PROVIDER).toBe('SERPAPI');
    expect(env.DISCOVERY_SCHEDULE_ENABLED).toBe(false);
    expect(env.DISCOVERY_STALE_JOB_MINUTES).toBe(10);
    expect(env.ENRICHMENT_ENABLED).toBe(true);
    expect(env.ENRICHMENT_DEFAULT_PROVIDER).toBe('HUNTER');
  });

  it('throws on missing DATABASE_URL', () => {
    expect(() => loadWorkerEnv({ APP_ENV: 'test' })).toThrowError(
      'Invalid worker environment configuration',
    );
  });

  it('accepts explicit SerpAPI discovery provider', () => {
    const env = loadWorkerEnv({
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5434/lead_flood',
      APP_ENV: 'test',
      DISCOVERY_SEARCH_PROVIDER: 'SERPAPI',
    });

    expect(env.DISCOVERY_SEARCH_PROVIDER).toBe('SERPAPI');
  });

  it('accepts explicit Google Places discovery provider', () => {
    const env = loadWorkerEnv({
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5434/lead_flood',
      APP_ENV: 'test',
      DISCOVERY_SEARCH_PROVIDER: 'GOOGLE_PLACES',
    });

    expect(env.DISCOVERY_SEARCH_PROVIDER).toBe('GOOGLE_PLACES');
  });

  it('uses default concurrency values', () => {
    const env = loadWorkerEnv({
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5434/lead_flood',
      APP_ENV: 'test',
    });

    expect(env.WORKER_PREQUALIFY_CONCURRENCY).toBe(5);
    expect(env.WORKER_CONVERT_CONCURRENCY).toBe(3);
    expect(env.WORKER_FEATURES_CONCURRENCY).toBe(5);
  });

  it('parses custom concurrency values', () => {
    const env = loadWorkerEnv({
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5434/lead_flood',
      APP_ENV: 'test',
      WORKER_PREQUALIFY_CONCURRENCY: '10',
      WORKER_CONVERT_CONCURRENCY: '5',
      WORKER_FEATURES_CONCURRENCY: '15',
    });

    expect(env.WORKER_PREQUALIFY_CONCURRENCY).toBe(10);
    expect(env.WORKER_CONVERT_CONCURRENCY).toBe(5);
    expect(env.WORKER_FEATURES_CONCURRENCY).toBe(15);
  });

  it('rejects concurrency values outside allowed range', () => {
    expect(() =>
      loadWorkerEnv({
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5434/lead_flood',
        APP_ENV: 'test',
        WORKER_PREQUALIFY_CONCURRENCY: '0',
      }),
    ).toThrowError('Invalid worker environment configuration');

    expect(() =>
      loadWorkerEnv({
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5434/lead_flood',
        APP_ENV: 'test',
        WORKER_CONVERT_CONCURRENCY: '11',
      }),
    ).toThrowError('Invalid worker environment configuration');
  });

  it('throws when legacy Google CSE env vars are present', () => {
    expect(() =>
      loadWorkerEnv({
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5434/lead_flood',
        APP_ENV: 'test',
        GOOGLE_SEARCH_API_KEY: 'legacy-key',
      }),
    ).toThrowError('Google CSE is deprecated and not supported');
  });

  it('allows localhost postgres urls in ci app env for built-runtime validation', () => {
    expect(() =>
      loadWorkerEnv({
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5434/lead_flood_release_runtime',
        APP_ENV: 'ci',
        NODE_ENV: 'production',
      }),
    ).not.toThrow();
  });

  it('rejects localhost postgres urls outside ci/test validation', () => {
    expect(() =>
      loadWorkerEnv({
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5434/lead_flood',
        APP_ENV: 'local',
        NODE_ENV: 'production',
      }),
    ).toThrow(/configured for remote Supabase only/);
  });

  it('allows IPv6 localhost postgres urls outside ci/test when explicitly opted into local runtime', () => {
    expect(() =>
      loadWorkerEnv({
        DATABASE_URL: 'postgresql://postgres:postgres@[::1]:5434/lead_flood',
        APP_ENV: 'local',
        NODE_ENV: 'production',
        ALLOW_LOCAL_DATABASE_URL: 'true',
      }),
    ).not.toThrow();
  });

  it('rejects non-Supabase postgres hosts outside ci/test validation', () => {
    expect(() =>
      loadWorkerEnv({
        DATABASE_URL: 'postgresql://postgres:postgres@db.example.com:5432/postgres?sslmode=require',
        APP_ENV: 'local',
        NODE_ENV: 'production',
      }),
    ).toThrow(/expected a Supabase Postgres host/);
  });

  it('still rejects non-Supabase non-local hosts when local runtime is explicitly allowed', () => {
    expect(() =>
      loadWorkerEnv({
        DATABASE_URL: 'postgresql://postgres:postgres@db.example.com:5432/postgres?sslmode=require',
        APP_ENV: 'local',
        NODE_ENV: 'production',
        ALLOW_LOCAL_DATABASE_URL: 'true',
      }),
    ).toThrow(/expected a Supabase Postgres host/);
  });

  it('rejects remote Supabase urls without sslmode=require outside ci/test validation', () => {
    expect(() =>
      loadWorkerEnv({
        DATABASE_URL: 'postgresql://postgres:postgres@db.cbcgrzvqidtrtrtnzlso.supabase.co:5432/postgres',
        APP_ENV: 'local',
        NODE_ENV: 'production',
      }),
    ).toThrow(/sslmode=require/);
  });

  it('rejects Supabase pooler urls without connection_limit outside ci/test validation', () => {
    expect(() =>
      loadWorkerEnv({
        DATABASE_URL:
          'postgresql://postgres:postgres@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require',
        APP_ENV: 'local',
        NODE_ENV: 'production',
      }),
    ).toThrow(/connection_limit=3/);
  });

  it('accepts a valid remote Supabase runtime DATABASE_URL outside ci/test validation', () => {
    expect(() =>
      loadWorkerEnv({
        DATABASE_URL: remoteSupabaseRuntimeUrl,
        APP_ENV: 'local',
        NODE_ENV: 'production',
      }),
    ).not.toThrow();

    expect(() =>
      loadWorkerEnv({
        DATABASE_URL: remoteSupabasePoolerUrl,
        APP_ENV: 'local',
        NODE_ENV: 'production',
      }),
    ).not.toThrow();
  });

  it('treats blank optional provider and notification vars as unset', () => {
    const env = loadWorkerEnv({
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5434/lead_flood',
      APP_ENV: 'test',
      OPENAI_API_KEY: '',
      RESEND_API_KEY: '',
      TRENGO_API_KEY: '',
      TRENGO_CHANNEL_ID: '',
      TRENGO_TEMPLATE_ID: '',
      TRENGO_INTERNAL_CONVERSATION_ID: '',
      SLACK_WEBHOOK_URL: '',
      SALES_NOTIFICATION_EMAIL: '',
      SERPAPI_API_KEY: '',
    });

    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.RESEND_API_KEY).toBeUndefined();
    expect(env.TRENGO_API_KEY).toBeUndefined();
    expect(env.TRENGO_CHANNEL_ID).toBeUndefined();
    expect(env.TRENGO_TEMPLATE_ID).toBeUndefined();
    expect(env.TRENGO_INTERNAL_CONVERSATION_ID).toBeUndefined();
    expect(env.SLACK_WEBHOOK_URL).toBeUndefined();
    expect(env.SALES_NOTIFICATION_EMAIL).toBeUndefined();
    expect(env.SERPAPI_API_KEY).toBeUndefined();
  });
});
