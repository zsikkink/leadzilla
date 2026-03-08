import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, '../../..');

function readRepoFile(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function extractTableValues(sql: string, tempTableName: '_wipe_tables' | '_keep_tables'): string[] {
  const match = sql.match(
    new RegExp(`INSERT INTO ${tempTableName} \\(table_name\\) VALUES\\n([\\s\\S]*?)\\nON CONFLICT`, 'm'),
  );

  expect(match, `Expected ${tempTableName} insert block in reset-data.sql`).toBeTruthy();

  const valuesBlock = match?.[1] ?? '';

  return Array.from(valuesBlock.matchAll(/\('([^']+)'\)/g), (entry) => entry[1] ?? '');
}

describe('data reset plan', () => {
  it('registers the root reset command', () => {
    const packageJson = JSON.parse(readRepoFile('package.json')) as {
      scripts?: Record<string, string | undefined> | undefined;
    };

    expect(packageJson.scripts?.['db:reset-data']).toBe('bash scripts/reset-data.sh');
  });

  it('preserves the exact keep-table set', () => {
    const sql = readRepoFile('scripts/reset-data.sql');

    expect(extractTableValues(sql, '_keep_tables')).toEqual([
      'IcpProfile',
      'QualificationRule',
      'pipeline_settings',
      'TrainingRun',
      'ModelVersion',
      'ModelEvaluation',
      'app_admins',
    ]);
  });

  it('wipes the UI-driving transactional tables', () => {
    const sql = readRepoFile('scripts/reset-data.sql');
    const wipeTables = extractTableValues(sql, '_wipe_tables');

    expect(wipeTables).toEqual(expect.arrayContaining([
      'Lead',
      'lead_rejections',
      'lead_pipeline_events',
      'search_tasks',
      'sources',
      'businesses',
      'business_evidence',
      'business_contacts',
      'business_conversions',
      'LeadDiscoveryRecord',
      'LeadEnrichmentRecord',
      'LeadFeatureSnapshot',
      'LeadScorePrediction',
      'TrainingLabel',
      'MessageDraft',
      'MessageVariant',
      'MessageSend',
      'FeedbackEvent',
      'JobExecution',
      'job_runs',
      'OutboxEvent',
      'job_requests',
      'AnalyticsDailyRollup',
      'ManagerAnalysis',
      'discovery_cost_events',
    ]));
  });

  it('guards execution behind confirmation and backups', () => {
    const shellScript = readRepoFile('scripts/reset-data.sh');

    expect(shellScript).toContain('CONFIRM_RESET=WIPE_LEAD_FLOOD_DATA');
    expect(shellScript).toContain('BACKUP=1');
    expect(shellScript).toContain('No changes made.');
  });
});
