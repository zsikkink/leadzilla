import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';

import {
  listDiscoveryPhase1SearchInputCohortSummariesAcrossRuns,
  type DiscoveryPhase1SearchInputCohortSummariesAcrossRunsFilters,
} from './discovery-phase1-search-input-cohort-summaries-across-runs-query.js';
import type { DiscoveryPhase1SearchInputCohortSummaryRow } from './discovery-phase1-search-input-cohort-summaries-query.js';
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

describe('listDiscoveryPhase1SearchInputCohortSummariesAcrossRuns', () => {
  it('matches direct SQL across runs within an assignment-side window and includes null task-run cohorts', async () => {
    const runIds = {
      alpha: `phase1-search-input-cohorts-across-runs-alpha-${randomUUID()}`,
      beta: `phase1-search-input-cohorts-across-runs-beta-${randomUUID()}`,
    } as const;
    const icpProfileId = `icp-${randomUUID()}`;
    const now = new Date();

    const filters: DiscoveryPhase1SearchInputCohortSummariesAcrossRunsFilters = {
      assignedAtStart: new Date('2026-02-01T00:00:00.000Z'),
      assignedAtEnd: new Date('2026-02-02T00:00:00.000Z'),
    };

    const assignedAts = {
      alphaPositive: new Date('2026-02-01T01:00:00.000Z'),
      alphaNegativeNullTaskRun: new Date('2026-02-01T08:00:00.000Z'),
      alphaOperational: new Date('2026-02-01T12:00:00.000Z'),
      alphaBoundaryExcluded: new Date('2026-02-02T00:00:00.000Z'),
      betaOperational: new Date('2026-02-01T09:00:00.000Z'),
      betaIncomplete: new Date('2026-02-01T18:00:00.000Z'),
    } as const;

    const searchTaskIds = {
      alphaRunOwned: randomUUID(),
      alphaNullTaskRun: randomUUID(),
      betaRunOwned: randomUUID(),
    } as const;

    const assignmentIds = {
      alphaPositive: randomUUID(),
      alphaNegativeNullTaskRun: randomUUID(),
      alphaOperational: randomUUID(),
      alphaBoundaryExcluded: randomUUID(),
      betaOperational: randomUUID(),
      betaIncomplete: randomUUID(),
    } as const;

    const businessIds = {
      alphaPositive: randomUUID(),
      alphaNegativeNullTaskRun: randomUUID(),
      alphaOperational: randomUUID(),
      alphaBoundaryExcluded: randomUUID(),
      betaOperational: randomUUID(),
      betaIncomplete: randomUUID(),
    } as const;

    const leadId = `lead-${randomUUID()}`;

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
        [icpProfileId, `Phase 1 cross-run cohorts ${runIds.alpha}`, now],
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
            ($14, $2, $3, $4, $5, $15, $7, $8, $16::jsonb, $10, $11, $17, $13),
            ($18, $2, $3, $4, $5, $19, $7, $8, $20::jsonb, $10, $11, $21, $13)
        `,
        [
          searchTaskIds.alphaRunOwned,
          'SERP_GOOGLE',
          'JO',
          'Austin',
          'en',
          `phase1 across runs alpha ${runIds.alpha}`,
          `phase1-across-runs-cohort-${randomUUID()}`,
          `query-hash-across-runs-${randomUUID()}`,
          JSON.stringify({ source: 'db-query-test', task: 'alpha-run-owned' }),
          1,
          'test',
          runIds.alpha,
          now,
          searchTaskIds.alphaNullTaskRun,
          `phase1 across runs alpha null-task-run ${runIds.alpha}`,
          JSON.stringify({ source: 'db-query-test', task: 'alpha-null-task-run' }),
          null,
          searchTaskIds.betaRunOwned,
          `phase1 across runs beta ${runIds.beta}`,
          JSON.stringify({ source: 'db-query-test', task: 'beta-run-owned' }),
          runIds.beta,
        ],
      );

      for (const [caseName, businessId] of Object.entries(businessIds)) {
        await client.query(
          `
            insert into public.businesses ("id", "name", "country_code", "updated_at")
            values ($1, $2, $3, $4)
          `,
          [businessId, `Business ${caseName} ${runIds.alpha}`, 'JO', now],
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
            "assigned_at",
            "primary_outcome_code",
            "primary_outcome_at",
            "updated_at"
          )
          values
            ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10),
            ($11, $2, $3, $12, $13, $6, $14, $15, $16, $10),
            ($17, $2, $3, $18, $5, $6, $19, $20, $21, $10),
            ($22, $2, $3, $23, $5, $6, $24, null, null, $10),
            ($25, $26, $3, $27, $28, $6, $29, $30, $31, $10),
            ($32, $26, $3, $33, $28, $6, $34, null, null, $10)
        `,
        [
          assignmentIds.alphaPositive,
          runIds.alpha,
          icpProfileId,
          businessIds.alphaPositive,
          searchTaskIds.alphaRunOwned,
          'SEARCH_TASK_FIRST_TOUCH',
          assignedAts.alphaPositive,
          'LEAD_CREATED',
          now,
          now,
          assignmentIds.alphaNegativeNullTaskRun,
          businessIds.alphaNegativeNullTaskRun,
          searchTaskIds.alphaNullTaskRun,
          assignedAts.alphaNegativeNullTaskRun,
          'PREQUALIFY_DISQUALIFIED',
          now,
          assignmentIds.alphaOperational,
          businessIds.alphaOperational,
          assignedAts.alphaOperational,
          'EXISTING_SAME_BUSINESS_LEAD_REUSED',
          now,
          assignmentIds.alphaBoundaryExcluded,
          businessIds.alphaBoundaryExcluded,
          assignedAts.alphaBoundaryExcluded,
          assignmentIds.betaOperational,
          runIds.beta,
          businessIds.betaOperational,
          searchTaskIds.betaRunOwned,
          assignedAts.betaOperational,
          'EXISTING_BUSINESS_NO_UNIQUE_ACTIVE_SAME_BUSINESS_LEAD',
          now,
          assignmentIds.betaIncomplete,
          businessIds.betaIncomplete,
          assignedAts.betaIncomplete,
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
          leadId,
          'Phase1',
          'Tester',
          `across-runs-positive-${runIds.alpha}@lead-flood.local`,
          'db-query-test',
          'qualified',
          businessIds.alphaPositive,
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
          businessIds.alphaPositive,
          leadId,
          icpProfileId,
          JSON.stringify({ discoveryRunId: runIds.alpha }),
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
          leadId,
          icpProfileId,
          'GOOGLE_SEARCH',
          `provider-record-${randomUUID()}`,
          `query-hash-positive-${runIds.alpha}`,
          JSON.stringify({ source: 'db-query-test' }),
          JSON.stringify({
            businessId: businessIds.alphaPositive,
            discoveryRunId: runIds.alpha,
            searchTaskId: searchTaskIds.alphaRunOwned,
          }),
        ],
      );

      const db = createClientQueryable(client);
      const helperRows = await listDiscoveryPhase1SearchInputCohortSummariesAcrossRuns(filters, db);
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
              assigned_at
            from public.discovery_attribution_assignments
          ) as assignment
            on assignment.id = label.assignment_id
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
          where assignment.assigned_at >= $1
            and assignment.assigned_at < $2
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
        [filters.assignedAtStart, filters.assignedAtEnd],
      );

      expect(helperRows).toEqual(directSqlRows.rows);
      expect(helperRows).toHaveLength(2);
      expect(helperRows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            discovery_run_id: runIds.alpha,
            icp_profile_id: icpProfileId,
            task_type: 'SERP_GOOGLE',
            country_code: 'JO',
            city: 'Austin',
            language: 'en',
            assignment_count: 3,
            phase1_positive_count: 1,
            phase1_negative_count: 1,
            exclude_operational_count: 1,
            exclude_incomplete_count: 0,
          }),
          expect.objectContaining({
            discovery_run_id: runIds.beta,
            icp_profile_id: icpProfileId,
            task_type: 'SERP_GOOGLE',
            country_code: 'JO',
            city: 'Austin',
            language: 'en',
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
