import { describe, expect, it, vi } from 'vitest';

import { checkPipelineSchemaHealth } from './schema-health.js';
import type { SqlQueryable } from './postgres.js';

function createQueryable(
  tableRows: Array<{ table_name: string }>,
  enumRows: Array<{ enum_name: string; enum_value: string }>,
): SqlQueryable {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: tableRows })
    .mockResolvedValueOnce({ rows: enumRows });

  return { query } as SqlQueryable;
}

describe('checkPipelineSchemaHealth', () => {
  it('returns ok when the required table and enum value exist', async () => {
    const db = createQueryable(
      [{ table_name: 'contact_recovery_items' }],
      [{ enum_name: 'CostEventProvider', enum_value: 'GOOGLE_CUSTOM_SEARCH' }],
    );

    await expect(checkPipelineSchemaHealth(db)).resolves.toEqual({
      status: 'ok',
      missingTables: [],
      missingEnumValues: [],
    });
  });

  it('reports missing artifacts when they are absent', async () => {
    const db = createQueryable([], []);

    await expect(checkPipelineSchemaHealth(db)).resolves.toEqual({
      status: 'fail',
      missingTables: ['contact_recovery_items'],
      missingEnumValues: ['CostEventProvider:GOOGLE_CUSTOM_SEARCH'],
    });
  });
});
