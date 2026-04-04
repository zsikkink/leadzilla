import type { MessagingSendJobPayload } from './modules/messaging/messaging.service.js';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  bossCreateQueueMock,
  bossSendMock,
  bossStartMock,
  bossStopMock,
  buildServerOptionsRef,
  buildServerMock,
  loggerMock,
  outboxEventUpdateMock,
  prismaDisconnectMock,
  processOnMock,
} = vi.hoisted(() => {
  const bossCreateQueueMock = vi.fn(async (_name: string, _options?: unknown) => undefined);
  const bossSendMock = vi.fn(
    async (_name: string, _payload?: unknown, _options?: Record<string, unknown>) => undefined,
  );
  const bossStartMock = vi.fn(async () => undefined);
  const bossStopMock = vi.fn(async () => undefined);
  const buildServerOptionsRef = {
    current: null as { enqueueMessageSend?: ((payload: MessagingSendJobPayload) => Promise<void>) | undefined } | null,
  };
  const loggerMock = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const outboxEventUpdateMock = vi.fn(async () => undefined);
  const prismaDisconnectMock = vi.fn(async () => undefined);
  const processOnMock = vi.fn(() => process);
  const serverCloseMock = vi.fn(async () => undefined);
  const serverListenMock = vi.fn(async () => undefined);
  const buildServerMock = vi.fn((options: { enqueueMessageSend?: (payload: MessagingSendJobPayload) => Promise<void> }) => {
    buildServerOptionsRef.current = options;
    return {
      listen: serverListenMock,
      close: serverCloseMock,
    };
  });

  return {
    bossCreateQueueMock,
    bossSendMock,
    bossStartMock,
    bossStopMock,
    buildServerOptionsRef,
    buildServerMock,
    loggerMock,
    outboxEventUpdateMock,
    prismaDisconnectMock,
    processOnMock,
  };
});

vi.mock('pg-boss', () => ({
  default: class PgBossMock {
    start = bossStartMock;
    createQueue = bossCreateQueueMock;
    send = bossSendMock;
    stop = bossStopMock;
  },
}));

vi.mock('@lead-flood/db', () => ({
  assertDatabaseConnection: vi.fn(async () => undefined),
  checkPipelineSchemaHealth: vi.fn(async () => ({ status: 'pass', missingTables: [], missingEnumValues: [] })),
  prisma: {
    outboxEvent: {
      update: outboxEventUpdateMock,
    },
    $disconnect: prismaDisconnectMock,
  },
  query: vi.fn(async () => ({ rows: [] })),
  toInputJson: (value: unknown) => value,
}));

vi.mock('@lead-flood/observability', () => ({
  createLogger: vi.fn(() => loggerMock),
}));

vi.mock('./auth/supabase.js', () => ({
  buildSupabaseAccessTokenVerifier: vi.fn(() => vi.fn()),
}));

vi.mock('./env.js', () => ({
  loadApiEnv: vi.fn(() => ({
    SUPABASE_JWT_ISSUER: 'https://example.supabase.co/auth/v1',
    SUPABASE_JWT_AUDIENCE: 'authenticated',
    APP_ENV: 'test',
    LOG_LEVEL: 'error',
    DATABASE_URL: 'postgres://lead-flood.test/db',
    PG_BOSS_SCHEMA: 'pgboss',
    API_PORT: 3000,
    CORS_ORIGIN: 'http://localhost:3000',
  })),
}));

vi.mock('./server.js', () => ({
  buildServer: buildServerMock,
  LeadAlreadyExistsError: class LeadAlreadyExistsError extends Error {},
  LeadContextUnavailableError: class LeadContextUnavailableError extends Error {},
}));

function getEnqueueMessageSend(): (payload: MessagingSendJobPayload) => Promise<void> {
  const enqueueMessageSend = buildServerOptionsRef.current?.enqueueMessageSend;
  if (!enqueueMessageSend) {
    throw new Error('Expected API bootstrap to register enqueueMessageSend');
  }

  return enqueueMessageSend;
}

function getBossSendOptions(): Record<string, unknown> | undefined {
  return vi.mocked(bossSendMock).mock.calls.at(0)?.[2];
}

