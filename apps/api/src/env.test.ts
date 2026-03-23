import { describe, expect, it } from 'vitest';

import { loadApiEnv } from './env.js';

const baseEnv = {
  API_PORT: '5050',
  CORS_ORIGIN: 'http://localhost:3000',
  LOG_LEVEL: 'info',
  PG_BOSS_SCHEMA: 'pgboss',
  SUPABASE_PROJECT_REF: 'cbcgrzvqidtrtrtnzlso',
  JWT_ACCESS_SECRET: 'ci-access-secret-ci-access-secret',
  JWT_REFRESH_SECRET: 'ci-refresh-secret-ci-refresh-secret',
} as const;

describe('loadApiEnv', () => {
  it('allows localhost postgres urls in ci app env for built-runtime validation', () => {
    expect(() =>
      loadApiEnv({
        ...baseEnv,
        APP_ENV: 'ci',
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5434/lead_flood_release_runtime',
        DIRECT_URL: 'postgresql://postgres:postgres@localhost:5434/lead_flood_release_runtime',
      }),
    ).not.toThrow();
  });

  it('still rejects localhost postgres urls outside ci/test validation', () => {
    expect(() =>
      loadApiEnv({
        ...baseEnv,
        APP_ENV: 'local',
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5434/lead_flood',
        DIRECT_URL: 'postgresql://postgres:postgres@localhost:5434/lead_flood',
      }),
    ).toThrow(/configured for remote Supabase only/);
  });
});
