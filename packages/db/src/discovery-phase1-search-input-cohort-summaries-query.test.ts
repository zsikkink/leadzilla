import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';

import {
  listDiscoveryPhase1SearchInputCohortSummaries,
  type DiscoveryPhase1SearchInputCohortSummaryRow,
} from './discovery-phase1-search-input-cohort-summaries-query.js';
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

describe('listDiscoveryPhase1SearchInputCohortSummaries', () => {
  it('matches direct SQL for phase-1 labels grouped by stable search-input cohorts', async () => {
    const runId = `phase1-search-input-cohorts-${randomUUID()}`;
    const icpProfileId = `icp-${randomUUID()}`;
    const now = new Date();

    const searchTaskIds = {
      cohortARunOwned: randomUUID(),
      cohortANullTaskRun: randomUUID(),
      cohortBRunOwned: randomUUID(),
    } as const;

    const assignmentIds = {
      cohortAPositive: randomUUID(),
      cohortANegative: randomUUID(),
      cohortAOperational: randomUUID(),
      cohortAHoldout: randomUUID(),
      cohortBOperational: randomUUID(),
      cohortBIncomplete: randomUUID(),
    } as const;

    const businessIds = {
      cohortAPositive: randomUUID(),
      cohortANegative: randomUUID(),
      cohortAOperational: randomUUID(),
      cohortAHoldout: randomUUID(),
      cohortBOperational: randomUUID(),
      cohortBIncomplete: randomUUID(),
    } as const;

    const leadIds = {
      cohortAPositive: `lead-${randomUUID()}`,
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
        [icpProfileId, `Phase 1 search input cohorts ${runId}`, now],
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
            ($14, $2, $3, $4, $5, $6, $7, $8, $15::jsonb, $10, $11, $16, $13),
            ($17, $18, $3, $19, $5, $20, $21, $22, $23::jsonb, $24, $11, $12, $13)
        `,
        [
          searchTaskIds.cohortARunOwned,
          'SERP_GOOGLE',
          'JO',
          'Austin',
          'en',
          `phase1 cohort a ${runId}`,
          `phase1-cohort-a-${runId}`,
          `query-hash-cohort-a-${runId}`,
          JSON.stringify({ source: 'db-query-test', cohort: 'a-run-owned' }),
          1,
          'test',
          runId,
          now,
          searchTaskIds.cohortANullTaskRun,
          JSON.stringify({ source: 'db-query-test', cohort: 'a-null-run' }),
          null,
          searchTaskIds.cohortBRunOwned,
          'SERP_GOOGLE_LOCAL',
          null,
          `phase1 cohort b ${runId}`,
          `phase1-cohort-b-${runId}`,
          `query-hash-cohort-b-${runId}`,
          JSON.stringify({ source: 'db-query-test', cohort: 'b-run-owned' }),
          2,
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
            ($10, $2, $3, $11, $12, $6, $13, $8, $9),
            ($14, $2, $3, $15, $5, $6, $16, $8, $9),
            ($17, $2, $3, $18, $12, $6, $19, $8, $9),
            ($20, $2, $3, $21, $22, $6, $23, $8, $9),
            ($24, $2, $3, $25, $22, $6, null, null, $9)
        `,
        [
          assignmentIds.cohortAPositive,
          runId,
          icpProfileId,
          businessIds.cohortAPositive,
          searchTaskIds.cohortARunOwned,
          'SEARCH_TASK_FIRST_TOUCH',
          'LEAD_CREATED',
          now,
          now,
          assignmentIds.cohortANegative,
          businessIds.cohortANegative,
          searchTaskIds.cohortANullTaskRun,
          'PREQUALIFY_DISQUALIFIED',
          assignmentIds.cohortAOperational,
          businessIds.cohortAOperational,
          'EXISTING_SAME_BUSINESS_LEAD_REUSED',
          assignmentIds.cohortAHoldout,
          businessIds.cohortAHoldout,
          'RECOVERY_OPENED',
          assignmentIds.cohortBOperational,
          businessIds.cohortBOperational,
          searchTaskIds.cohortBRunOwned,
          'EXISTING_BUSINESS_NO_UNIQUE_ACTIVE_SAME_BUSINESS_LEAD',
          assignmentIds.cohortBIncomplete,
          businessIds.cohortBIncomplete,
        ],
      );

      await client.query(
        `
          insert into public."Lead" (
            "id",
            "firstName",
            "lastName",
            "email",
            "source",
            "status",
            "businessId",
            "updatedAt"
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          leadIds.cohortAPositive,
          'Phase1',
          'Tester',
          `cohort-positive-${runId}@lead-flood.local`,
          'db-query-test',
          'qualified',
          businessIds.cohortAPositive,
          now,
        ],
      );

      await client.query(
        `
          insert into public.business_conversions (
            "id",
            "businessId",
            "leadId",
            "icpProfileId",
            "metadata"
          )
          values ($1, $2, $3, $4, $5::jsonb)
        `,
        [
          `conversion-${randomUUID()}`,
          businessIds.cohortAPositive,
          leadIds.cohortAPositive,
          icpProfileId,
          JSON.stringify({ discoveryRunId: runId }),
        ],
      );

      await client.query(
        `
          insert into public."LeadDiscoveryRecord" (
            "id",
            "leadId",
            "icpProfileId",
            "provider",
            "providerRecordId",
            "queryHash",
            "rawPayload",
            "provenanceJson"
          )
          values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
        `,
        [
          `discovery-record-${randomUUID()}`,
          leadIds.cohortAPositive,
          icpProfileId,
          'GOOGLE_SEARCH',
          `provider-record-${randomUUID()}`,
          `query-hash-positive-${runId}`,
          JSON.stringify({ source: 'db-query-test' }),
          JSON.stringify({
            businessId: businessIds.cohortAPositive,
            discoveryRunId: runId,
            searchTaskId: searchTaskIds.cohortARunOwned,
          }),
        ],
      );

      const db = createClientQueryable(client);
      const helperRows = await listDiscoveryPhase1SearchInputCohortSummaries(runId, db);
      const directSqlRows = await db.query<DiscoveryPhase1SearchInputCohortSummaryRow>(
        `
          select
            label.discovery_run_id,
            label.icp_profile_id,
            search_task.task_type,
            search_task.country_code,
            search_task.city,
            search_task.language,
            search_task.normalized_query_key,
            search_task.query_hash,
            search_task.page,
            search_task.time_bucket,
            count(*)::integer as assignment_count,
            count(*) filter (
              where label.phase1_class = 'PHASE1_POSITIVE'
            )::integer as phase1_positive_count,
            count(*) filter (
              where label.phase1_class = 'PHASE1_NEGATIVE'
            )::integer as phase1_negative_count,
            count(*) filter (
              where label.phase1_class = 'EXCLUDE_OPERATIONAL'
            )::integer as exclude_operational_count,
            count(*) filter (
              where label.phase1_class = 'EXCLUDE_INCOMPLETE'
            )::integer as exclude_incomplete_count
          from public.discovery_phase1_assignment_labels_v1 as label
          join (
            select
              id,
              task_type,
              country_code,
              city,
              language,
              normalized_query_key,
              query_hash,
              page,
              time_bucket
            from public.search_tasks
          ) as search_task
            on search_task.id = label.search_task_id
          where label.discovery_run_id = $1
          group by
            label.discovery_run_id,
            label.icp_profile_id,
            search_task.task_type,
            search_task.country_code,
            search_task.city,
            search_task.language,
            search_task.normalized_query_key,
            search_task.query_hash,
            search_task.page,
            search_task.time_bucket
          order by
            label.discovery_run_id asc,
            label.icp_profile_id asc,
            search_task.task_type asc,
            search_task.country_code asc,
            search_task.city asc nulls first,
            search_task.language asc,
            search_task.normalized_query_key asc,
            search_task.query_hash asc,
            search_task.page asc,
            search_task.time_bucket asc
        `,
        [runId],
      );

      expect(helperRows).toEqual(directSqlRows.rows);
      expect(helperRows).toHaveLength(2);
      expect(helperRows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            discovery_run_id: runId,
            icp_profile_id: icpProfileId,
            task_type: 'SERP_GOOGLE',
            country_code: 'JO',
            city: 'Austin',
            language: 'en',
            normalized_query_key: `phase1-cohort-a-${runId}`,
            query_hash: `query-hash-cohort-a-${runId}`,
            page: 1,
            time_bucket: 'test',
            assignment_count: 4,
            phase1_positive_count: 1,
            phase1_negative_count: 1,
            exclude_operational_count: 1,
            exclude_incomplete_count: 0,
          }),
          expect.objectContaining({
            discovery_run_id: runId,
            icp_profile_id: icpProfileId,
            task_type: 'SERP_GOOGLE_LOCAL',
            country_code: 'JO',
            city: null,
            language: 'en',
            normalized_query_key: `phase1-cohort-b-${runId}`,
            query_hash: `query-hash-cohort-b-${runId}`,
            page: 2,
            time_bucket: 'test',
            assignment_count: 2,
            phase1_positive_count: 0,
            phase1_negative_count: 0,
            exclude_operational_count: 1,
            exclude_incomplete_count: 1,
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
