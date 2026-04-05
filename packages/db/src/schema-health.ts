import { query, type SqlQueryable } from './postgres.js';

// Keep the worker guard slightly narrower than API readiness: the worker can
// disable the legacy job-request dispatcher if `job_requests` is absent, while
// the API's admin discovery surface still queries that table directly.
const REQUIRED_TABLES_BY_SCOPE = {
  api: [
    'contact_recovery_items',
    'job_requests',
    'job_runs',
    'search_tasks',
  ],
  worker: [
    'contact_recovery_items',
    'job_runs',
    'search_tasks',
  ],
} as const;

const BROWSER_ROLES = ['anon', 'authenticated'] as const;

const TABLE_PRIVILEGES = [
  'DELETE',
  'INSERT',
  'REFERENCES',
  'SELECT',
  'TRIGGER',
  'TRUNCATE',
  'UPDATE',
] as const;

const REQUIRED_ENUM_VALUES = [
  { enumName: 'ContactRecoveryReason', value: 'DECISION_MAKER_IDENTIFIED' },
  { enumName: 'CostEventProvider', value: 'GOOGLE_CUSTOM_SEARCH' },
  { enumName: 'MessageSendStatus', value: 'SENDING' },
  { enumName: 'MessageSendStatus', value: 'UNRESOLVED' },
] as const;

const REQUIRED_DISCOVERY_ATTRIBUTION_PRIMARY_OUTCOME_CODES = [
  'PREQUALIFY_DISQUALIFIED',
  'RECOVERY_OPENED',
  'LEAD_CREATED',
  'EXISTING_SAME_BUSINESS_LEAD_REUSED',
  'EXISTING_BUSINESS_NO_UNIQUE_ACTIVE_SAME_BUSINESS_LEAD',
] as const;

// These browser-role revokes are the committed backend-boundary contract from
// the 2026-03-21 Supabase migrations. Keep the list explicit rather than
// broadening this guard into a general privilege audit.
const INTERNAL_TABLES_REQUIRING_BROWSER_ROLE_REVOKES = [
  'LeadFeatureSnapshot',
  'LeadScorePrediction',
  'MessageDraft',
  'MessageVariant',
  'MessageSend',
  'FeedbackEvent',
  'Lead',
  'JobExecution',
  'LeadDiscoveryRecord',
  'LeadEnrichmentRecord',
  'OutboxEvent',
  'TrainingRun',
  'TrainingLabel',
  'ModelVersion',
  'ModelEvaluation',
  'AnalyticsDailyRollup',
  'IcpProfile',
  'QualificationRule',
  'app_admins',
  'businesses',
  'business_contacts',
  'business_conversions',
  'business_evidence',
  'contact_recovery_items',
  'discovery_attribution_assignments',
  'discovery_cost_events',
  'job_runs',
  'lead_pipeline_events',
  'lead_rejections',
  'manager_recommendation_records',
  'pipeline_settings',
  'search_tasks',
  'sources',
  'job_requests',
  'ManagerAnalysis',
  'Session',
  'User',
] as const;

const REVOKED_BROWSER_DEFAULT_PRIVILEGES = [
  { ownerRole: 'postgres', schemaName: 'public', objectType: 'FUNCTIONS', roleName: 'anon' },
  { ownerRole: 'postgres', schemaName: 'public', objectType: 'FUNCTIONS', roleName: 'authenticated' },
  { ownerRole: 'postgres', schemaName: 'public', objectType: 'TABLES', roleName: 'anon' },
  { ownerRole: 'postgres', schemaName: 'public', objectType: 'TABLES', roleName: 'authenticated' },
] as const;

export type PipelineSchemaHealthScope = keyof typeof REQUIRED_TABLES_BY_SCOPE;

export interface PipelineSchemaHealth {
  status: 'ok' | 'fail';
  missingTables: string[];
  missingEnumValues: string[];
  missingCheckConstraints: string[];
  unexpectedTablePrivileges: string[];
  unexpectedDefaultPrivileges: string[];
}

