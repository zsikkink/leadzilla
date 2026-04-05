import { describe, expect, it, vi } from 'vitest';

import { checkPipelineSchemaHealth, checkWorkerSchemaHealth } from './schema-health.js';
import type { SqlQueryable } from './postgres.js';

function createQueryable(...rowsByQuery: Array<Array<Record<string, unknown>>>): SqlQueryable {
  const query = vi.fn();

  for (const rows of rowsByQuery) {
    query.mockResolvedValueOnce({ rows });
  }

  return { query } as SqlQueryable;
}

describe('checkPipelineSchemaHealth', () => {
  it('includes discovery_attribution_assignments in the explicit browser-role revoke audit set', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({
        rows: [
          { table_name: 'contact_recovery_items' },
          { table_name: 'job_runs' },
          { table_name: 'search_tasks' },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { enum_name: 'ContactRecoveryReason', enum_value: 'DECISION_MAKER_IDENTIFIED' },
          { enum_name: 'CostEventProvider', enum_value: 'GOOGLE_CUSTOM_SEARCH' },
          { enum_name: 'MessageSendStatus', enum_value: 'SENDING' },
          { enum_name: 'MessageSendStatus', enum_value: 'UNRESOLVED' },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(checkWorkerSchemaHealth({ query } as SqlQueryable)).resolves.toEqual({
      status: 'ok',
      missingTables: [],
      missingEnumValues: [],
      unexpectedTablePrivileges: [],
      unexpectedDefaultPrivileges: [],
    });

    expect(query).toHaveBeenNthCalledWith(
      3,
      expect.any(String),
      [
        expect.arrayContaining(['discovery_attribution_assignments']),
        ['anon', 'authenticated'],
        ['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'],
      ],
    );
  });

  it('returns ok for the api scope when the required tables, enum values, and privilege posture match', async () => {
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
        { enum_name: 'MessageSendStatus', enum_value: 'SENDING' },
        { enum_name: 'MessageSendStatus', enum_value: 'UNRESOLVED' },
      ],
      [],
      [],
    );

    await expect(checkPipelineSchemaHealth(db)).resolves.toEqual({
      status: 'ok',
      missingTables: [],
      missingEnumValues: [],
      unexpectedTablePrivileges: [],
      unexpectedDefaultPrivileges: [],
    });
  });

  it('reports missing runtime enum values for the api scope when they are absent', async () => {
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
        { enum_name: 'MessageSendStatus', enum_value: 'SENDING' },
      ],
      [],
      [],
    );

    await expect(checkPipelineSchemaHealth(db)).resolves.toEqual({
      status: 'fail',
      missingTables: [],
      missingEnumValues: ['MessageSendStatus:UNRESOLVED'],
      unexpectedTablePrivileges: [],
      unexpectedDefaultPrivileges: [],
    });
  });

  it('reports unexpected browser role table privileges', async () => {
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
        { enum_name: 'MessageSendStatus', enum_value: 'SENDING' },
        { enum_name: 'MessageSendStatus', enum_value: 'UNRESOLVED' },
      ],
      [
        {
          table_name: 'MessageSend',
          role_name: 'authenticated',
          privileges: ['SELECT', 'UPDATE'],
        },
      ],
      [],
    );

    await expect(checkPipelineSchemaHealth(db)).resolves.toEqual({
      status: 'fail',
      missingTables: [],
      missingEnumValues: [],
      unexpectedTablePrivileges: [
        'public.MessageSend:authenticated:SELECT,UPDATE',
      ],
      unexpectedDefaultPrivileges: [],
    });
  });

  it('reports unexpected browser role default privileges', async () => {
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
        { enum_name: 'MessageSendStatus', enum_value: 'SENDING' },
        { enum_name: 'MessageSendStatus', enum_value: 'UNRESOLVED' },
      ],
      [],
      [
        {
          object_type: 'TABLES',
          role_name: 'anon',
          privileges: ['INSERT', 'SELECT'],
        },
      ],
    );

    await expect(checkPipelineSchemaHealth(db)).resolves.toEqual({
      status: 'fail',
      missingTables: [],
      missingEnumValues: [],
      unexpectedTablePrivileges: [],
      unexpectedDefaultPrivileges: [
        'postgres:public:TABLES:anon:INSERT,SELECT',
      ],
    });
  });

  it('keeps the worker scope narrower than the api scope while enforcing the same guard', async () => {
    const db = createQueryable(
      [
        { table_name: 'contact_recovery_items' },
        { table_name: 'job_runs' },
        { table_name: 'search_tasks' },
      ],
      [
        { enum_name: 'ContactRecoveryReason', enum_value: 'DECISION_MAKER_IDENTIFIED' },
        { enum_name: 'CostEventProvider', enum_value: 'GOOGLE_CUSTOM_SEARCH' },
        { enum_name: 'MessageSendStatus', enum_value: 'SENDING' },
        { enum_name: 'MessageSendStatus', enum_value: 'UNRESOLVED' },
      ],
      [],
      [],
    );

    await expect(checkWorkerSchemaHealth(db)).resolves.toEqual({
      status: 'ok',
      missingTables: [],
      missingEnumValues: [],
      unexpectedTablePrivileges: [],
      unexpectedDefaultPrivileges: [],
    });
  });
});
