import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';

import type { DiscoveryPhase1SearchInputCohortSummariesAcrossRunsFilters } from './discovery-phase1-search-input-cohort-summaries-across-runs-query.js';
import {
  listDiscoveryPhase1HistoricalSearchInputCohortSummaries,
  type DiscoveryPhase1HistoricalSearchInputCohortSummaryRow,
} from './discovery-phase1-search-input-historical-cohort-summaries-query.js';
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

describe('listDiscoveryPhase1HistoricalSearchInputCohortSummaries', () => {
  it('matches direct SQL while collapsing matching cohorts across assignment runs without relying on search_tasks.discovery_run_id', async () => {
    const runIds = {
      alpha: `phase1-historical-cohort-alpha-${randomUUID()}`,
      beta: `phase1-historical-cohort-beta-${randomUUID()}`,
      gammaBoundaryExcluded: `phase1-historical-cohort-gamma-${randomUUID()}`,
      mismatchedTaskRun: `phase1-historical-cohort-task-run-${randomUUID()}`,
    } as const;
    const icpProfileId = `icp-${randomUUID()}`;
    const now = new Date();

    const cohortKey = {
      normalizedQueryKey: `phase1-historical-cohort-${randomUUID()}`,
      queryHash: `phase1-historical-query-hash-${randomUUID()}`,
    } as const;

    const filters: DiscoveryPhase1SearchInputCohortSummariesAcrossRunsFilters = {
      assignedAtStart: new Date('2026-03-01T00:00:00.000Z'),
      assignedAtEnd: new Date('2026-03-02T00:00:00.000Z'),
    };

    const assignedAts = {
      alphaPositiveAtStart: filters.assignedAtStart,
      alphaNegativeNullTaskRun: new Date('2026-03-01T08:00:00.000Z'),
      betaOperationalMismatchedTaskRun: new Date('2026-03-01T12:00:00.000Z'),
      betaIncompleteMismatchedTaskRun: new Date('2026-03-01T18:00:00.000Z'),
      gammaBoundaryExcluded: filters.assignedAtEnd,
    } as const;

    const searchTaskIds = {
      alphaNullTaskRun: randomUUID(),
      betaMismatchedTaskRun: randomUUID(),
    } as const;

    const assignmentIds = {
      alphaPositiveAtStart: randomUUID(),
      alphaNegativeNullTaskRun: randomUUID(),
      betaOperationalMismatchedTaskRun: randomUUID(),
      betaIncompleteMismatchedTaskRun: randomUUID(),
      gammaBoundaryExcluded: randomUUID(),
    } as const;

    const businessIds = {
      alphaPositiveAtStart: randomUUID(),
      alphaNegativeNullTaskRun: randomUUID(),
      betaOperationalMismatchedTaskRun: randomUUID(),
      betaIncompleteMismatchedTaskRun: randomUUID(),
      gammaBoundaryExcluded: randomUUID(),
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
        [icpProfileId, `Phase 1 historical search input cohorts ${runIds.alpha}`, now],
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
            ($14, $2, $3, $4, $5, $15, $7, $8, $16::jsonb, $10, $11, $17, $13)
        `,
        [
          searchTaskIds.alphaNullTaskRun,
          'SERP_GOOGLE',
          'JO',
          'Austin',
          'en',
          `phase1 historical cohort alpha ${runIds.alpha}`,
          cohortKey.normalizedQueryKey,
          cohortKey.queryHash,
          JSON.stringify({ source: 'db-query-test', task: 'alpha-null-task-run' }),
          1,
          'test',
          null,
          now,
          searchTaskIds.betaMismatchedTaskRun,
          `phase1 historical cohort beta ${runIds.beta}`,
          JSON.stringify({ source: 'db-query-test', task: 'beta-mismatched-task-run' }),
          runIds.mismatchedTaskRun,
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
            ($11, $2, $3, $12, $5, $6, $13, $14, $15, $10),
            ($16, $17, $3, $18, $19, $6, $20, $21, $22, $10),
            ($23, $17, $3, $24, $19, $6, $25, null, null, $10),
            ($26, $27, $3, $28, $19, $6, $29, $14, $30, $10)
        `,
        [
          assignmentIds.alphaPositiveAtStart,
          runIds.alpha,
          icpProfileId,
          businessIds.alphaPositiveAtStart,
          searchTaskIds.alphaNullTaskRun,
          'SEARCH_TASK_FIRST_TOUCH',
          assignedAts.alphaPositiveAtStart,
          'LEAD_CREATED',
          now,
          now,
          assignmentIds.alphaNegativeNullTaskRun,
          businessIds.alphaNegativeNullTaskRun,
          assignedAts.alphaNegativeNullTaskRun,
          'PREQUALIFY_DISQUALIFIED',
          now,
          assignmentIds.betaOperationalMismatchedTaskRun,
          runIds.beta,
          businessIds.betaOperationalMismatchedTaskRun,
          searchTaskIds.betaMismatchedTaskRun,
          assignedAts.betaOperationalMismatchedTaskRun,
          'EXISTING_BUSINESS_NO_UNIQUE_ACTIVE_SAME_BUSINESS_LEAD',
          now,
          assignmentIds.betaIncompleteMismatchedTaskRun,
          businessIds.betaIncompleteMismatchedTaskRun,
          assignedAts.betaIncompleteMismatchedTaskRun,
          assignmentIds.gammaBoundaryExcluded,
          runIds.gammaBoundaryExcluded,
          businessIds.gammaBoundaryExcluded,
          assignedAts.gammaBoundaryExcluded,
          now,
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
          `historical-positive-${runIds.alpha}@lead-flood.local`,
          'db-query-test',
          'qualified',
          businessIds.alphaPositiveAtStart,
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
          businessIds.alphaPositiveAtStart,
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
            businessId: businessIds.alphaPositiveAtStart,
            discoveryRunId: runIds.alpha,
            searchTaskId: searchTaskIds.alphaNullTaskRun,
          }),
        ],
      );

      const db = createClientQueryable(client);
      const helperRows = await listDiscoveryPhase1HistoricalSearchInputCohortSummaries(filters, db);
      const directSqlRows = await db.query<DiscoveryPhase1HistoricalSearchInputCohortSummaryRow>(
        `
          select
            label.icp_profile_id,
            search_task.task_type,
            search_task.country_code,
            search_task.city,
            search_task.language,
            search_task.normalized_query_key,
            search_task.query_hash,
            search_task.page,
            search_task.time_bucket,
            count(distinct label.discovery_run_id)::integer as discovery_run_count,
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
      expect(helperRows).toHaveLength(1);
      expect(helperRows[0]).not.toHaveProperty('discovery_run_id');
      expect(helperRows[0]).toEqual(
        expect.objectContaining({
          icp_profile_id: icpProfileId,
          task_type: 'SERP_GOOGLE',
          country_code: 'JO',
          city: 'Austin',
          language: 'en',
          normalized_query_key: cohortKey.normalizedQueryKey,
          query_hash: cohortKey.queryHash,
          page: 1,
          time_bucket: 'test',
          discovery_run_count: 2,
          assignment_count: 4,
          phase1_positive_count: 1,
          phase1_negative_count: 1,
          exclude_operational_count: 1,
          exclude_incomplete_count: 1,
        }),
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
