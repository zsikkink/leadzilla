import { getTaskCapForLeadTarget, seedSearchTasks } from '@lead-flood/discovery';
import type { IcpSeedConfig, DiscoveryRuntimeConfig } from '@lead-flood/discovery';
import type {
  DiscoveryCountryCode,
  DiscoveryLanguageCode,
  SearchTaskType,
} from '@lead-flood/discovery';
import { loadConversionRate, loadSearchEfficiency } from '../utils/pipeline-settings.js';
import { prisma, toInputJson } from '@lead-flood/db';
import type PgBoss from 'pg-boss';
import type { Job, SendOptions } from 'pg-boss';

import {
  DISCOVERY_RUN_SEARCH_TASK_JOB_NAME,
  DISCOVERY_RUN_SEARCH_TASK_RETRY_OPTIONS,
} from './discovery.run_search_task.job.js';

export const DISCOVERY_SEED_JOB_NAME = 'discovery.seed';
export const DISCOVERY_SEED_IDEMPOTENCY_KEY_PATTERN = 'discovery.seed:${timeBucket}';

export const DISCOVERY_SEED_RETRY_OPTIONS: Pick<
  SendOptions,
  'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'
> = {
  retryLimit: 3,
  retryDelay: 60,
  retryBackoff: true,
  deadLetter: 'discovery.seed.dead_letter',
};

export interface DiscoverySeedJobPayload {
  reason?: string;
  correlationId?: string;
  jobRunId?: string;
  profile?: 'default' | 'small';
  maxTasks?: number;
  maxPages?: number;
  bucket?: string;
  taskTypes?: SearchTaskType[];
  countries?: DiscoveryCountryCode[];
  /** User-selected cities override. When provided, only these cities are searched. */
  cities?: string[] | undefined;
  languages?: DiscoveryLanguageCode[];
  enqueueRunTasks?: boolean;
  /** Pipeline v2 fields — forwarded to search task workers for business.prequalify chaining. */
  discoveryRunId?: string | undefined;
  icpProfileId?: string | undefined;
  includeWebsiteAnalysis?: boolean | undefined;
  includeSocialMediaAnalysis?: boolean | undefined;
  validationMode?: boolean | undefined;
  minReviewCount?: number | undefined;
}

export interface DiscoverySeedLogger {
  info: (object: Record<string, unknown>, message: string) => void;
  warn: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
}

export interface DiscoverySeedDependencies {
  boss: Pick<PgBoss, 'send'>;
  config: DiscoveryRuntimeConfig;
}

const ALLOWED_COUNTRIES = new Set<DiscoveryCountryCode>([
  'JO', 'SA', 'AE', 'EG', 'QA', 'BH', 'KW', 'OM', 'LB',
  'IQ', 'MA', 'TN', 'DZ', 'LY', 'YE', 'SY', 'PS', 'SD',
]);
const ALLOWED_LANGUAGES = new Set<DiscoveryLanguageCode>(['en', 'ar']);
const ALLOWED_TASK_TYPES = new Set<SearchTaskType>([
  'SERP_GOOGLE',
  'SERP_GOOGLE_LOCAL',
  'SERP_MAPS_LOCAL',
]);

const DEFAULT_CONVERSION_RATE = 0.10; // conservative cold-start
const DEFAULT_SEARCH_EFFICIENCY = 10; // businesses per task (post R1+R2)

/**
 * Compute an adaptive search task budget using two rates:
 * - conversionRate: qualified leads per unique business
 * - searchEfficiency: unique businesses per search task
 */
async function computeAdaptiveSearchTaskBudget(
  desiredLeads: number,
  icpProfileId: string | undefined,
): Promise<{ maxTasks: number; targetUniqueBusinesses: number }> {
  let conversionRate = DEFAULT_CONVERSION_RATE;
  let searchEfficiency = DEFAULT_SEARCH_EFFICIENCY;

  if (icpProfileId) {
    const [storedConversion, storedEfficiency] = await Promise.all([
      loadConversionRate(icpProfileId),
      loadSearchEfficiency(icpProfileId),
    ]);
    if (storedConversion !== null) conversionRate = storedConversion;
    if (storedEfficiency !== null) searchEfficiency = storedEfficiency;
  }

  const targetBusinesses = Math.ceil(desiredLeads / conversionRate) * 1.5;
  const maxTasks = Math.ceil(targetBusinesses / searchEfficiency);
  const targetUniqueBusinesses = Math.ceil(targetBusinesses);

  return { maxTasks, targetUniqueBusinesses };
}

