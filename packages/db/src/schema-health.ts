import { Prisma } from '@prisma/client';

import { prisma } from './client.js';

const REQUIRED_TABLES = ['contact_recovery_items'] as const;
const REQUIRED_ENUM_VALUES = [
  { enumName: 'CostEventProvider', value: 'GOOGLE_CUSTOM_SEARCH' },
] as const;

export interface PipelineSchemaHealth {
  status: 'ok' | 'fail';
  missingTables: string[];
  missingEnumValues: string[];
}

type RawQueryable = Pick<typeof prisma, '$queryRaw'>;

export async function checkPipelineSchemaHealth(
  db: RawQueryable = prisma,
): Promise<PipelineSchemaHealth> {
  const tableRows = await db.$queryRaw<Array<{ table_name: string }>>(Prisma.sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'contact_recovery_items'
  `);

  const enumRows = await db.$queryRaw<Array<{ enum_name: string; enum_value: string }>>(Prisma.sql`
    select t.typname as enum_name, e.enumlabel as enum_value
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    where (t.typname = 'CostEventProvider' and e.enumlabel = 'GOOGLE_CUSTOM_SEARCH')
  `);

  const presentTables = new Set(tableRows.map((row) => row.table_name));
  const presentEnumValues = new Set(enumRows.map((row) => `${row.enum_name}:${row.enum_value}`));

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
