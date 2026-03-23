import { describe, expect, it, vi } from 'vitest';

import { checkPipelineSchemaHealth, checkWorkerSchemaHealth } from './schema-health.js';
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
  it('returns ok for the api scope when the required tables and enum values exist', async () => {
    const db = createQueryable(
      [
        { table_name: 'contact_recovery_items' },
        { table_name: 'job_requests' },
        { table_name: 'job_runs' },
        { table_name: 'search_tasks' },
      ],
      [
        { enum_name: 'ContactRecoveryReason', enum_value: 'DECISION_MAKER_IDENTIFIED' },
        { enum_name: 'CostEventProvider', enum_value: 'GOOGLE_CUSTOM_SEARCH' },
      ],
    );

    await expect(checkPipelineSchemaHealth(db)).resolves.toEqual({
      status: 'ok',
      missingTables: [],
      missingEnumValues: [],
    });
  });

  it('reports missing artifacts for the api scope when they are absent', async () => {
    const db = createQueryable([], []);

    await expect(checkPipelineSchemaHealth(db)).resolves.toEqual({
      status: 'fail',
      missingTables: [
        'contact_recovery_items',
        'job_requests',
        'job_runs',
        'search_tasks',
      ],
      missingEnumValues: [
        'ContactRecoveryReason:DECISION_MAKER_IDENTIFIED',
        'CostEventProvider:GOOGLE_CUSTOM_SEARCH',
      ],
    });
  });

  it('keeps the worker scope narrower than the api scope', async () => {
    const db = createQueryable(
      [
        { table_name: 'contact_recovery_items' },
        { table_name: 'job_runs' },
        { table_name: 'search_tasks' },
      ],
      [
        { enum_name: 'ContactRecoveryReason', enum_value: 'DECISION_MAKER_IDENTIFIED' },
        { enum_name: 'CostEventProvider', enum_value: 'GOOGLE_CUSTOM_SEARCH' },
      ],
    );

    await expect(checkWorkerSchemaHealth(db)).resolves.toEqual({
      status: 'ok',
      missingTables: [],
      missingEnumValues: [],
    });
  });
});
