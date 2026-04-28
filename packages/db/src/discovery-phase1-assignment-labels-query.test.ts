import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';

import {
  listDiscoveryPhase1AssignmentLabels,
  listDiscoveryPhase1AssignmentLocationSummaries,
  type DiscoveryPhase1AssignmentLabelRow,
  type DiscoveryPhase1AssignmentLocationSummaryRow,
} from './discovery-phase1-assignment-labels-query.js';
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

describe('listDiscoveryPhase1AssignmentLabels', () => {
  it('matches a direct SQL select from public.discovery_phase1_assignment_labels_v1', async () => {
    const runId = `phase1-labels-query-${randomUUID()}`;
    const searchTaskId = randomUUID();
    const icpProfileId = `icp-${randomUUID()}`;
    const now = new Date();

    const assignmentIds = {
      prequalifyDisqualified: randomUUID(),
      leadCreatedPositive: randomUUID(),
      leadCreatedNegative: randomUUID(),
      leadCreatedNoLineage: randomUUID(),
      nullPrimaryWithConversion: randomUUID(),
      nullPrimaryIncomplete: randomUUID(),
    } as const;

    const businessIds = {
      prequalifyDisqualified: randomUUID(),
      leadCreatedPositive: randomUUID(),
      leadCreatedNegative: randomUUID(),
      leadCreatedNoLineage: randomUUID(),
      nullPrimaryWithConversion: randomUUID(),
      nullPrimaryIncomplete: randomUUID(),
    } as const;

    const leadIds = {
      leadCreatedPositive: `lead-${randomUUID()}`,
      leadCreatedNegative: `lead-${randomUUID()}`,
      leadCreatedNoLineage: `lead-${randomUUID()}`,
      nullPrimaryWithConversion: `lead-${randomUUID()}`,
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
        [icpProfileId, `Phase 1 labels query ${runId}`, now],
      );

      await client.query(
        `
          insert into public.search_tasks (
            "id",
            "task_type",
            "country_code",
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
          values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12)
        `,
        [
          searchTaskId,
          'SERP_GOOGLE',
          'JO',
          'en',
          `phase1 labels query ${runId}`,
          `phase1-labels-query-${runId}`,
          `query-hash-${runId}`,
          JSON.stringify({ source: 'db-query-test' }),
          1,
          'test',
          runId,
          now,
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
            ($10, $2, $3, $11, $5, $6, $12, $8, $9),
            ($13, $2, $3, $14, $5, $6, $12, $8, $9),
            ($15, $2, $3, $16, $5, $6, $12, $8, $9),
            ($17, $2, $3, $18, $5, $6, null, null, $9),
            ($19, $2, $3, $20, $5, $6, null, null, $9)
        `,
        [
          assignmentIds.prequalifyDisqualified,
          runId,
          icpProfileId,
          businessIds.prequalifyDisqualified,
          searchTaskId,
          'SEARCH_TASK_FIRST_TOUCH',
          'PREQUALIFY_DISQUALIFIED',
          now,
          now,
          assignmentIds.leadCreatedPositive,
          businessIds.leadCreatedPositive,
          'LEAD_CREATED',
          assignmentIds.leadCreatedNegative,
          businessIds.leadCreatedNegative,
          assignmentIds.leadCreatedNoLineage,
          businessIds.leadCreatedNoLineage,
          assignmentIds.nullPrimaryWithConversion,
          businessIds.nullPrimaryWithConversion,
          assignmentIds.nullPrimaryIncomplete,
          businessIds.nullPrimaryIncomplete,
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
          values
            ($1, $2, $3, $4, $5, $6, $7, $8),
            ($9, $2, $3, $10, $5, $11, $12, $8),
            ($13, $2, $3, $14, $5, $6, $15, $8),
            ($16, $2, $3, $17, $5, $6, $18, $8)
        `,
        [
          leadIds.leadCreatedPositive,
          'Phase1',
          'Tester',
          `positive-${runId}@lead-flood.local`,
          'db-query-test',
          'qualified',
          businessIds.leadCreatedPositive,
          now,
          leadIds.leadCreatedNegative,
          `negative-${runId}@lead-flood.local`,
          'rejected',
          businessIds.leadCreatedNegative,
          leadIds.leadCreatedNoLineage,
          `no-lineage-${runId}@lead-flood.local`,
          businessIds.leadCreatedNoLineage,
          leadIds.nullPrimaryWithConversion,
          `null-primary-${runId}@lead-flood.local`,
          businessIds.nullPrimaryWithConversion,
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
          values
            ($1, $2, $3, $4, $5::jsonb),
            ($6, $7, $8, $4, $9::jsonb),
            ($10, $11, $12, $4, $13::jsonb),
            ($14, $15, $16, $4, $17::jsonb)
        `,
        [
          `conversion-${randomUUID()}`,
          businessIds.leadCreatedPositive,
          leadIds.leadCreatedPositive,
          icpProfileId,
          JSON.stringify({ discoveryRunId: runId }),
          `conversion-${randomUUID()}`,
          businessIds.leadCreatedNegative,
          leadIds.leadCreatedNegative,
          JSON.stringify({ discoveryRunId: runId }),
          `conversion-${randomUUID()}`,
          businessIds.leadCreatedNoLineage,
          leadIds.leadCreatedNoLineage,
          JSON.stringify({ discoveryRunId: runId }),
          `conversion-${randomUUID()}`,
          businessIds.nullPrimaryWithConversion,
          leadIds.nullPrimaryWithConversion,
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
          values
            ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb),
            ($9, $10, $3, $4, $11, $12, $7::jsonb, $13::jsonb)
        `,
        [
          `discovery-record-${randomUUID()}`,
          leadIds.leadCreatedPositive,
          icpProfileId,
          'GOOGLE_SEARCH',
          `provider-record-${randomUUID()}`,
          `query-hash-positive-${runId}`,
          JSON.stringify({ source: 'db-query-test' }),
          JSON.stringify({
            businessId: businessIds.leadCreatedPositive,
            discoveryRunId: runId,
            searchTaskId,
          }),
          `discovery-record-${randomUUID()}`,
          leadIds.leadCreatedNegative,
          `provider-record-${randomUUID()}`,
          `query-hash-negative-${runId}`,
          JSON.stringify({
            businessId: businessIds.leadCreatedNegative,
            discoveryRunId: runId,
            searchTaskId,
          }),
        ],
      );

      await client.query(
        `
          insert into public.lead_rejections (
            "id",
            "leadId",
            "businessId",
            "icpProfileId",
            "reason",
            "rejectedBy"
          )
          values ($1, $2, $3, $4, $5, $6)
        `,
        [
          `rejection-${randomUUID()}`,
          leadIds.leadCreatedNegative,
          businessIds.leadCreatedNegative,
          icpProfileId,
          'NO_DECISION_MAKER',
          'system:business.convert',
        ],
      );

      const db = createClientQueryable(client);
      const helperRows = await listDiscoveryPhase1AssignmentLabels(runId, db);
      const directSqlRows = await db.query<DiscoveryPhase1AssignmentLabelRow>(
        `
          select
            assignment_id,
            discovery_run_id,
            icp_profile_id,
            business_id,
            search_task_id,
            primary_outcome_code,
            phase1_class,
            exclusion_reason
          from public.discovery_phase1_assignment_labels_v1
          where discovery_run_id = $1
          order by assignment_id asc
        `,
        [runId],
      );

      expect(helperRows).toEqual(directSqlRows.rows);
      expect(helperRows).toHaveLength(6);
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

describe('listDiscoveryPhase1AssignmentLocationSummaries', () => {
  it('aggregates the existing phase-1 labels by icp and assigned search-task location across selected runs', async () => {
    const runIds = {
      alpha: `phase1-location-summary-alpha-${randomUUID()}`,
      beta: `phase1-location-summary-beta-${randomUUID()}`,
    } as const;
    const icpProfileId = `icp-${randomUUID()}`;
    const now = new Date();

    const searchTaskIds = {
      alpha: randomUUID(),
      beta: randomUUID(),
    } as const;

    const businessIds = {
      negativeDubai: randomUUID(),
      positiveDubai: randomUUID(),
      holdoutDubai: randomUUID(),
      existingSameBusinessNullCity: randomUUID(),
      incompleteNullCity: randomUUID(),
    } as const;

    const assignmentIds = {
      negativeDubai: randomUUID(),
      positiveDubai: randomUUID(),
      holdoutDubai: randomUUID(),
      existingSameBusinessNullCity: randomUUID(),
      incompleteNullCity: randomUUID(),
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
        [icpProfileId, `Phase 1 location summary ${runIds.alpha}`, now],
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
            ($14, $15, $16, $17, $18, $19, $20, $21, $9::jsonb, $10, $11, $22, $13)
        `,
        [
          searchTaskIds.alpha,
          'SERP_GOOGLE_LOCAL',
          'AE',
          'Dubai',
          'en',
          `phase1 location summary ${runIds.alpha}`,
          `phase1-location-summary-${runIds.alpha}`,
          `query-hash-${runIds.alpha}`,
          JSON.stringify({ source: 'db-query-test' }),
          1,
          'test',
          runIds.alpha,
          now,
          searchTaskIds.beta,
          'SERP_GOOGLE_LOCAL',
          'JO',
          'Amman',
          'en',
          `phase1 location summary ${runIds.beta}`,
          `phase1-location-summary-${runIds.beta}`,
          `query-hash-${runIds.beta}`,
          runIds.beta,
        ],
      );

      await client.query(
        `
          insert into public.businesses ("id", "name", "country_code", "city", "updated_at")
          values
            ($1, $2, $3, $4, $5),
            ($6, $7, $3, $4, $5),
            ($8, $9, $3, $4, $5),
            ($10, $11, $3, null, $5),
            ($12, $13, $3, null, $5)
        `,
        [
          businessIds.negativeDubai,
          `Negative Dubai ${runIds.alpha}`,
          'SA',
          'Riyadh',
          now,
          businessIds.positiveDubai,
          `Positive Dubai ${runIds.alpha}`,
          businessIds.holdoutDubai,
          `Holdout Dubai ${runIds.beta}`,
          businessIds.existingSameBusinessNullCity,
          `Operational null city ${runIds.alpha}`,
          businessIds.incompleteNullCity,
          `Incomplete null city ${runIds.beta}`,
        ],
      );

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
            ($10, $2, $3, $11, $5, $6, $12, $8, $9),
            ($13, $14, $3, $15, $16, $6, $17, $8, $9),
            ($18, $2, $3, $19, $5, $6, $20, $8, $9),
            ($21, $14, $3, $22, $16, $6, null, null, $9)
        `,
        [
          assignmentIds.negativeDubai,
          runIds.alpha,
          icpProfileId,
          businessIds.negativeDubai,
          searchTaskIds.alpha,
          'SEARCH_TASK_FIRST_TOUCH',
          'PREQUALIFY_DISQUALIFIED',
          now,
          now,
          assignmentIds.positiveDubai,
          businessIds.positiveDubai,
          'LEAD_CREATED',
          assignmentIds.holdoutDubai,
          runIds.beta,
          businessIds.holdoutDubai,
          searchTaskIds.beta,
          'RECOVERY_OPENED',
          assignmentIds.existingSameBusinessNullCity,
          businessIds.existingSameBusinessNullCity,
          'EXISTING_SAME_BUSINESS_LEAD_REUSED',
          assignmentIds.incompleteNullCity,
          businessIds.incompleteNullCity,
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
          'Positive',
          `positive-${runIds.alpha}@lead-flood.local`,
          'db-query-test',
          'qualified',
          businessIds.positiveDubai,
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
          businessIds.positiveDubai,
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
            businessId: businessIds.positiveDubai,
            discoveryRunId: runIds.alpha,
            searchTaskId: searchTaskIds.alpha,
          }),
        ],
      );

      const db = createClientQueryable(client);
      const helperRows = await listDiscoveryPhase1AssignmentLocationSummaries(
        [runIds.alpha, runIds.beta],
        db,
      );
      const directSqlRows = await db.query<DiscoveryPhase1AssignmentLocationSummaryRow>(
        `
          select
            label.icp_profile_id,
            search_task.country_code,
            search_task.city,
            count(*)::integer as assignment_count,
            count(*) filter (
              where label.phase1_class = 'PHASE1_POSITIVE'
            )::integer as phase1_positive_count,
            count(*) filter (
              where label.phase1_class = 'PHASE1_NEGATIVE'
            )::integer as phase1_negative_count,
            count(*) filter (
              where label.phase1_class = 'HOLDOUT_AMBIGUOUS'
            )::integer as holdout_ambiguous_count,
            count(*) filter (
              where label.phase1_class = 'EXCLUDE_OPERATIONAL'
            )::integer as exclude_operational_count,
            count(*) filter (
              where label.phase1_class = 'EXCLUDE_INCOMPLETE'
            )::integer as exclude_incomplete_count
          from public.discovery_phase1_assignment_labels_v1 as label
          join public.search_tasks as search_task
            on search_task."id" = label.search_task_id
          where label.discovery_run_id = any($1::text[])
          group by
            label.icp_profile_id,
            search_task.country_code,
            search_task.city
          order by
            label.icp_profile_id asc,
            search_task.country_code asc,
            search_task.city asc nulls first
        `,
        [[runIds.alpha, runIds.beta]],
      );

      expect(helperRows).toEqual(directSqlRows.rows);
      expect(helperRows).toEqual([
        {
          icp_profile_id: icpProfileId,
          country_code: 'AE',
          city: 'Dubai',
          assignment_count: 3,
          phase1_positive_count: 1,
          phase1_negative_count: 1,
          holdout_ambiguous_count: 0,
          exclude_operational_count: 1,
          exclude_incomplete_count: 0,
        },
        {
          icp_profile_id: icpProfileId,
          country_code: 'JO',
          city: 'Amman',
          assignment_count: 2,
          phase1_positive_count: 0,
          phase1_negative_count: 0,
          holdout_ambiguous_count: 1,
          exclude_operational_count: 0,
          exclude_incomplete_count: 1,
        },
      ]);
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