function withSeedOverrides(
  config: DiscoveryRuntimeConfig,
  payload: DiscoverySeedJobPayload,
): Pick<
  DiscoveryRuntimeConfig,
  | 'countries'
  | 'languages'
  | 'maxPagesPerQuery'
  | 'refreshBucket'
  | 'seedProfile'
  | 'maxTasks'
  | 'taskTypes'
  | 'seedBucket'
> {
  const countries =
    payload.countries && payload.countries.length > 0
      ? Array.from(new Set(payload.countries.filter((value) => ALLOWED_COUNTRIES.has(value))))
      : config.countries;
  const languages =
    payload.languages && payload.languages.length > 0
      ? Array.from(new Set(payload.languages.filter((value) => ALLOWED_LANGUAGES.has(value))))
      : config.languages;
  const taskTypes =
    payload.taskTypes && payload.taskTypes.length > 0
      ? Array.from(new Set(payload.taskTypes.filter((value) => ALLOWED_TASK_TYPES.has(value))))
      : config.taskTypes;

  return {
    countries: countries.length > 0 ? countries : config.countries,
    languages: languages.length > 0 ? languages : config.languages,
    taskTypes: taskTypes.length > 0 ? taskTypes : config.taskTypes,
    maxPagesPerQuery:
      payload.maxPages && Number.isFinite(payload.maxPages) && payload.maxPages > 0
        ? payload.maxPages
        : config.maxPagesPerQuery,
    refreshBucket: config.refreshBucket,
    seedProfile: payload.profile ?? config.seedProfile,
    maxTasks:
      payload.maxTasks !== undefined && Number.isFinite(payload.maxTasks) && payload.maxTasks >= 0
        ? payload.maxTasks
        : config.maxTasks,
    seedBucket: payload.bucket ?? config.seedBucket,
  };
}

