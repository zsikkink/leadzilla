import { query, type SqlQueryable } from './postgres.js';

const REQUIRED_TABLES = ['contact_recovery_items'] as const;
const REQUIRED_ENUM_VALUES = [
  { enumName: 'CostEventProvider', value: 'GOOGLE_CUSTOM_SEARCH' },
] as const;

export interface PipelineSchemaHealth {
  status: 'ok' | 'fail';
  missingTables: string[];
  missingEnumValues: string[];
}

export async function checkPipelineSchemaHealth(
  db: SqlQueryable = { query },
): Promise<PipelineSchemaHealth> {
  const tableRows = await db.query<{ table_name: string }>(
    `
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name = any($1::text[])
    `,
    [REQUIRED_TABLES],
  );

  const enumRows = await db.query<{ enum_name: string; enum_value: string }>(
    `
      select t.typname as enum_name, e.enumlabel as enum_value
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
      where (t.typname = $1 and e.enumlabel = $2)
    `,
    [REQUIRED_ENUM_VALUES[0].enumName, REQUIRED_ENUM_VALUES[0].value],
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

  const missingTables = REQUIRED_TABLES.filter((value) => !presentTables.has(value));
  const missingEnumValues = REQUIRED_ENUM_VALUES
    .map((value) => `${value.enumName}:${value.value}`)
    .filter((value) => !presentEnumValues.has(value));

  return {
    status: missingTables.length === 0 && missingEnumValues.length === 0 ? 'ok' : 'fail',
    missingTables,
    missingEnumValues,
  };
}
