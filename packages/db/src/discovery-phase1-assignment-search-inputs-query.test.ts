import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';

import {
  listDiscoveryPhase1AssignmentSearchInputs,
  type DiscoveryPhase1AssignmentSearchInputRow,
} from './discovery-phase1-assignment-search-inputs-query.js';
import type { SqlQueryable } from './postgres.js';

process.env.NODE_ENV ??= 'test';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5434/lead_flood';
process.env.DATABASE_URL = databaseUrl;
process.env.DIRECT_URL ??= databaseUrl;

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  allowExitOnIdle: true,
});

function createClientQueryable(client: PoolClient): SqlQueryable {
  return {
    query(text, values) {
      return client.query(text, values ? [...values] : undefined);
    },
  };
}

afterAll(async () => {
  await pool.end();
});

describe('listDiscoveryPhase1AssignmentSearchInputs', () => {
  it('matches direct SQL for phase-1 labels joined to scalar search task inputs by search_task_id', async () => {
    const runId = `phase1-search-inputs-query-${randomUUID()}`;
    const icpProfileId = `icp-${randomUUID()}`;
    const now = new Date();

    const assignmentIds = {
      withRunOwnedTask: randomUUID(),
      withNullTaskRun: randomUUID(),
    } as const;

    const businessIds = {
      withRunOwnedTask: randomUUID(),
      withNullTaskRun: randomUUID(),
    } as const;

    const searchTaskIds = {
      withRunOwnedTask: randomUUID(),
      withNullTaskRun: randomUUID(),
    } as const;

    const client = await pool.connect();
    let inTransaction = false;

    try {
      await client.query('BEGIN');
      inTransaction = true;

      await client.query(
        `
          insert into public."IcpProfile" ("id", "name", "updatedAt")
          values ($1, $2, $3)
        `,
        [icpProfileId, `Phase 1 search inputs ${runId}`, now],
      );

      await client.query(
        `
          insert into public.search_tasks (
            "id",
            "task_type",
            "country_code",
            "city",
            "language",
            "query_text",
            "normalized_query_key",
            "query_hash",
            "params_json",
            "page",
            "time_bucket",
            "discovery_run_id",
            "updated_at"
          )
          values
            ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13),
            ($14, $2, $3, $15, $5, $16, $17, $18, $19::jsonb, $20, $21, $22, $13)
        `,
        [
          searchTaskIds.withRunOwnedTask,
          'SERP_GOOGLE',
          'JO',
          'Austin',
          'en',
          `phase1 search input primary ${runId}`,
          `phase1-search-input-primary-${runId}`,
          `query-hash-primary-${runId}`,
          JSON.stringify({ source: 'db-query-test', ignored: true }),
          1,
          'test',
          runId,
          now,
          searchTaskIds.withNullTaskRun,
          null,
          `phase1 search input null-run ${runId}`,
          `phase1-search-input-null-run-${runId}`,
          `query-hash-null-run-${runId}`,
          JSON.stringify({ source: 'db-query-test', ignored: true }),
          2,
          'test',
          null,
        ],
      );

      for (const [caseName, businessId] of Object.entries(businessIds)) {
        await client.query(
          `
            insert into public.businesses ("id", "name", "country_code", "updated_at")
            values ($1, $2, $3, $4)
          `,
          [businessId, `Business ${caseName} ${runId}`, 'JO', now],
        );
      }

      await client.query(
        `
          insert into public.discovery_attribution_assignments (
            "id",
            "discovery_run_id",
            "icp_profile_id",
            "business_id",
            "search_task_id",
            "assignment_mode",
            "primary_outcome_code",
            "primary_outcome_at",
            "updated_at"
          )
          values
            ($1, $2, $3, $4, $5, $6, $7, $8, $9),
            ($10, $2, $3, $11, $12, $6, $7, $8, $9)
        `,
        [
          assignmentIds.withRunOwnedTask,
          runId,
          icpProfileId,
          businessIds.withRunOwnedTask,
          searchTaskIds.withRunOwnedTask,
          'SEARCH_TASK_FIRST_TOUCH',
          'PREQUALIFY_DISQUALIFIED',
          now,
          now,
          assignmentIds.withNullTaskRun,
          businessIds.withNullTaskRun,
          searchTaskIds.withNullTaskRun,
        ],
      );

      const db = createClientQueryable(client);
      const helperRows = await listDiscoveryPhase1AssignmentSearchInputs(runId, db);
      const directSqlRows = await db.query<DiscoveryPhase1AssignmentSearchInputRow>(
        `
          select
            label.assignment_id,
            label.discovery_run_id,
            label.icp_profile_id,
            label.business_id,
            label.search_task_id,
            label.primary_outcome_code,
            label.phase1_class,
            label.exclusion_reason,
            search_task.task_type,
            search_task.country_code,
            search_task.city,
            search_task.language,
            search_task.query_text,
            search_task.normalized_query_key,
            search_task.query_hash,
            search_task.page,
            search_task.time_bucket
          from public.discovery_phase1_assignment_labels_v1 as label
          join (
            select
              id,
              task_type,
              country_code,
              city,
              language,
              query_text,
              normalized_query_key,
              query_hash,
              page,
              time_bucket
            from public.search_tasks
          ) as search_task
            on search_task.id = label.search_task_id
          where label.discovery_run_id = $1
          order by label.assignment_id asc
        `,
        [runId],
      );

      expect(helperRows).toEqual(directSqlRows.rows);
      expect(helperRows).toHaveLength(2);
      expect(helperRows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            assignment_id: assignmentIds.withNullTaskRun,
            discovery_run_id: runId,
            icp_profile_id: icpProfileId,
            business_id: businessIds.withNullTaskRun,
            search_task_id: searchTaskIds.withNullTaskRun,
            primary_outcome_code: 'PREQUALIFY_DISQUALIFIED',
            phase1_class: 'PHASE1_NEGATIVE',
            exclusion_reason: null,
            task_type: 'SERP_GOOGLE',
            country_code: 'JO',
            city: null,
            language: 'en',
            query_text: `phase1 search input null-run ${runId}`,
            normalized_query_key: `phase1-search-input-null-run-${runId}`,
            query_hash: `query-hash-null-run-${runId}`,
            page: 2,
            time_bucket: 'test',
          }),
        ]),
      );
    } finally {
      if (inTransaction) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Preserve the original assertion or query failure.
        }
      }

      client.release();
    }
  });
});
