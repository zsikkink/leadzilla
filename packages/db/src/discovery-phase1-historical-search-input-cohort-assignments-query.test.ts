import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';

import {
  listDiscoveryPhase1HistoricalSearchInputCohortAssignments,
  type DiscoveryPhase1HistoricalSearchInputCohortAssignmentRow,
  type DiscoveryPhase1HistoricalSearchInputCohortAssignmentsFilters,
} from './discovery-phase1-historical-search-input-cohort-assignments-query.js';
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

describe('listDiscoveryPhase1HistoricalSearchInputCohortAssignments', () => {
  it('matches direct SQL for one historical cohort within an assignment-side window across multiple discovery runs', async () => {
    const runIds = {
      alpha: `phase1-historical-cohort-assignments-alpha-${randomUUID()}`,
      beta: `phase1-historical-cohort-assignments-beta-${randomUUID()}`,
      gammaBoundaryExcluded: `phase1-historical-cohort-assignments-gamma-${randomUUID()}`,
      mismatchedTaskRun: `phase1-historical-cohort-assignments-task-run-${randomUUID()}`,
    } as const;
    const icpProfileId = `icp-${randomUUID()}`;
    const now = new Date();

    const cohort = {
      taskType: 'SERP_GOOGLE',
      countryCode: 'JO',
      city: 'Austin',
      language: 'en',
      normalizedQueryKey: `phase1-historical-cohort-assignments-${randomUUID()}`,
      queryHash: `phase1-historical-cohort-assignments-hash-${randomUUID()}`,
      page: 1,
      timeBucket: 'test',
    } as const;

    const filters: DiscoveryPhase1HistoricalSearchInputCohortAssignmentsFilters = {
      assignedAtStart: new Date('2026-04-01T00:00:00.000Z'),
      assignedAtEnd: new Date('2026-04-02T00:00:00.000Z'),
      icpProfileId,
      taskType: cohort.taskType,
      countryCode: cohort.countryCode,
      city: cohort.city,
      language: cohort.language,
      normalizedQueryKey: cohort.normalizedQueryKey,
      queryHash: cohort.queryHash,
      page: cohort.page,
      timeBucket: cohort.timeBucket,
    };

    const assignedAts = {
      alphaPositiveAtStart: filters.assignedAtStart,
      betaNegative: new Date('2026-04-01T09:00:00.000Z'),
      betaNonMatching: new Date('2026-04-01T12:00:00.000Z'),
      betaIncomplete: new Date('2026-04-01T18:00:00.000Z'),
      gammaBoundaryExcluded: filters.assignedAtEnd,
    } as const;

    const searchTaskIds = {
      alphaMatchingNullTaskRun: randomUUID(),
      betaMatchingMismatchedTaskRun: randomUUID(),
      betaNonMatching: randomUUID(),
    } as const;

    const assignmentIds = {
      alphaPositiveAtStart: randomUUID(),
      betaNegative: randomUUID(),
      betaIncomplete: randomUUID(),
      betaNonMatching: randomUUID(),
      gammaBoundaryExcluded: randomUUID(),
    } as const;

    const businessIds = {
      alphaPositiveAtStart: randomUUID(),
      betaNegative: randomUUID(),
      betaIncomplete: randomUUID(),
      betaNonMatching: randomUUID(),
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
        [icpProfileId, `Phase 1 historical cohort assignments ${runIds.alpha}`, now],
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
            ($18, $2, $3, $4, $5, $19, $20, $21, $22::jsonb, $10, $11, $23, $13)
        `,
        [
          searchTaskIds.alphaMatchingNullTaskRun,
          cohort.taskType,
          cohort.countryCode,
          cohort.city,
          cohort.language,
          `phase1 historical assignments alpha ${runIds.alpha}`,
          cohort.normalizedQueryKey,
          cohort.queryHash,
          JSON.stringify({ source: 'db-query-test', task: 'alpha-matching-null-task-run' }),
          cohort.page,
          cohort.timeBucket,
          null,
          now,
          searchTaskIds.betaMatchingMismatchedTaskRun,
          `phase1 historical assignments beta ${runIds.beta}`,
          JSON.stringify({
            source: 'db-query-test',
            task: 'beta-matching-mismatched-task-run',
          }),
          runIds.mismatchedTaskRun,
          searchTaskIds.betaNonMatching,
          `phase1 historical assignments non-matching ${runIds.beta}`,
          `${cohort.normalizedQueryKey}-other`,
          `${cohort.queryHash}-other`,
          JSON.stringify({ source: 'db-query-test', task: 'beta-non-matching' }),
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
            ($11, $12, $3, $13, $14, $6, $15, $16, $17, $10),
            ($18, $12, $3, $19, $14, $6, $20, null, null, $10),
            ($21, $12, $3, $22, $23, $6, $24, $25, $26, $10),
            ($27, $28, $3, $29, $14, $6, $30, $16, $31, $10)
        `,
        [
          assignmentIds.alphaPositiveAtStart,
          runIds.alpha,
          icpProfileId,
          businessIds.alphaPositiveAtStart,
          searchTaskIds.alphaMatchingNullTaskRun,
          'SEARCH_TASK_FIRST_TOUCH',
          assignedAts.alphaPositiveAtStart,
          'LEAD_CREATED',
          now,
          now,
          assignmentIds.betaNegative,
          runIds.beta,
          businessIds.betaNegative,
          searchTaskIds.betaMatchingMismatchedTaskRun,
          assignedAts.betaNegative,
          'PREQUALIFY_DISQUALIFIED',
          now,
          assignmentIds.betaIncomplete,
          businessIds.betaIncomplete,
          assignedAts.betaIncomplete,
          assignmentIds.betaNonMatching,
          businessIds.betaNonMatching,
          searchTaskIds.betaNonMatching,
          assignedAts.betaNonMatching,
          'EXISTING_BUSINESS_NO_UNIQUE_ACTIVE_SAME_BUSINESS_LEAD',
          now,
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
          `historical-assignment-positive-${runIds.alpha}@lead-flood.local`,
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
            searchTaskId: searchTaskIds.alphaMatchingNullTaskRun,
          }),
        ],
      );

      const db = createClientQueryable(client);
      const helperRows = await listDiscoveryPhase1HistoricalSearchInputCohortAssignments(
        filters,
        db,
      );
      const directSqlRows = await db.query<DiscoveryPhase1HistoricalSearchInputCohortAssignmentRow>(
        `
          select
            label.assignment_id,
            label.discovery_run_id,
            assignment.assigned_at,
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
              query_text,
              normalized_query_key,
              query_hash,
              page,
              time_bucket
            from public.search_tasks
          ) as search_task
            on search_task.id = label.search_task_id
          where assignment.assigned_at >= $1
            and assignment.assigned_at < $2
            and label.icp_profile_id = $3
            and search_task.task_type = $4
            and search_task.country_code = $5
            and search_task.city is not distinct from $6
            and search_task.language = $7
            and search_task.normalized_query_key = $8
            and search_task.query_hash = $9
            and search_task.page = $10
            and search_task.time_bucket = $11
          order by
            assignment.assigned_at asc,
            label.discovery_run_id asc,
            label.assignment_id asc
        `,
        [
          filters.assignedAtStart,
          filters.assignedAtEnd,
          filters.icpProfileId,
          filters.taskType,
          filters.countryCode,
          filters.city,
          filters.language,
          filters.normalizedQueryKey,
          filters.queryHash,
          filters.page,
          filters.timeBucket,
        ],
      );

      expect(helperRows).toEqual(directSqlRows.rows);
      expect(helperRows).toHaveLength(3);
      expect(helperRows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            assignment_id: assignmentIds.alphaPositiveAtStart,
            discovery_run_id: runIds.alpha,
            icp_profile_id: icpProfileId,
            business_id: businessIds.alphaPositiveAtStart,
            search_task_id: searchTaskIds.alphaMatchingNullTaskRun,
            primary_outcome_code: 'LEAD_CREATED',
            phase1_class: 'PHASE1_POSITIVE',
            exclusion_reason: null,
            task_type: cohort.taskType,
            country_code: cohort.countryCode,
            city: cohort.city,
            language: cohort.language,
            query_text: `phase1 historical assignments alpha ${runIds.alpha}`,
            normalized_query_key: cohort.normalizedQueryKey,
            query_hash: cohort.queryHash,
            page: cohort.page,
            time_bucket: cohort.timeBucket,
          }),
          expect.objectContaining({
            assignment_id: assignmentIds.betaNegative,
            discovery_run_id: runIds.beta,
            search_task_id: searchTaskIds.betaMatchingMismatchedTaskRun,
            primary_outcome_code: 'PREQUALIFY_DISQUALIFIED',
            phase1_class: 'PHASE1_NEGATIVE',
            query_text: `phase1 historical assignments beta ${runIds.beta}`,
          }),
          expect.objectContaining({
            assignment_id: assignmentIds.betaIncomplete,
            discovery_run_id: runIds.beta,
            search_task_id: searchTaskIds.betaMatchingMismatchedTaskRun,
            primary_outcome_code: null,
            phase1_class: 'EXCLUDE_INCOMPLETE',
            exclusion_reason: 'NULL_PRIMARY_NO_DURABLE_PHASE1_STATE',
            query_text: `phase1 historical assignments beta ${runIds.beta}`,
          }),
        ]),
      );
      expect(helperRows.map((row) => row.assignment_id)).toEqual([
        assignmentIds.alphaPositiveAtStart,
        assignmentIds.betaNegative,
        assignmentIds.betaIncomplete,
      ]);
      expect(new Set(helperRows.map((row) => row.discovery_run_id))).toEqual(
        new Set([runIds.alpha, runIds.beta]),
      );
      expect(helperRows[0]).toHaveProperty('assigned_at');
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