async function checkSchemaHealthForScope(
  scope: PipelineSchemaHealthScope,
  db: SqlQueryable = { query },
): Promise<PipelineSchemaHealth> {
  const requiredTables = REQUIRED_TABLES_BY_SCOPE[scope];
  const enumNames = REQUIRED_ENUM_VALUES.map((value) => value.enumName);
  const enumValues = REQUIRED_ENUM_VALUES.map((value) => value.value);

  const tableRows = await db.query<{ table_name: string }>(
    `
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name = any($1::text[])
    `,
    [requiredTables],
  );

  const enumRows = await db.query<{ enum_name: string; enum_value: string }>(
    `
      select requested.enum_name as enum_name, requested.enum_value as enum_value
      from unnest($1::text[], $2::text[]) as requested(enum_name, enum_value)
      join pg_type t on t.typname = requested.enum_name
      join pg_enum e
        on e.enumtypid = t.oid
       and e.enumlabel = requested.enum_value
    `,
    [enumNames, enumValues],
  );

  const tablePrivilegeRows = await db.query<{
    table_name: string;
    role_name: string;
    privileges: string[];
  }>(
    `
      with present_tables as (
        select table_name
        from information_schema.tables
        where table_schema = 'public'
          and table_name = any($1::text[])
      )
      select
        present_tables.table_name as table_name,
        browser_roles.role_name as role_name,
        array_agg(granted.privilege_type order by granted.privilege_type) as privileges
      from present_tables
      cross join unnest($2::text[]) as browser_roles(role_name)
      cross join lateral (
        select privilege_type
        from unnest($3::text[]) as privilege_type
        where has_table_privilege(
          browser_roles.role_name,
          format('%I.%I', 'public', present_tables.table_name),
          privilege_type
        )
      ) as granted
      group by present_tables.table_name, browser_roles.role_name
      order by present_tables.table_name, browser_roles.role_name
    `,
    [
      INTERNAL_TABLES_REQUIRING_BROWSER_ROLE_REVOKES,
      BROWSER_ROLES,
      TABLE_PRIVILEGES,
    ],
  );

  const defaultPrivilegeRows = await db.query<{
    object_type: string;
    role_name: string;
    privileges: string[];
  }>(
    `
      select
        case default_acl.defaclobjtype
          when 'f' then 'FUNCTIONS'
          when 'r' then 'TABLES'
        end as object_type,
        grantee.rolname as role_name,
        array_agg(distinct acl.privilege_type order by acl.privilege_type) as privileges
      from pg_default_acl as default_acl
      join pg_namespace as schema_namespace
        on schema_namespace.oid = default_acl.defaclnamespace
       and schema_namespace.nspname = 'public'
      join pg_roles as owner_role
        on owner_role.oid = default_acl.defaclrole
       and owner_role.rolname = 'postgres'
      cross join lateral aclexplode(coalesce(default_acl.defaclacl, '{}'::aclitem[]))
        as acl(grantor, grantee, privilege_type, is_grantable)
      join pg_roles as grantee
        on grantee.oid = acl.grantee
      where default_acl.defaclobjtype::text = any($1::text[])
        and grantee.rolname = any($2::text[])
      group by default_acl.defaclobjtype, grantee.rolname
      order by default_acl.defaclobjtype, grantee.rolname
    `,
    [
      REVOKED_BROWSER_DEFAULT_PRIVILEGES.map((expectation) =>
        expectation.objectType === 'FUNCTIONS' ? 'f' : 'r',
      ),
      BROWSER_ROLES,
    ],
  );

  const primaryOutcomeConstraintRows = await db.query<{
    allowed_primary_outcome_codes: string[];
  }>(
    `
      select
        coalesce(
          array_agg(distinct matched.value order by matched.value),
          '{}'::text[]
        ) as allowed_primary_outcome_codes
      from pg_constraint as constraint_record
      join pg_class as table_record
        on table_record.oid = constraint_record.conrelid
      join pg_namespace as schema_record
        on schema_record.oid = table_record.relnamespace
      left join lateral (
        select matches[1] as value
        from regexp_matches(
          pg_get_constraintdef(constraint_record.oid),
          '''([^'']+)''',
          'g'
        ) as matches
      ) as matched
        on true
      where schema_record.nspname = 'public'
        and table_record.relname = 'discovery_attribution_assignments'
        and constraint_record.conname = 'discovery_attribution_assignments_primary_outcome_chk'
        and constraint_record.contype = 'c'
      group by constraint_record.oid
    `,
  );

  const presentTables = new Set(
    tableRows.rows.map((row: { table_name: string }) => row.table_name),
  );
  const presentEnumValues = new Set(
    enumRows.rows.map(
      (row: { enum_name: string; enum_value: string }) =>
        `${row.enum_name}:${row.enum_value}`,
    ),
  );

  const missingTables = requiredTables.filter((value) => !presentTables.has(value));
  const missingEnumValues = REQUIRED_ENUM_VALUES
    .map((value) => `${value.enumName}:${value.value}`)
    .filter((value) => !presentEnumValues.has(value));
  const presentPrimaryOutcomeCodes = new Set(
    primaryOutcomeConstraintRows.rows[0]?.allowed_primary_outcome_codes ?? [],
  );
  const missingCheckConstraints = REQUIRED_DISCOVERY_ATTRIBUTION_PRIMARY_OUTCOME_CODES
    .filter((value) => !presentPrimaryOutcomeCodes.has(value))
    .map(
      (value) =>
        `public.discovery_attribution_assignments_primary_outcome_chk:${value}`,
    );
  const unexpectedTablePrivileges = tablePrivilegeRows.rows.map(
    (row) => `public.${row.table_name}:${row.role_name}:${row.privileges.join(',')}`,
  );
  const expectedDefaultPrivilegeKeys = new Set(
    REVOKED_BROWSER_DEFAULT_PRIVILEGES.map(
      (expectation) =>
        `${expectation.ownerRole}:${expectation.schemaName}:${expectation.objectType}:${expectation.roleName}`,
    ),
  );
  const unexpectedDefaultPrivileges = defaultPrivilegeRows.rows
    .map(
      (row) => ({
        key: `postgres:public:${row.object_type}:${row.role_name}`,
        value: `postgres:public:${row.object_type}:${row.role_name}:${row.privileges.join(',')}`,
      }),
    )
    .filter((row) => expectedDefaultPrivilegeKeys.has(row.key))
    .map((row) => row.value);

  return {
    status:
      missingTables.length === 0
      && missingEnumValues.length === 0
      && missingCheckConstraints.length === 0
      && unexpectedTablePrivileges.length === 0
      && unexpectedDefaultPrivileges.length === 0
        ? 'ok'
        : 'fail',
    missingTables,
    missingEnumValues,
    missingCheckConstraints,
    unexpectedTablePrivileges,
    unexpectedDefaultPrivileges,
  };
}

export async function checkPipelineSchemaHealth(
  db: SqlQueryable = { query },
): Promise<PipelineSchemaHealth> {
  return checkSchemaHealthForScope('api', db);
}

export async function checkWorkerSchemaHealth(
  db: SqlQueryable = { query },
): Promise<PipelineSchemaHealth> {
  return checkSchemaHealthForScope('worker', db);
}
