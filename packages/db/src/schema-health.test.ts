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

const PRIMARY_OUTCOME_CONSTRAINT_ROWS = [
  {
    allowed_primary_outcome_codes: [
      'PREQUALIFY_DISQUALIFIED',
      'RECOVERY_OPENED',
      'LEAD_CREATED',
      'EXISTING_SAME_BUSINESS_LEAD_REUSED',
      'EXISTING_BUSINESS_NO_UNIQUE_ACTIVE_SAME_BUSINESS_LEAD',
    ],
  },
] satisfies Array<Record<string, unknown>>;

const PHASE1_LABEL_VIEW_ROWS = [
  {
    table_name: 'discovery_phase1_assignment_labels_v1',
  },
] satisfies Array<Record<string, unknown>>;

const PHASE1_LABEL_VIEW_COLUMN_ROWS = [
  { column_name: 'assignment_id' },
  { column_name: 'discovery_run_id' },
  { column_name: 'icp_profile_id' },
  { column_name: 'business_id' },
  { column_name: 'search_task_id' },
  { column_name: 'primary_outcome_code' },
  { column_name: 'phase1_class' },
  { column_name: 'exclusion_reason' },
] satisfies Array<Record<string, unknown>>;

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
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: PRIMARY_OUTCOME_CONSTRAINT_ROWS })
      .mockResolvedValueOnce({ rows: PHASE1_LABEL_VIEW_ROWS })
      .mockResolvedValueOnce({ rows: PHASE1_LABEL_VIEW_COLUMN_ROWS });

    await expect(checkWorkerSchemaHealth({ query } as SqlQueryable)).resolves.toEqual({
      status: 'ok',
      missingTables: [],
      missingEnumValues: [],
      missingCheckConstraints: [],
      missingViews: [],
      missingViewColumns: [],
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
      PRIMARY_OUTCOME_CONSTRAINT_ROWS,
      PHASE1_LABEL_VIEW_ROWS,
      PHASE1_LABEL_VIEW_COLUMN_ROWS,
    );

    await expect(checkPipelineSchemaHealth(db)).resolves.toEqual({
      status: 'ok',
      missingTables: [],
      missingEnumValues: [],
      missingCheckConstraints: [],
      missingViews: [],
      missingViewColumns: [],
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
      PRIMARY_OUTCOME_CONSTRAINT_ROWS,
      PHASE1_LABEL_VIEW_ROWS,
      PHASE1_LABEL_VIEW_COLUMN_ROWS,
    );

    await expect(checkPipelineSchemaHealth(db)).resolves.toEqual({
      status: 'fail',
      missingTables: [],
      missingEnumValues: ['MessageSendStatus:UNRESOLVED'],
      missingCheckConstraints: [],
      missingViews: [],
      missingViewColumns: [],
      unexpectedTablePrivileges: [],
      unexpectedDefaultPrivileges: [],
    });
  });

  it('reports missing discovery attribution primary outcome values when the SQL check constraint is stale', async () => {
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
      [
        {
          allowed_primary_outcome_codes: [
            'PREQUALIFY_DISQUALIFIED',
            'RECOVERY_OPENED',
            'LEAD_CREATED',
            'EXISTING_SAME_BUSINESS_LEAD_REUSED',
          ],
        },
      ],
      PHASE1_LABEL_VIEW_ROWS,
      PHASE1_LABEL_VIEW_COLUMN_ROWS,
    );

    await expect(checkPipelineSchemaHealth(db)).resolves.toEqual({
      status: 'fail',
      missingTables: [],
      missingEnumValues: [],
      missingCheckConstraints: [
        'public.discovery_attribution_assignments_primary_outcome_chk:EXISTING_BUSINESS_NO_UNIQUE_ACTIVE_SAME_BUSINESS_LEAD',
      ],
      missingViews: [],
      missingViewColumns: [],
      unexpectedTablePrivileges: [],
      unexpectedDefaultPrivileges: [],
    });
  });

  it('reports missing phase-1 extraction view columns when the SQL view contract drifts', async () => {
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
      PRIMARY_OUTCOME_CONSTRAINT_ROWS,
      PHASE1_LABEL_VIEW_ROWS,
      [
        { column_name: 'assignment_id' },
        { column_name: 'discovery_run_id' },
        { column_name: 'icp_profile_id' },
        { column_name: 'business_id' },
        { column_name: 'search_task_id' },
        { column_name: 'primary_outcome_code' },
      ],
    );

    await expect(checkPipelineSchemaHealth(db)).resolves.toEqual({
      status: 'fail',
      missingTables: [],
      missingEnumValues: [],
      missingCheckConstraints: [],
      missingViews: [],
      missingViewColumns: [
        'public.discovery_phase1_assignment_labels_v1:phase1_class',
        'public.discovery_phase1_assignment_labels_v1:exclusion_reason',
      ],
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
      PRIMARY_OUTCOME_CONSTRAINT_ROWS,
      PHASE1_LABEL_VIEW_ROWS,
      PHASE1_LABEL_VIEW_COLUMN_ROWS,
    );

    await expect(checkPipelineSchemaHealth(db)).resolves.toEqual({
      status: 'fail',
      missingTables: [],
      missingEnumValues: [],
      missingCheckConstraints: [],
      missingViews: [],
      missingViewColumns: [],
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
      PRIMARY_OUTCOME_CONSTRAINT_ROWS,
      PHASE1_LABEL_VIEW_ROWS,
      PHASE1_LABEL_VIEW_COLUMN_ROWS,
    );

    await expect(checkPipelineSchemaHealth(db)).resolves.toEqual({
      status: 'fail',
      missingTables: [],
      missingEnumValues: [],
      missingCheckConstraints: [],
      missingViews: [],
      missingViewColumns: [],
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
      PRIMARY_OUTCOME_CONSTRAINT_ROWS,
      PHASE1_LABEL_VIEW_ROWS,
      PHASE1_LABEL_VIEW_COLUMN_ROWS,
    );

    await expect(checkWorkerSchemaHealth(db)).resolves.toEqual({
      status: 'ok',
      missingTables: [],
      missingEnumValues: [],
      missingCheckConstraints: [],
      missingViews: [],
      missingViewColumns: [],
      unexpectedTablePrivileges: [],
      unexpectedDefaultPrivileges: [],
    });
  });
});
