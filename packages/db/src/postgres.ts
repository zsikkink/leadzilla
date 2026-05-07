import { Client, Pool, type PoolClient, type PoolConfig, type QueryResult, type QueryResultRow } from 'pg';

const DEFAULT_POOL_MAX = 1;
const DEFAULT_IDLE_TIMEOUT_MS = 10_000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000;

type QueryParams = readonly unknown[];

const globalForPostgres = globalThis as unknown as {
  leadFloodPgPool?: Pool;
};

export interface SqlQueryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: QueryParams,
  ): Promise<QueryResult<T>>;
}

export interface PgNotificationPayload {
  channel: string;
  payload?: string | undefined;
}

export interface PgNotificationSubscription {
  close(): Promise<void>;
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toQueryValues(values?: QueryParams): unknown[] | undefined {
  return values ? [...values] : undefined;
}

function createSqlQueryable(client: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>): SqlQueryable {
  return {
    query(text, values) {
      return client.query(text, toQueryValues(values));
    },
  };
}

function buildPoolConfig(): PoolConfig {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to create the shared Postgres pool');
  }

  return {
    connectionString,
    max: readPositiveIntEnv('PG_POOL_MAX', DEFAULT_POOL_MAX),
    idleTimeoutMillis: readPositiveIntEnv('PG_POOL_IDLE_TIMEOUT_MS', DEFAULT_IDLE_TIMEOUT_MS),
    connectionTimeoutMillis: readPositiveIntEnv(
      'PG_POOL_CONNECTION_TIMEOUT_MS',
      DEFAULT_CONNECTION_TIMEOUT_MS,
    ),
    allowExitOnIdle: process.env.NODE_ENV === 'test',
  };
}

function buildDedicatedClientConfig(): PoolConfig {
  const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DIRECT_URL or DATABASE_URL is required to create a dedicated Postgres client');
  }

  return {
    connectionString,
    connectionTimeoutMillis: readPositiveIntEnv(
      'PG_LISTEN_CONNECTION_TIMEOUT_MS',
      DEFAULT_CONNECTION_TIMEOUT_MS,
    ),
  };
}

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
    throw new Error(`Invalid Postgres identifier: ${identifier}`);
  }
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function getPgPool(): Pool {
  if (globalForPostgres.leadFloodPgPool) {
    return globalForPostgres.leadFloodPgPool;
  }

  const pool = new Pool(buildPoolConfig());
  globalForPostgres.leadFloodPgPool = pool;
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: QueryParams,
): Promise<QueryResult<T>> {
  return getPgPool().query<T>(text, toQueryValues(values));
}

export async function listenToPgChannel(
  channel: string,
  onNotification: (notification: PgNotificationPayload) => void,
  onError?: ((error: Error) => void) | undefined,
): Promise<PgNotificationSubscription> {
  const client = new Client(buildDedicatedClientConfig());
  const quotedChannel = quoteIdentifier(channel);

  client.on('notification', (notification) => {
    onNotification({
      channel: notification.channel,
      payload: notification.payload ?? undefined,
    });
  });

  if (onError) {
    client.on('error', onError);
  }

  await client.connect();
  await client.query(`LISTEN ${quotedChannel}`);

  return {
    async close() {
      try {
        await client.query(`UNLISTEN ${quotedChannel}`);
      } catch {
        // Closing is best-effort; end the socket below either way.
      }
      await client.end().catch(() => undefined);
    },
  };
}

export async function withTransaction<T>(
  fn: (tx: SqlQueryable) => Promise<T>,
): Promise<T> {
  const client = await getPgPool().connect();

  try {
    await client.query('BEGIN');
    const result = await fn(createSqlQueryable(client));
    await client.query('COMMIT');
    return result;
  } catch (error: unknown) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original failure for callers/logging.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function assertDatabaseConnection(
  db: SqlQueryable = createSqlQueryable(getPgPool()),
): Promise<void> {
  await db.query('select 1');
}
