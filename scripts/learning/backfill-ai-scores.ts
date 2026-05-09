import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FeaturesComputeJobPayload } from '../../apps/worker/src/jobs/features.compute.job.js';
import type { ScoringComputeJobPayload } from '../../apps/worker/src/jobs/scoring.compute.job.js';

interface BackfillArgs {
  batchSize: number;
  concurrency: number;
  dryRun: boolean;
  limit?: number;
  leadIds: string[];
  onlyMissingPredictions: boolean;
  refreshFeatureSnapshots: boolean;
  skipFeatureBackfill: boolean;
  allowRemote: boolean;
}

interface ScriptLogger {
  info: (object: Record<string, unknown>, message: string) => void;
  warn: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
}

interface LeadTarget {
  leadId: string;
  icpProfileId: string;
  source: 'business_conversion' | 'discovery_record' | 'feature_snapshot';
}

interface ScoreBatch {
  icpProfileId: string;
  leadIds: string[];
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '../..');
const BASELINE_MODEL_VERSION_TAG = 'deterministic-baseline-v1';

function parseArgs(argv: string[]): BackfillArgs {
  const args: BackfillArgs = {
    batchSize: 25,
    concurrency: 2,
    dryRun: false,
    leadIds: [],
    onlyMissingPredictions: false,
    refreshFeatureSnapshots: false,
    skipFeatureBackfill: false,
    allowRemote: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--batchSize') {
      const parsed = Number(argv[index + 1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        args.batchSize = Math.floor(parsed);
      }
      index += 1;
      continue;
    }
    if (value === '--concurrency') {
      const parsed = Number(argv[index + 1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        args.concurrency = Math.floor(parsed);
      }
      index += 1;
      continue;
    }
    if (value === '--limit') {
      const parsed = Number(argv[index + 1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        args.limit = Math.floor(parsed);
      }
      index += 1;
      continue;
    }
    if (value === '--leadId') {
      const leadId = argv[index + 1]?.trim();
      if (leadId) {
        args.leadIds.push(leadId);
      }
      index += 1;
      continue;
    }
    if (value === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (value === '--only-missing-predictions') {
      args.onlyMissingPredictions = true;
      continue;
    }
    if (value === '--refresh-feature-snapshots') {
      args.refreshFeatureSnapshots = true;
      continue;
    }
    if (value === '--skip-feature-backfill') {
      args.skipFeatureBackfill = true;
      continue;
    }
    if (value === '--allow-remote') {
      args.allowRemote = true;
      continue;
    }
  }

  return args;
}

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) {
    return;
  }

  const content = readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const line = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
    const equalsIndex = line.indexOf('=');
    if (equalsIndex <= 0) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] ??= value;
  }
}

function loadRuntimeEnv(): void {
  // Match the local API/worker stack by default. Root .env.local is only a fallback
  // for values not present in app-local env files.
  loadEnvFile(resolve(REPO_ROOT, 'apps/api/.env.local'));
  loadEnvFile(resolve(REPO_ROOT, 'apps/worker/.env.local'));
  loadEnvFile(resolve(REPO_ROOT, '.env.local'));
}

function classifyDatabaseUrl(value: string | undefined): 'local-docker' | 'remote-supabase' | 'other' | 'missing' {
  if (!value) {
    return 'missing';
  }
  if (value.includes('localhost:5434') || value.includes('127.0.0.1:5434')) {
    return 'local-docker';
  }
  if (value.includes('supabase.com')) {
    return 'remote-supabase';
  }
  return 'other';
}

function buildLogger(): ScriptLogger {
  return {
    info: (object, message) => {
      console.log(JSON.stringify({ level: 'info', message, ...object }));
    },
    warn: (object, message) => {
      console.warn(JSON.stringify({ level: 'warn', message, ...object }));
    },
    error: (object, message) => {
      console.error(JSON.stringify({ level: 'error', message, ...object }));
    },
  };
}

function buildHandlerLogger(logger: ScriptLogger): ScriptLogger {
  return {
    info: () => undefined,
    warn: (object, message) => logger.warn(object, message),
    error: (object, message) => logger.error(object, message),
  };
}

function firstByLeadId<T extends { leadId: string; icpProfileId: string | null }>(
  rows: T[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.icpProfileId && !map.has(row.leadId)) {
      map.set(row.leadId, row.icpProfileId);
    }
  }
  return map;
}

