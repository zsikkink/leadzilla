import { randomUUID } from 'node:crypto';

import { query, type SqlQueryable } from './postgres.js';

export interface PipelineSettingRecord {
  key: string;
  valueJson: unknown;
  updatedAt: Date;
}

interface PipelineSettingSqlRow {
  key: string;
  valueJson: unknown;
  updatedAtMs: number;
}

function toQueryable(): SqlQueryable {
  return { query };
}

function toPipelineSettingRecord(row: PipelineSettingSqlRow): PipelineSettingRecord {
  return {
    key: row.key,
    valueJson: row.valueJson,
    updatedAt: new Date(row.updatedAtMs),
  };
}

function serializeJsonValue(value: unknown): string {
  const serialized = JSON.stringify(value === undefined ? null : value);
  return serialized ?? 'null';
}

export async function listPipelineSettings(
  db: SqlQueryable = toQueryable(),
): Promise<PipelineSettingRecord[]> {
  const result = await db.query<PipelineSettingSqlRow>(
    `
      select
        "key",
        "valueJson",
        (extract(epoch from "updatedAt") * 1000)::double precision as "updatedAtMs"
      from "pipeline_settings"
      order by "key" asc
    `,
  );

  return result.rows.map(toPipelineSettingRecord);
}

export async function listPipelineSettingsByKeys(
  keys: readonly string[],
  db: SqlQueryable = toQueryable(),
): Promise<PipelineSettingRecord[]> {
  if (keys.length === 0) {
    return [];
  }

  const result = await db.query<PipelineSettingSqlRow>(
    `
      select
        "key",
        "valueJson",
        (extract(epoch from "updatedAt") * 1000)::double precision as "updatedAtMs"
      from "pipeline_settings"
      where "key" = any($1::text[])
      order by "key" asc
    `,
    [keys],
  );

  return result.rows.map(toPipelineSettingRecord);
}

export async function getPipelineSetting(
  key: string,
  db: SqlQueryable = toQueryable(),
): Promise<PipelineSettingRecord | null> {
  const result = await db.query<PipelineSettingSqlRow>(
    `
      select
        "key",
        "valueJson",
        (extract(epoch from "updatedAt") * 1000)::double precision as "updatedAtMs"
      from "pipeline_settings"
      where "key" = $1
      limit 1
    `,
    [key],
  );

  const row = result.rows[0];
  return row ? toPipelineSettingRecord(row) : null;
}

export async function getScoreQualificationThresholdSetting(
  fallback: number,
  db: SqlQueryable = toQueryable(),
): Promise<number> {
  const setting = await getPipelineSetting('scoreQualificationThreshold', db);
  if (setting?.valueJson !== null && setting?.valueJson !== undefined) {
    const value = typeof setting.valueJson === 'number'
      ? setting.valueJson
      : Number(setting.valueJson);
    if (Number.isFinite(value) && value >= 0 && value <= 1) {
      return value;
    }
  }

  return fallback;
}

export async function upsertPipelineSetting(
  key: string,
  valueJson: unknown,
  db: SqlQueryable = toQueryable(),
): Promise<PipelineSettingRecord> {
  const result = await db.query<PipelineSettingSqlRow>(
    `
      insert into "pipeline_settings" (
        "id",
        "key",
        "valueJson",
        "updatedAt",
        "createdAt"
      )
      values (
        $1,
        $2,
        $3::jsonb,
        now(),
        now()
      )
      on conflict ("key")
      do update set
        "valueJson" = excluded."valueJson",
        "updatedAt" = now()
      returning
        "key",
        "valueJson",
        (extract(epoch from "updatedAt") * 1000)::double precision as "updatedAtMs"
    `,
    [randomUUID(), key, serializeJsonValue(valueJson)],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error(`Failed to upsert pipeline setting: ${key}`);
  }

  return toPipelineSettingRecord(row);
}
