import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  bossMock,
  buildServerMock,
  loggerMock,
  prismaMock,
  processOnMock,
  processExitMock,
  txMock,
} = vi.hoisted(() => {
  const bossMock = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    createQueue: vi.fn(async () => undefined),
    send: vi.fn(async () => 'ok'),
  };

  const serverMock = {
    listen: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };

  return {
    bossMock,
    buildServerMock: vi.fn(() => serverMock),
    loggerMock: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    prismaMock: {
      $transaction: vi.fn(),
      $disconnect: vi.fn(async () => undefined),
      jobExecution: {
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      outboxEvent: {
        update: vi.fn(async () => undefined),
      },
    },
    processOnMock: vi.fn(() => process),
    processExitMock: vi.fn(() => undefined),
    serverMock,
    txMock: {
      lead: {
        create: vi.fn(async () => ({ id: 'lead_1' })),
      },
      jobExecution: {
        create: vi.fn(async () => ({ id: 'job_1' })),
      },
      outboxEvent: {
        create: vi.fn(async () => ({ id: 'outbox_1' })),
      },
    },
  };
});

vi.mock('pg-boss', () => ({
  default: vi.fn(() => bossMock),
}));

vi.mock('@lead-flood/db', () => ({
  assertDatabaseConnection: vi.fn(async () => undefined),
  checkPipelineSchemaHealth: vi.fn(async () => ({
    status: 'ok',
    missingTables: [],
    missingEnumValues: [],
  })),
  prisma: prismaMock,
  query: vi.fn(),
  toInputJson: (value: unknown) => value,
}));

vi.mock('@lead-flood/observability', () => ({
  createLogger: vi.fn(() => loggerMock),
}));

vi.mock('./auth/supabase.js', () => ({
  buildSupabaseAccessTokenVerifier: vi.fn(() => vi.fn(async () => ({ sub: 'user_1' }))),
}));

vi.mock('./env.js', () => ({
  loadApiEnv: vi.fn(() => ({
    APP_ENV: 'test',
    LOG_LEVEL: 'error',
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5434/lead_flood',
    DIRECT_URL: 'postgresql://postgres:postgres@localhost:5434/lead_flood',
    PG_BOSS_SCHEMA: 'pgboss',
    API_PORT: 5051,
    SUPABASE_JWT_ISSUER: 'https://example.supabase.co/auth/v1',
    SUPABASE_JWT_AUDIENCE: 'authenticated',
  })),
}));

vi.mock('./server.js', () => ({
  LeadAlreadyExistsError: class LeadAlreadyExistsError extends Error {},
  LeadContextUnavailableError: class LeadContextUnavailableError extends Error {},
  buildServer: buildServerMock,
}));

describe('features.compute immediate publish', () => {
  const originalProcessOn = process.on;
  const originalProcessExit = process.exit;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof txMock) => Promise<unknown>) => callback(txMock));
    process.on = processOnMock as typeof process.on;
    process.exit = processExitMock as unknown as typeof process.exit;
  });

  afterEach(() => {
    process.on = originalProcessOn;
    process.exit = originalProcessExit;
  });

  it('marks tracked features.compute jobs running after immediate publish succeeds', async () => {
    await import('./index.js');

    await vi.waitFor(() => {
      expect(buildServerMock).toHaveBeenCalledTimes(1);
    });

    const buildServerOptions = (buildServerMock.mock.calls[0] as Array<unknown> | undefined)?.[0] as
      | {
          createLeadAndEnqueue?: (input: {
            firstName: string;
            lastName: string;
            email: string;
            source: string;
            icpProfileId?: string;
          }) => Promise<unknown>;
        }
      | undefined;
    expect(buildServerOptions).toBeDefined();
    if (!buildServerOptions) {
      throw new Error('Expected buildServer to be called');
    }

    const createLeadAndEnqueue = buildServerOptions.createLeadAndEnqueue;
    expect(createLeadAndEnqueue).toBeDefined();
    if (!createLeadAndEnqueue) {
      throw new Error('Expected createLeadAndEnqueue to be defined');
    }

    await createLeadAndEnqueue({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      source: 'test',
      icpProfileId: 'icp_1',
    });

    expect(bossMock.send).toHaveBeenCalledWith(
      'features.compute',
      {
        leadId: 'lead_1',
        icpProfileId: 'icp_1',
        snapshotVersion: 1,
        runId: 'job_1',
      },
      expect.objectContaining({
        singletonKey: 'features.compute:lead_1:icp_1:1',
      }),
    );
    expect(prismaMock.jobExecution.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'job_1',
        type: 'features.compute',
        status: 'queued',
      },
      data: {
        status: 'running',
        startedAt: expect.any(Date),
        error: null,
      },
    });
    expect(prismaMock.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'outbox_1' },
      data: {
        status: 'sent',
        attempts: {
          increment: 1,
        },
        processedAt: expect.any(Date),
        nextAttemptAt: null,
        lastError: null,
      },
    });

    const trackedRunUpdateOrder = prismaMock.jobExecution.updateMany.mock.invocationCallOrder[0];
    const outboxSentUpdateOrder = prismaMock.outboxEvent.update.mock.invocationCallOrder[0];
    expect(trackedRunUpdateOrder).toBeDefined();
    expect(outboxSentUpdateOrder).toBeDefined();
    expect(trackedRunUpdateOrder!).toBeLessThan(outboxSentUpdateOrder!);
  });
});