function snapshotKey(leadId: string, icpProfileId: string): string {
  return `${leadId}:${icpProfileId}`;
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function optionalPositiveNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function runPool<T>(
  tasks: T[],
  concurrency: number,
  fn: (task: T, index: number) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  let shouldStop = false;

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (true) {
      if (shouldStop) {
        return;
      }
      const index = nextIndex;
      nextIndex += 1;
      if (index >= tasks.length) {
        return;
      }
      try {
        await fn(tasks[index]!, index);
      } catch (error: unknown) {
        shouldStop = true;
        throw error;
      }
    }
  });

  const results = await Promise.allSettled(workers);
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failure) {
    throw failure.reason;
  }
}

async function run(): Promise<void> {
  loadRuntimeEnv();

  const args = parseArgs(process.argv.slice(2));
  const logger = buildLogger();
  const databaseTarget = classifyDatabaseUrl(process.env.DATABASE_URL);

  if (databaseTarget === 'missing') {
    throw new Error('DATABASE_URL is not configured');
  }
  if (databaseTarget === 'remote-supabase' && !args.allowRemote) {
    throw new Error('Refusing to run against remote Supabase without --allow-remote');
  }

  const { prisma } = await import('../../packages/db/dist/src/index.js');
  const { OpenAiAdapter } = await import('../../packages/providers/src/index.ts');
  const {
    handleScoringComputeJob,
    SCORING_COMPUTE_JOB_NAME,
  } = await import('../../apps/worker/src/jobs/scoring.compute.job.js');
  const {
    FEATURE_EXTRACTOR_VERSION,
    FEATURES_COMPUTE_JOB_NAME,
    handleFeaturesComputeJob,
  } = await import('../../apps/worker/src/jobs/features.compute.job.js');

  try {
    const activeTrainedModel = await prisma.modelVersion.findFirst({
      where: {
        stage: 'ACTIVE',
        modelType: 'LOGISTIC_REGRESSION',
        versionTag: { not: BASELINE_MODEL_VERSION_TAG },
      },
      select: { id: true, versionTag: true },
    });
    if (activeTrainedModel) {
      throw new Error(
        `Refusing OpenAI-only backfill because active trained model ${activeTrainedModel.versionTag} exists`,
      );
    }

    if (!args.dryRun && !process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required for AI score backfill');
    }

    const leads = await prisma.lead.findMany({
      where: {
        deletedAt: null,
        ...(args.leadIds.length > 0 ? { id: { in: args.leadIds } } : {}),
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const leadIds = leads.map((lead) => lead.id);

    const [conversions, discoveries, snapshots] = await Promise.all([
      prisma.businessConversion.findMany({
        where: {
          leadId: { in: leadIds },
          icpProfileId: { not: null },
        },
        select: { leadId: true, icpProfileId: true },
        orderBy: [{ convertedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      }),
      prisma.leadDiscoveryRecord.findMany({
        where: { leadId: { in: leadIds } },
        select: { leadId: true, icpProfileId: true },
        orderBy: [{ discoveredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      }),
      prisma.leadFeatureSnapshot.findMany({
        where: { leadId: { in: leadIds } },
        select: { leadId: true, icpProfileId: true },
        orderBy: [{ computedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      }),
    ]);

    const conversionIcpByLead = firstByLeadId(conversions);
    const discoveryIcpByLead = firstByLeadId(discoveries);
    const snapshotIcpByLead = firstByLeadId(snapshots);

    const latestSnapshotByLeadIcp = new Set<string>();
    for (const snapshot of snapshots) {
      latestSnapshotByLeadIcp.add(snapshotKey(snapshot.leadId, snapshot.icpProfileId));
    }

    const unresolvedLeadIds: string[] = [];
    const targets: LeadTarget[] = [];
    for (const leadId of leadIds) {
      const conversionIcp = conversionIcpByLead.get(leadId);
      const discoveryIcp = discoveryIcpByLead.get(leadId);
      const snapshotIcp = snapshotIcpByLead.get(leadId);
      const icpProfileId = conversionIcp ?? discoveryIcp ?? snapshotIcp;
      if (!icpProfileId) {
        unresolvedLeadIds.push(leadId);
        continue;
      }
      targets.push({
        leadId,
        icpProfileId,
        source: conversionIcp
          ? 'business_conversion'
          : discoveryIcp
            ? 'discovery_record'
            : 'feature_snapshot',
      });
    }

    let selectedTargets = args.limit ? targets.slice(0, args.limit) : targets;

    if (args.onlyMissingPredictions && selectedTargets.length > 0) {
      const predictions = await prisma.leadScorePrediction.findMany({
        where: {
          leadId: { in: selectedTargets.map((target) => target.leadId) },
        },
        select: { leadId: true, icpProfileId: true, reasonsJson: true },
      });
      const predictionKeys = new Set(
        predictions
          .filter((prediction) => {
            const reasons = prediction.reasonsJson;
            return Boolean(
              reasons &&
                typeof reasons === 'object' &&
                (reasons as Record<string, unknown>).scoreSource === 'llm',
            );
          })
          .map((prediction) => snapshotKey(prediction.leadId, prediction.icpProfileId)),
      );
      selectedTargets = selectedTargets.filter(
        (target) => !predictionKeys.has(snapshotKey(target.leadId, target.icpProfileId)),
      );
    }

    const missingSnapshotTargets = selectedTargets.filter(
      (target) => !latestSnapshotByLeadIcp.has(snapshotKey(target.leadId, target.icpProfileId)),
    );
    const featureBackfillTargets = args.refreshFeatureSnapshots ? selectedTargets : missingSnapshotTargets;

    const targetSourceCounts = selectedTargets.reduce<Record<string, number>>((acc, target) => {
      acc[target.source] = (acc[target.source] ?? 0) + 1;
      return acc;
    }, {});

    logger.info(
      {
        databaseTarget,
        totalLeads: leadIds.length,
        resolvedTargets: targets.length,
        selectedTargets: selectedTargets.length,
        unresolvedLeads: unresolvedLeadIds.length,
        missingSnapshotsForSelectedTargets: missingSnapshotTargets.length,
        featureBackfillTargets: featureBackfillTargets.length,
        targetSourceCounts,
        batchSize: args.batchSize,
        concurrency: args.concurrency,
        onlyMissingPredictions: args.onlyMissingPredictions,
        refreshFeatureSnapshots: args.refreshFeatureSnapshots,
        dryRun: args.dryRun,
      },
      'Prepared AI score backfill targets',
    );

    if (unresolvedLeadIds.length > 0) {
      logger.warn(
        { unresolvedLeadIds: unresolvedLeadIds.slice(0, 20), omitted: Math.max(0, unresolvedLeadIds.length - 20) },
        'Some leads have no ICP assignment and cannot be scored',
      );
    }

    if (args.dryRun) {
      return;
    }

    const handlerLogger = buildHandlerLogger(logger);
    const failedFeatureKeys = new Set<string>();

    if (!args.skipFeatureBackfill && featureBackfillTargets.length > 0) {
      const featureRunId = `backfill.ai-scores.features:${Date.now()}`;
      let refreshedFeatureSnapshotCount = 0;
      await runPool(featureBackfillTargets, args.concurrency, async (target) => {
        const payload: FeaturesComputeJobPayload = {
          runId: featureRunId,
          leadId: target.leadId,
          icpProfileId: target.icpProfileId,
          snapshotVersion: 1,
          sourceVersion: FEATURE_EXTRACTOR_VERSION,
          correlationId: `backfill-ai-scores:${target.leadId}:${target.icpProfileId}`,
        };

        try {
          await handleFeaturesComputeJob(
            handlerLogger,
            {
              id: `backfill-ai-scores:features:${target.leadId}:${target.icpProfileId}`,
              name: FEATURES_COMPUTE_JOB_NAME,
              data: payload,
            } as unknown as import('pg-boss').Job<FeaturesComputeJobPayload>,
            {
              boss: { send: async () => null },
              enqueueScoring: false,
            },
          );
          refreshedFeatureSnapshotCount += 1;
          if (
            refreshedFeatureSnapshotCount % 100 === 0 ||
            refreshedFeatureSnapshotCount === featureBackfillTargets.length
          ) {
            logger.info(
              {
                refreshedFeatureSnapshots: refreshedFeatureSnapshotCount,
                totalFeatureBackfillTargets: featureBackfillTargets.length,
              },
              'Refreshed feature snapshot batch',
            );
          }
        } catch (error: unknown) {
          failedFeatureKeys.add(snapshotKey(target.leadId, target.icpProfileId));
          logger.error(
            {
              leadId: target.leadId,
              icpProfileId: target.icpProfileId,
              error: error instanceof Error ? error.message : String(error),
            },
            'Failed to compute feature snapshot',
          );
        }
      });
    }

    const scorableTargets = selectedTargets.filter(
      (target) =>
        !args.skipFeatureBackfill ||
        latestSnapshotByLeadIcp.has(snapshotKey(target.leadId, target.icpProfileId)),
    ).filter((target) => !failedFeatureKeys.has(snapshotKey(target.leadId, target.icpProfileId)));

    const targetsByIcp = new Map<string, string[]>();
    for (const target of scorableTargets) {
      const existing = targetsByIcp.get(target.icpProfileId) ?? [];
      existing.push(target.leadId);
      targetsByIcp.set(target.icpProfileId, existing);
    }

    const batches: ScoreBatch[] = [];
    for (const [icpProfileId, targetLeadIds] of targetsByIcp.entries()) {
      for (const leadIdBatch of chunk(targetLeadIds, args.batchSize)) {
        batches.push({ icpProfileId, leadIds: leadIdBatch });
      }
    }

    const openAiAdapter = new OpenAiAdapter({
      apiKey: process.env.OPENAI_API_KEY,
      generationModel: process.env.OPENAI_GENERATION_MODEL,
      scoringModel: process.env.OPENAI_SCORING_MODEL,
      baseUrl: process.env.OPENAI_BASE_URL,
      timeoutMs: optionalPositiveNumber(process.env.OPENAI_TIMEOUT_MS) ?? 60_000,
    });

    let scoredLeadCount = 0;
    const scoreRunId = `backfill.ai-scores:${Date.now()}`;

    await runPool(batches, args.concurrency, async (batch, batchIndex) => {
      const batchStartedAt = new Date(Date.now() - 1_000);
      const runId = `${scoreRunId}:${batchIndex + 1}`;
      const payload: ScoringComputeJobPayload = {
        runId,
        mode: 'BY_LEAD_IDS',
        icpProfileId: batch.icpProfileId,
        leadIds: batch.leadIds,
        correlationId: `backfill-ai-scores:${batchIndex + 1}`,
      };

      await handleScoringComputeJob(
        handlerLogger,
        {
          id: `backfill-ai-scores:scoring:${batchIndex + 1}`,
          name: SCORING_COMPUTE_JOB_NAME,
          data: payload,
        } as unknown as import('pg-boss').Job<ScoringComputeJobPayload>,
        {
          openAiAdapter,
          requireOpenAiScore: true,
        },
      );

      const predictions = await prisma.leadScorePrediction.findMany({
        where: {
          leadId: { in: batch.leadIds },
          icpProfileId: batch.icpProfileId,
          predictedAt: { gte: batchStartedAt },
        },
        select: {
          leadId: true,
          reasonsJson: true,
          predictedAt: true,
        },
        orderBy: [{ predictedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      });

      const latestPredictionByLead = new Map<string, { reasonsJson: unknown }>();
      for (const prediction of predictions) {
        if (!latestPredictionByLead.has(prediction.leadId)) {
          latestPredictionByLead.set(prediction.leadId, prediction);
        }
      }

      const missingPredictions = batch.leadIds.filter((leadId) => !latestPredictionByLead.has(leadId));
      const nonOpenAiPredictions = [...latestPredictionByLead.entries()]
        .filter(([, prediction]) => {
          const reasons = prediction.reasonsJson;
          return !reasons || typeof reasons !== 'object' || (reasons as Record<string, unknown>).scoreSource !== 'llm';
        })
        .map(([leadId]) => leadId);

      if (missingPredictions.length > 0 || nonOpenAiPredictions.length > 0) {
        throw new Error(
          `Batch ${batchIndex + 1} did not produce OpenAI scores for all leads: missing=${missingPredictions.length}, nonOpenAi=${nonOpenAiPredictions.length}`,
        );
      }

      scoredLeadCount += batch.leadIds.length;
      logger.info(
        {
          batch: batchIndex + 1,
          totalBatches: batches.length,
          icpProfileId: batch.icpProfileId,
          batchLeads: batch.leadIds.length,
          scoredLeadCount,
          remainingLeadCount: scorableTargets.length - scoredLeadCount,
        },
        'Completed AI score backfill batch',
      );
    });

    logger.info(
      {
        requestedTargets: selectedTargets.length,
        scorableTargets: scorableTargets.length,
        scoredLeadCount,
        skippedNoIcp: unresolvedLeadIds.length,
        skippedFeatureFailures: failedFeatureKeys.size,
      },
      'Completed AI score backfill',
    );
  } finally {
    await prisma.$disconnect();
  }
}

run().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      level: 'error',
      message: 'AI score backfill failed',
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
});
