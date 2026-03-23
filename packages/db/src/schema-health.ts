import { query, type SqlQueryable } from './postgres.js';

// Keep the worker guard slightly narrower than API readiness: the worker can
// disable the legacy job-request dispatcher if `job_requests` is absent, while
// the API's admin discovery surface still queries that table directly.
const REQUIRED_TABLES_BY_SCOPE = {
  api: [
    'contact_recovery_items',
    'job_requests',
    'job_runs',
    'search_tasks',
  ],
  worker: [
    'contact_recovery_items',
    'job_runs',
    'search_tasks',
  ],
} as const;

const REQUIRED_ENUM_VALUES = [
  { enumName: 'ContactRecoveryReason', value: 'DECISION_MAKER_IDENTIFIED' },
  { enumName: 'CostEventProvider', value: 'GOOGLE_CUSTOM_SEARCH' },
] as const;

export type PipelineSchemaHealthScope = keyof typeof REQUIRED_TABLES_BY_SCOPE;

export interface PipelineSchemaHealth {
  status: 'ok' | 'fail';
  missingTables: string[];
  missingEnumValues: string[];
}

async function checkSchemaHealthForScope(
  scope: PipelineSchemaHealthScope,
  db: SqlQueryable = { query },
): Promise<PipelineSchemaHealth> {
  const requiredTables = REQUIRED_TABLES_BY_SCOPE[scope];
  const enumNames = REQUIRED_ENUM_VALUES.map((value) => value.enumName);
  const enumValues = REQUIRED_ENUM_VALUES.map((value) => value.value);

  const tableRows = await db.query<{ table_name: string }>(
    `
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name = any($1::text[])
    `,
    [requiredTables],
  );

  const enumRows = await db.query<{ enum_name: string; enum_value: string }>(
    `
      select requested.enum_name as enum_name, requested.enum_value as enum_value
      from unnest($1::text[], $2::text[]) as requested(enum_name, enum_value)
      join pg_type t on t.typname = requested.enum_name
      join pg_enum e
        on e.enumtypid = t.oid
       and e.enumlabel = requested.enum_value
    `,
    [enumNames, enumValues],
  );

  const presentTables = new Set(
    tableRows.rows.map((row: { table_name: string }) => row.table_name),
  );
  const presentEnumValues = new Set(
    enumRows.rows.map(
      (row: { enum_name: string; enum_value: string }) =>
        `${row.enum_name}:${row.enum_value}`,
    ),
  );

  const missingTables = requiredTables.filter((value) => !presentTables.has(value));
  const missingEnumValues = REQUIRED_ENUM_VALUES
    .map((value) => `${value.enumName}:${value.value}`)
    .filter((value) => !presentEnumValues.has(value));

  return {
    status: missingTables.length === 0 && missingEnumValues.length === 0 ? 'ok' : 'fail',
    missingTables,
    missingEnumValues,
  };
}

export async function checkPipelineSchemaHealth(
  db: SqlQueryable = { query },
): Promise<PipelineSchemaHealth> {
  return checkSchemaHealthForScope('api', db);
}

export async function checkWorkerSchemaHealth(
  db: SqlQueryable = { query },
): Promise<PipelineSchemaHealth> {
  return checkSchemaHealthForScope('worker', db);
}