export async function handleDiscoverySeedJob(
  logger: DiscoverySeedLogger,
  job: Job<DiscoverySeedJobPayload>,
  dependencies: DiscoverySeedDependencies,
): Promise<void> {
  const correlationId = job.data.correlationId ?? job.id;
  const startedAt = Date.now();
  let seedConfig = withSeedOverrides(dependencies.config, job.data);
  const shouldEnqueueRunTasks = job.data.enqueueRunTasks ?? job.data.reason !== 'api';

  try {
    // Bug 6: Scheduled seeds arrive without icpProfileId/discoveryRunId.
    // Auto-select the oldest active ICP and create a tracking JobExecution.
    if (!job.data.icpProfileId && job.data.reason === 'scheduled') {
      const defaultIcp = await prisma.icpProfile.findFirst({
        where: { isActive: true },
        orderBy: { createdAt: 'asc' },
      });
      if (defaultIcp) {
        job.data.icpProfileId = defaultIcp.id;
        const run = await prisma.jobExecution.create({
          data: {
            type: 'discovery.seed',
            status: 'queued',
            payload: toInputJson({
              reason: 'scheduled',
              icpProfileId: defaultIcp.id,
            }),
          },
        });
        job.data.discoveryRunId = run.id;
        logger.info(
          {
            jobId: job.id,
            queue: job.name,
            correlationId,
            icpProfileId: defaultIcp.id,
            discoveryRunId: run.id,
          },
          'Scheduled seed: auto-selected default ICP profile and created discovery run',
        );
      }
    }

    // B9: If ICP profile is provided, load its target industries for v2 task generation
    let icpSeedConfig: IcpSeedConfig | undefined;
    if (job.data.icpProfileId) {
      const icpProfile = await prisma.icpProfile.findUnique({
        where: { id: job.data.icpProfileId },
        select: { targetIndustries: true, targetCountries: true, metadataJson: true },
      });

      if (icpProfile && icpProfile.targetIndustries.length > 0) {
        // User-selected countries/cities override ICP profile defaults.
        // The job payload carries the user's filter from the API request.
        const userCountries = job.data.countries ?? [];
        const effectiveCountries = userCountries.length > 0
          ? userCountries
          : icpProfile.targetCountries;

        // Extract categoryOverrides from ICP metadataJson (Change 7C)
        const metadata = icpProfile.metadataJson && typeof icpProfile.metadataJson === 'object'
          && !Array.isArray(icpProfile.metadataJson)
          ? icpProfile.metadataJson as Record<string, unknown>
          : {};
        const categoryOverrides = metadata.categoryOverrides &&
          typeof metadata.categoryOverrides === 'object' &&
          !Array.isArray(metadata.categoryOverrides)
          ? metadata.categoryOverrides as Record<string, { add?: string[]; remove?: string[] }>
          : undefined;

        icpSeedConfig = {
          targetIndustries: icpProfile.targetIndustries,
          targetCountries: effectiveCountries,
          ...(job.data.cities !== undefined ? { cities: job.data.cities } : {}),
          ...(categoryOverrides ? { categoryOverrides } : {}),
        };
        logger.info(
          {
            jobId: job.id,
            queue: job.name,
            correlationId,
            icpProfileId: job.data.icpProfileId,
            targetIndustries: icpProfile.targetIndustries,
            effectiveCountries,
            userCities: job.data.cities,
          },
          'Using ICP v2 category mapping for task generation',
        );
      }
    }

      // 5B: Adaptive maxTasks — if user set maxTasks (desired leads), compute search budget
    let targetUniqueBusinesses: number | undefined;
    if (seedConfig.maxTasks > 0 && job.data.icpProfileId && job.data.reason === 'api') {
      const adaptive = await computeAdaptiveSearchTaskBudget(
        seedConfig.maxTasks,
        job.data.icpProfileId,
      );
      targetUniqueBusinesses = adaptive.targetUniqueBusinesses;
      seedConfig = { ...seedConfig, maxTasks: adaptive.maxTasks };

      // Change 3: Clamp to per-tier safety cap
      const tierCap = getTaskCapForLeadTarget(job.data.maxTasks ?? 75);
      if (seedConfig.maxTasks > tierCap) {
        logger.warn(
          {
            jobId: job.id,
            queue: job.name,
            computedBudget: seedConfig.maxTasks,
            tierCap,
            desiredLeads: job.data.maxTasks,
          },
          'Adaptive budget exceeds tier safety cap — clamping',
        );
        seedConfig = { ...seedConfig, maxTasks: tierCap };
      }

      logger.info(
        {
          jobId: job.id,
          queue: job.name,
          correlationId,
          desiredLeads: job.data.maxTasks,
          adaptiveBudget: adaptive.maxTasks,
          targetUniqueBusinesses,
          tierCap,
          finalMaxTasks: seedConfig.maxTasks,
          icpProfileId: job.data.icpProfileId,
        },
        'Computed adaptive search task budget from historical rates',
      );
    }

    if (job.data.validationMode && job.data.maxTasks !== undefined && job.data.maxTasks <= 10) {
      const manualValidationTaskCap = Math.min(12, Math.max(job.data.maxTasks * 2, job.data.maxTasks));
      const validationBusinessCap = Math.min(40, Math.max(job.data.maxTasks * 4, job.data.maxTasks));
      seedConfig = { ...seedConfig, maxTasks: Math.min(seedConfig.maxTasks, manualValidationTaskCap) };
      targetUniqueBusinesses = targetUniqueBusinesses === undefined
        ? validationBusinessCap
        : Math.min(targetUniqueBusinesses, validationBusinessCap);

      logger.info(
        {
          jobId: job.id,
          queue: job.name,
          correlationId,
          requestedLeads: job.data.maxTasks,
          manualValidationTaskCap,
          validationBusinessCap,
          finalMaxTasks: seedConfig.maxTasks,
          targetUniqueBusinesses,
        },
        'Applied manual validation cap for small discovery run',
      );
    }

    const seedResult = await seedSearchTasks(seedConfig, new Date(), icpSeedConfig, job.data.discoveryRunId);

    logger.info(
      {
        jobId: job.id,
        queue: job.name,
        correlationId,
        generated: seedResult.generated,
        inserted: seedResult.inserted,
        countries: seedConfig.countries,
        languages: seedConfig.languages,
        maxPagesPerQuery: seedConfig.maxPagesPerQuery,
        refreshBucket: seedConfig.refreshBucket,
        seedProfile: seedConfig.seedProfile,
        useV2: Boolean(icpSeedConfig),
      },
      'Completed discovery frontier seed job',
    );

    // If 0 tasks were generated, finalize the run immediately instead of
    // enqueuing empty run_search_task slots that race with this update.
    if (seedResult.generated === 0) {
      if (job.data.discoveryRunId) {
        await prisma.jobExecution.update({
          where: { id: job.data.discoveryRunId },
          data: {
            status: 'failed',
            startedAt: new Date(),
            finishedAt: new Date(),
            error: 'Seed generated 0 search tasks. Check ICP industry mapping and country codes.',
            result: toInputJson({
              totalItems: 0,
              processedItems: 0,
              failedItems: 0,
              searchTasksInserted: 0,
            }),
          },
        });
      }
      logger.warn(
        { jobId: job.id, queue: job.name, correlationId },
        'Seed generated 0 tasks — skipping run_search_task enqueue and marking run as failed',
      );
      return;
    }

    if (shouldEnqueueRunTasks) {
      for (let slot = 0; slot < dependencies.config.concurrency; slot += 1) {
        await dependencies.boss.send(
          DISCOVERY_RUN_SEARCH_TASK_JOB_NAME,
          {
            slot,
            reason: 'seed',
            correlationId,
            jobRunId: job.data.jobRunId,
            discoveryRunId: job.data.discoveryRunId,
            icpProfileId: job.data.icpProfileId,
            includeWebsiteAnalysis: job.data.includeWebsiteAnalysis,
            includeSocialMediaAnalysis: job.data.includeSocialMediaAnalysis,
            ...(job.data.maxTasks !== undefined ? { maxTasks: seedConfig.maxTasks } : {}),
            ...(targetUniqueBusinesses !== undefined ? { targetUniqueBusinesses } : {}),
            ...(job.data.minReviewCount !== undefined ? { minReviewCount: job.data.minReviewCount } : {}),
          },
          {
            ...DISCOVERY_RUN_SEARCH_TASK_RETRY_OPTIONS,
            singletonKey: `discovery.run_search_task:${job.data.discoveryRunId ?? correlationId}:slot-${slot}`,
          },
        );
      }
    }

    if (job.data.jobRunId) {
      await prisma.jobRun.update({
        where: { id: job.data.jobRunId },
        data: {
          status: 'SUCCESS',
          finishedAt: new Date(),
          durationMs: Math.max(0, Date.now() - startedAt),
          countersJson: toInputJson({
            generated: seedResult.generated,
            inserted: seedResult.inserted,
          }),
          resourceJson: toInputJson({
            db_writes: {
              search_tasks_inserted: seedResult.inserted,
            },
          }),
        },
      });
    } else if (job.data.discoveryRunId) {
      await prisma.jobExecution.update({
        where: { id: job.data.discoveryRunId },
        data: {
          status: 'running',
          startedAt: new Date(),
          result: toInputJson({
            totalItems: seedResult.generated,
            processedItems: 0,
            failedItems: 0,
            searchTasksInserted: seedResult.inserted,
          }),
        },
      });
    }
  } catch (error: unknown) {
    if (job.data.jobRunId) {
      await prisma.jobRun.update({
        where: { id: job.data.jobRunId },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          durationMs: Math.max(0, Date.now() - startedAt),
          errorText:
            error instanceof Error ? error.message : 'Failed to execute discovery seed job',
        },
      });
    } else if (job.data.discoveryRunId) {
      await prisma.jobExecution.update({
        where: { id: job.data.discoveryRunId },
        data: {
          status: 'failed',
          error: error instanceof Error ? error.message : 'Failed to execute discovery seed job',
          finishedAt: new Date(),
        },
      });
    }
    throw error;
  }
}
