import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

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

interface AssignmentLabelRow {
  assignment_id: string;
  primary_outcome_code: string | null;
  phase1_class: string;
  exclusion_reason: string | null;
}

afterAll(async () => {
  await pool.end();
});

describe('public.discovery_phase1_assignment_labels_v1', () => {
  it('classifies representative phase-1 assignment rows from durable database state', async () => {
    const runId = `phase1-labels-${randomUUID()}`;
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
        [icpProfileId, `Phase 1 labels ${runId}`, now],
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
          `phase1 labels ${runId}`,
          `phase1-labels-${runId}`,
          `query-hash-${runId}`,
          JSON.stringify({ source: 'db-semantic-test' }),
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
          'db-semantic-test',
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
          JSON.stringify({ source: 'db-semantic-test' }),
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

      const { rows } = await client.query<AssignmentLabelRow>(
        `
          select
            assignment_id,
            primary_outcome_code,
            phase1_class,
            exclusion_reason
          from public.discovery_phase1_assignment_labels_v1
          where discovery_run_id = $1
        `,
        [runId],
      );

      const rowsByAssignmentId = new Map(rows.map((row) => [row.assignment_id, row]));

      expect(rowsByAssignmentId.size).toBe(6);
      expect(rowsByAssignmentId.get(assignmentIds.prequalifyDisqualified)).toEqual({
        assignment_id: assignmentIds.prequalifyDisqualified,
        primary_outcome_code: 'PREQUALIFY_DISQUALIFIED',
        phase1_class: 'PHASE1_NEGATIVE',
        exclusion_reason: null,
      });
      expect(rowsByAssignmentId.get(assignmentIds.leadCreatedPositive)).toEqual({
        assignment_id: assignmentIds.leadCreatedPositive,
        primary_outcome_code: 'LEAD_CREATED',
        phase1_class: 'PHASE1_POSITIVE',
        exclusion_reason: null,
      });
      expect(rowsByAssignmentId.get(assignmentIds.leadCreatedNegative)).toEqual({
        assignment_id: assignmentIds.leadCreatedNegative,
        primary_outcome_code: 'LEAD_CREATED',
        phase1_class: 'PHASE1_NEGATIVE',
        exclusion_reason: null,
      });
      expect(rowsByAssignmentId.get(assignmentIds.leadCreatedNoLineage)).toEqual({
        assignment_id: assignmentIds.leadCreatedNoLineage,
        primary_outcome_code: 'LEAD_CREATED',
        phase1_class: 'EXCLUDE_OPERATIONAL',
        exclusion_reason: 'LEAD_CREATED_NO_PROVABLE_RUN_OWNED_LINEAGE',
      });
      expect(rowsByAssignmentId.get(assignmentIds.nullPrimaryWithConversion)).toEqual({
        assignment_id: assignmentIds.nullPrimaryWithConversion,
        primary_outcome_code: null,
        phase1_class: 'EXCLUDE_OPERATIONAL',
        exclusion_reason: 'NULL_PRIMARY_SAME_RUN_CONVERSION_PRESENT',
      });
      expect(rowsByAssignmentId.get(assignmentIds.nullPrimaryIncomplete)).toEqual({
        assignment_id: assignmentIds.nullPrimaryIncomplete,
        primary_outcome_code: null,
        phase1_class: 'EXCLUDE_INCOMPLETE',
        exclusion_reason: 'NULL_PRIMARY_NO_DURABLE_PHASE1_STATE',
      });
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