describe('publishMessageSend scheduling', () => {
  let restoreProcessOn: (() => void) | null = null;

  beforeAll(async () => {
    const processOnSpy = vi.spyOn(process, 'on');
    processOnSpy.mockImplementation(processOnMock as typeof process.on);
    restoreProcessOn = () => processOnSpy.mockRestore();

    await import('./index.js');

    await vi.waitFor(() => {
      expect(buildServerOptionsRef.current?.enqueueMessageSend).toBeTypeOf('function');
    });
  });

  afterAll(() => {
    restoreProcessOn?.();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T12:00:00.000Z'));
    outboxEventUpdateMock.mockResolvedValue(undefined);
    bossSendMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('defers no-outbox re-enqueue publishes when scheduledAt is in the future', async () => {
    await getEnqueueMessageSend()({
      runId: 'send_existing',
      sendId: 'send_existing',
      messageDraftId: 'draft_1',
      messageVariantId: 'variant_1',
      idempotencyKey: 'approve:draft_1:variant_1',
      channel: 'EMAIL',
      scheduledAt: '2026-03-29T12:05:00.000Z',
    });

    expect(bossSendMock).toHaveBeenCalledWith(
      'message.send',
      expect.objectContaining({
        runId: 'send_existing',
        sendId: 'send_existing',
      }),
      expect.objectContaining({
        singletonKey: 'message.send:send_existing',
        retryLimit: 5,
        retryDelay: 90,
        retryBackoff: true,
        startAfter: new Date('2026-03-29T12:05:00.000Z'),
      }),
    );
    expect(outboxEventUpdateMock).not.toHaveBeenCalled();
  });

  it('keeps no-outbox publishes immediate when scheduledAt is absent', async () => {
    await getEnqueueMessageSend()({
      runId: 'send_existing',
      sendId: 'send_existing',
      messageDraftId: 'draft_1',
      messageVariantId: 'variant_1',
      idempotencyKey: 'approve:draft_1:variant_1',
      channel: 'EMAIL',
    });

    const sendOptions = getBossSendOptions();
    expect(sendOptions).toMatchObject({
      singletonKey: 'message.send:send_existing',
      retryLimit: 5,
      retryDelay: 90,
      retryBackoff: true,
    });
    expect(sendOptions).not.toHaveProperty('startAfter');
    expect(outboxEventUpdateMock).not.toHaveBeenCalled();
  });

  it('defers outbox-backed publishes when scheduledAt is in the future', async () => {
    await getEnqueueMessageSend()({
      runId: 'message.send:send_new',
      sendId: 'send_new',
      messageDraftId: 'draft_1',
      messageVariantId: 'variant_1',
      idempotencyKey: 'ui:draft_1:variant_1:new',
      channel: 'EMAIL',
      outboxEventId: 'outbox_1',
      scheduledAt: '2026-03-29T12:05:00.000Z',
    });

    expect(bossSendMock).toHaveBeenCalledWith(
      'message.send',
      expect.objectContaining({
        runId: 'message.send:send_new',
        sendId: 'send_new',
      }),
      expect.objectContaining({
        singletonKey: 'message.send:send_new',
        retryLimit: 5,
        retryDelay: 90,
        retryBackoff: true,
        startAfter: new Date('2026-03-29T12:05:00.000Z'),
      }),
    );
    expect(outboxEventUpdateMock).toHaveBeenCalledWith({
      where: { id: 'outbox_1' },
      data: expect.objectContaining({
        status: 'sent',
      }),
    });
  });

  it('keeps outbox-backed publishes immediate when scheduledAt is not in the future', async () => {
    await getEnqueueMessageSend()({
      runId: 'message.send:send_new',
      sendId: 'send_new',
      messageDraftId: 'draft_1',
      messageVariantId: 'variant_1',
      idempotencyKey: 'ui:draft_1:variant_1:new',
      channel: 'EMAIL',
      outboxEventId: 'outbox_1',
      scheduledAt: '2026-03-29T11:55:00.000Z',
    });

    const sendOptions = getBossSendOptions();
    expect(sendOptions).toMatchObject({
      singletonKey: 'message.send:send_new',
      retryLimit: 5,
      retryDelay: 90,
      retryBackoff: true,
    });
    expect(sendOptions).not.toHaveProperty('startAfter');
    expect(outboxEventUpdateMock).toHaveBeenCalledWith({
      where: { id: 'outbox_1' },
      data: expect.objectContaining({
        status: 'sent',
      }),
    });
  });
});
