import PgBoss, { type Job } from 'pg-boss';

import { checkPipelineSchemaHealth, prisma } from '@lead-flood/db';
import {
  GooglePlacesDiscoveryProvider,
  loadDiscoveryRuntimeConfig,
  type DiscoveryRuntimeConfig,
  type DiscoveryProvider as V2DiscoveryProvider,
} from '@lead-flood/discovery';
import { createLogger } from '@lead-flood/observability';
import {
  ApolloDiscoveryAdapter,
  HunterEnrichmentAdapter,
  InstagramScraperAdapter,
  OpenAiAdapter,
  ResendAdapter,
  TrengoAdapter,
  WebsiteScraperAdapter,
  SmtpVerifier,
} from '@lead-flood/providers';

import { loadWorkerEnv } from './env.js';
import {
  ANALYTICS_ROLLUP_JOB_NAME,
  handleAnalyticsRollupJob,
  type AnalyticsRollupJobPayload,
} from './jobs/analytics.rollup.job.js';
import {
  BUSINESS_CONVERT_JOB_NAME,
  BUSINESS_CONVERT_RETRY_OPTIONS,
  handleBusinessConvertJob,
  type BusinessConvertJobPayload,
} from './jobs/business.convert.job.js';
import {
  BUSINESS_PREQUALIFY_JOB_NAME,
  BUSINESS_PREQUALIFY_RETRY_OPTIONS,
  handleBusinessPrequalifyJob,
  type BusinessPrequalifyJobPayload,
} from './jobs/business.prequalify.job.js';
import {
  DISCOVERY_RUN_SEARCH_TASK_JOB_NAME,
  DISCOVERY_RUN_SEARCH_TASK_RETRY_OPTIONS,
  handleDiscoveryRunSearchTaskJob,
  type DiscoveryRunSearchTaskJobPayload,
} from './jobs/discovery.run_search_task.job.js';
import {
  DISCOVERY_SEED_JOB_NAME,
  DISCOVERY_SEED_RETRY_OPTIONS,
  handleDiscoverySeedJob,
  type DiscoverySeedJobPayload,
} from './jobs/discovery.seed.job.js';
import {
  FEATURES_COMPUTE_JOB_NAME,
  FEATURES_COMPUTE_RETRY_OPTIONS,
  handleFeaturesComputeJob,
  type FeaturesComputeJobPayload,
} from './jobs/features.compute.job.js';
import {
  FOLLOWUP_CHECK_JOB_NAME,
  handleFollowupCheckJob,
  type FollowupCheckJobPayload,
} from './jobs/followup.check.job.js';
import {
  MANAGER_ANALYZE_JOB_NAME,
  handleManagerAnalyzeJob,
  type ManagerAnalyzeJobPayload,
} from './jobs/manager.analyze.job.js';
import { handleHeartbeatJob, type HeartbeatJobPayload } from './jobs/heartbeat.job.js';
import {
  LABELS_GENERATE_JOB_NAME,
  handleLabelsGenerateJob,
  type LabelsGenerateJobPayload,
} from './jobs/labels.generate.job.js';
import {
  MESSAGE_GENERATE_JOB_NAME,
  MESSAGE_GENERATE_RETRY_OPTIONS,
  handleMessageGenerateJob,
  type MessageGenerateJobPayload,
} from './jobs/message.generate.job.js';
import {
  MESSAGE_SEND_JOB_NAME,
  handleMessageSendJob,
  type MessageSendJobPayload,
} from './jobs/message.send.job.js';
import {
  MODEL_EVALUATE_JOB_NAME,
  handleModelEvaluateJob,
  type ModelEvaluateJobPayload,
} from './jobs/model.evaluate.job.js';
import {
  MODEL_TRAIN_JOB_NAME,
  MODEL_TRAIN_RETRY_OPTIONS,
  handleModelTrainJob,
  type ModelTrainJobPayload,
} from './jobs/model.train.job.js';
import {
  NOTIFY_SALES_JOB_NAME,
  handleNotifySalesJob,
  type NotifySalesJobPayload,
  NOTIFY_SALES_RETRY_OPTIONS,
} from './jobs/notify.sales.job.js';
import {
  PIPELINE_HEALTH_JOB_NAME,
  handlePipelineHealthJob,
  type PipelineHealthJobPayload,
} from './jobs/pipeline.health.job.js';
import {
  REPLY_CLASSIFY_JOB_NAME,
  handleReplyClassifyJob,
  type ReplyClassifyJobPayload,
} from './jobs/reply.classify.job.js';
import {
  SCORING_COMPUTE_JOB_NAME,
  handleScoringComputeJob,
  type ScoringComputeJobPayload,
} from './jobs/scoring.compute.job.js';
import {
  APOLLO_ENRICH_JOB_NAME,
  APOLLO_ENRICH_RETRY_OPTIONS,
  handleApolloEnrichJob,
  type ApolloEnrichJobPayload,
} from './jobs/apollo.enrich.job.js';
import {
  SCORING_BATCH_JOB_NAME,
  handleScoringBatchJob,
  type ScoringBatchJobPayload,
} from './jobs/scoring.batch.job.js';
import {
  DLQ_JOB_NAME,
  handleDlqProcessJob,
  type DlqProcessJobPayload,
} from './jobs/dlq.process.job.js';
import {
  LEAD_RECOVERY_JOB_NAME,
  handleLeadRecoveryJob,
  type LeadRecoveryJobPayload,
} from './jobs/lead.recovery.job.js';
import {
  DATA_RETENTION_JOB_NAME,
  handleDataRetentionJob,
  type DataRetentionJobPayload,
} from './jobs/data.retention.job.js';
import {
  MODEL_DRIFT_JOB_NAME,
  handleModelDriftJob,
  type ModelDriftJobPayload,
} from './jobs/model.drift.job.js';
import {
  SEARCH_TASK_RECOVERY_JOB_NAME,
  handleSearchTaskRecoveryJob,
  type SearchTaskRecoveryJobPayload,
} from './jobs/search-task.recovery.job.js';
import {
  OUTBOX_CLEANUP_JOB_NAME,
  handleOutboxCleanupJob,
  type OutboxCleanupJobPayload,
} from './jobs/outbox.cleanup.job.js';
import { buildDefaultWorkerId, startJobRequestDispatcher } from './job-requests/dispatcher.js';
import { EmailRateLimiter } from './messaging/email-rate-limiter.js';
import { WhatsAppRateLimiter } from './messaging/rate-limiter.js';
import { dispatchPendingOutboxEvents } from './outbox-dispatcher.js';
import {
  checkStaleDiscoveryRuns,
  sweepStaleDiscoveryPipelineJobs,
} from './utils/discovery-run-tracker.js';
import { ensureWorkerQueues, HEARTBEAT_QUEUE_NAME } from './queues.js';
import { registerWorkerSchedules } from './schedules.js';

interface WorkerLogger {
  info: (object: Record<string, unknown>, message: string) => void;
  warn: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
}

type BossForWork = Pick<PgBoss, 'work'>;
type JobHandler<TPayload> = (logger: WorkerLogger, job: Job<TPayload>) => Promise<void>;
interface WorkerRegistrationOptions {
  batchSize?: number;
  pollingIntervalSeconds?: number;
  concurrent?: boolean;
}

async function registerWorker<TPayload>(
  boss: BossForWork,
  logger: WorkerLogger,
  queueName: string,
  handler: JobHandler<TPayload>,
  options?: WorkerRegistrationOptions,
): Promise<void> {
  const processJobs = async (jobs: Job<TPayload>[]): Promise<void> => {
    if (options?.concurrent) {
      await Promise.all(jobs.map(async (job) => handler(logger, job)));
      return;
    }

    for (const job of jobs) {
      await handler(logger, job);
    }
  };

  if (options?.batchSize || options?.pollingIntervalSeconds) {
    await boss.work<TPayload>(
      queueName,
      {
        ...(options.batchSize ? { batchSize: options.batchSize } : {}),
        ...(options.pollingIntervalSeconds
          ? { pollingIntervalSeconds: options.pollingIntervalSeconds }
          : {}),
      },
      processJobs,
    );
  } else {
    await boss.work<TPayload>(queueName, processJobs);
  }

  logger.info({ queueName }, 'Registered worker queue');
}

async function main(): Promise<void> {
  const env = loadWorkerEnv(process.env);
  const logger = createLogger({
    service: 'worker',
    env: env.APP_ENV,
    level: env.LOG_LEVEL,
  });

  const schemaHealth = await checkPipelineSchemaHealth(prisma);
  if (schemaHealth.status !== 'ok') {
    logger.error({ schemaHealth }, 'Worker schema guard failed');
    throw new Error(
      `Worker schema guard failed: missingTables=${schemaHealth.missingTables.join(',') || 'none'} missingEnumValues=${schemaHealth.missingEnumValues.join(',') || 'none'}`,
    );
  }

  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: env.PG_BOSS_SCHEMA,
  });
  let stopJobRequestDispatcher: (() => void) | null = null;
  const workerSchedulesEnabled =
    env.WORKER_ENABLE_SCHEDULES ?? env.APP_ENV !== 'local';
  const discoveryQueueWorkersEnabled =
    env.DISCOVERY_QUEUE_WORKERS_ENABLED ?? true;

  await boss.start();
  logger.info({}, 'Worker started');

  await ensureWorkerQueues(boss);
  if (workerSchedulesEnabled) {
    await registerWorkerSchedules(boss, {
      discoveryScheduleEnabled: env.DISCOVERY_SCHEDULE_ENABLED,
      logger,
    });
  } else {
    logger.info(
      {
        workerSchedulesEnabled,
      },
      'Worker schedules disabled for this environment',
    );
  }

  const apolloAdapter = new ApolloDiscoveryAdapter({
    apiKey: env.APOLLO_API_KEY ?? '',
    baseUrl: env.APOLLO_BASE_URL,
    minRequestIntervalMs: env.APOLLO_RATE_LIMIT_MS,
  });

  const hunterAdapter = new HunterEnrichmentAdapter({
    enabled: env.HUNTER_ENABLED,
    apiKey: env.HUNTER_API_KEY,
    baseUrl: env.HUNTER_BASE_URL,
    minRequestIntervalMs: env.HUNTER_RATE_LIMIT_MS,
  });

  const websiteScraperAdapter = new WebsiteScraperAdapter({
    enablePlaywright: env.WEBSITE_SCRAPER_PLAYWRIGHT_ENABLED,
    ...(env.WEBSITE_SCRAPER_CHROMIUM_PATH ? { chromiumPath: env.WEBSITE_SCRAPER_CHROMIUM_PATH } : {}),
  });
  const instagramScraperAdapter = new InstagramScraperAdapter({
    ...(env.INSTAGRAM_USERNAME ? { username: env.INSTAGRAM_USERNAME } : {}),
    ...(env.INSTAGRAM_PASSWORD ? { password: env.INSTAGRAM_PASSWORD } : {}),
    ...(env.INSTAGRAM_COOKIES ? { cookies: env.INSTAGRAM_COOKIES } : {}),
    ...(env.INSTAGRAM_RATE_LIMIT_PER_MIN !== undefined
      ? { rateLimitPerMinute: env.INSTAGRAM_RATE_LIMIT_PER_MIN }
      : {}),
  });
  let discoveryRuntimeConfig: DiscoveryRuntimeConfig | null = null;
  let v2SearchProvider: V2DiscoveryProvider | null = null;
  try {
    discoveryRuntimeConfig = loadDiscoveryRuntimeConfig(process.env);
    if (discoveryRuntimeConfig.mapsZoomWarning) {
      logger.warn(
        { warning: discoveryRuntimeConfig.mapsZoomWarning },
        'Using default discovery maps zoom',
      );
    }

    const hasGooglePlaces = Boolean(discoveryRuntimeConfig.googlePlacesApiKey);

    const providerLogContext = {
      enabled: true,
      rps: discoveryRuntimeConfig.rps,
      concurrency: discoveryRuntimeConfig.concurrency,
      maxTaskAttempts: discoveryRuntimeConfig.maxTaskAttempts,
      runMaxTasks: env.DISCOVERY_RUN_MAX_TASKS ?? null,
      countries: discoveryRuntimeConfig.countries,
      languages: discoveryRuntimeConfig.languages,
      discoveryQueueWorkersEnabled,
      jobRequestPollMs: env.JOB_REQUEST_POLL_MS,
      jobRequestMaxPerTick: env.JOB_REQUEST_MAX_PER_TICK,
      jobRequestWorkerId: env.JOB_REQUEST_WORKER_ID ?? buildDefaultWorkerId(),
    };

    const googlePlacesProvider = hasGooglePlaces
      ? new GooglePlacesDiscoveryProvider({
          apiKey: discoveryRuntimeConfig.googlePlacesApiKey!,
          rps: discoveryRuntimeConfig.rps,
          maxAttempts: discoveryRuntimeConfig.maxTaskAttempts,
          backoffBaseSeconds: discoveryRuntimeConfig.backoffBaseSeconds,
        })
      : null;

    if (discoveryRuntimeConfig.searchProvider === 'GOOGLE_PLACES' && googlePlacesProvider) {
      v2SearchProvider = googlePlacesProvider;
      logger.info(
        { ...providerLogContext, provider: 'GOOGLE_PLACES', mode: 'strict_initial_discovery' },
        'Discovery pipeline configured (Google Places only, strict initial discovery mode)',
      );
    } else {
      logger.warn(
        {
          searchProvider: discoveryRuntimeConfig.searchProvider,
          hasGooglePlacesKey: hasGooglePlaces,
        },
        'No discovery search provider configured — set GOOGLE_PLACES_API_KEY',
      );
    }
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : 'invalid discovery runtime config';
    if (discoveryQueueWorkersEnabled) {
      logger.error({ error: reason }, 'Discovery runtime config invalid; refusing worker startup');
      throw new Error(`Discovery runtime config invalid: ${reason}`);
    }
    logger.warn(
      { error: reason },
      'Discovery queue workers disabled; skipping discovery runtime initialization',
    );
  }

  const openAiAdapter = new OpenAiAdapter({
    apiKey: env.OPENAI_API_KEY,
    generationModel: env.OPENAI_GENERATION_MODEL,
    scoringModel: env.OPENAI_SCORING_MODEL,
    baseUrl: env.OPENAI_BASE_URL,
  });

  const resendAdapter = new ResendAdapter({
    apiKey: env.RESEND_API_KEY,
    fromEmail: env.RESEND_FROM_EMAIL,
  });

  const trengoAdapter = new TrengoAdapter({
    apiKey: env.TRENGO_API_KEY,
    baseUrl: env.TRENGO_BASE_URL,
    channelId: env.TRENGO_CHANNEL_ID,
    templateId: env.TRENGO_TEMPLATE_ID,
  });

  const whatsAppRateLimiter = new WhatsAppRateLimiter(prisma, {
    dailySendLimit: env.WHATSAPP_DAILY_SEND_LIMIT,
  });

  const emailRateLimiter = new EmailRateLimiter(prisma, {
    maxDaily: env.EMAIL_DAILY_SEND_LIMIT,
  });


  let outboxDispatchRunning = false;
  const runOutboxDispatch = async (): Promise<void> => {
    if (outboxDispatchRunning) {
      return;
    }

    outboxDispatchRunning = true;
    try {
      const dispatchedCount = await dispatchPendingOutboxEvents(boss, logger);
      if (dispatchedCount > 0) {
        logger.info({ dispatchedCount }, 'Dispatched outbox events');
      }
    } catch (error: unknown) {
      logger.error({ error }, 'Outbox dispatch cycle failed');
    } finally {
      outboxDispatchRunning = false;
    }
  };

  await runOutboxDispatch();
  await sweepStaleDiscoveryPipelineJobs({
    boss: {
      cancel: (name, id) => boss.cancel(name, id),
      send: (name, data, options) => (
        options
          ? boss.send(name, data, options)
          : boss.send(name, data)
      ),
    },
    logger,
    staleMinutes: env.DISCOVERY_STALE_JOB_MINUTES,
    retryOptionsByQueue: {
      [BUSINESS_PREQUALIFY_JOB_NAME]: BUSINESS_PREQUALIFY_RETRY_OPTIONS,
      [BUSINESS_CONVERT_JOB_NAME]: BUSINESS_CONVERT_RETRY_OPTIONS,
      [DISCOVERY_SEED_JOB_NAME]: DISCOVERY_SEED_RETRY_OPTIONS,
      [DISCOVERY_RUN_SEARCH_TASK_JOB_NAME]: DISCOVERY_RUN_SEARCH_TASK_RETRY_OPTIONS,
    },
  }).catch((error: unknown) => {
    logger.warn({ error }, 'Failed stale discovery pipeline sweep on worker startup');
  });
  const outboxInterval = setInterval(() => {
    void runOutboxDispatch();
  }, 5000);

  // Periodic check for stale discovery runs (safety timeout enforcement)
  const staleRunCheckInterval = setInterval(() => {
    void checkStaleDiscoveryRuns(logger);
    void sweepStaleDiscoveryPipelineJobs({
      boss: {
        cancel: (name, id) => boss.cancel(name, id),
        send: (name, data, options) => (
          options
            ? boss.send(name, data, options)
            : boss.send(name, data)
        ),
      },
      logger,
      staleMinutes: env.DISCOVERY_STALE_JOB_MINUTES,
      retryOptionsByQueue: {
        [BUSINESS_PREQUALIFY_JOB_NAME]: BUSINESS_PREQUALIFY_RETRY_OPTIONS,
        [BUSINESS_CONVERT_JOB_NAME]: BUSINESS_CONVERT_RETRY_OPTIONS,
        [DISCOVERY_SEED_JOB_NAME]: DISCOVERY_SEED_RETRY_OPTIONS,
        [DISCOVERY_RUN_SEARCH_TASK_JOB_NAME]: DISCOVERY_RUN_SEARCH_TASK_RETRY_OPTIONS,
      },
    }).catch((error: unknown) => {
      logger.warn({ error }, 'Failed stale discovery pipeline sweep in periodic check');
    });
  }, 5 * 60 * 1000); // every 5 minutes

  await registerWorker<HeartbeatJobPayload>(boss, logger, HEARTBEAT_QUEUE_NAME, handleHeartbeatJob);

  if (discoveryRuntimeConfig && v2SearchProvider) {
    if (discoveryQueueWorkersEnabled) {
      await registerWorker<DiscoverySeedJobPayload>(
        boss,
        logger,
        DISCOVERY_SEED_JOB_NAME,
        (jobLogger, job) =>
          handleDiscoverySeedJob(jobLogger, job, {
            boss,
            config: discoveryRuntimeConfig,
          }),
      );

      await registerWorker<DiscoveryRunSearchTaskJobPayload>(
        boss,
        logger,
        DISCOVERY_RUN_SEARCH_TASK_JOB_NAME,
        (jobLogger, job) =>
          handleDiscoveryRunSearchTaskJob(jobLogger, job, {
            boss,
            provider: v2SearchProvider,
            config: discoveryRuntimeConfig,
            ...(env.DISCOVERY_RUN_MAX_TASKS !== undefined
              ? { maxTasks: env.DISCOVERY_RUN_MAX_TASKS }
              : {}),
            enqueueBusinessPrequalify: async (payload) => {
              await boss.send(BUSINESS_PREQUALIFY_JOB_NAME, payload, {
                singletonKey: `business.prequalify:${payload.businessId}`,
                ...BUSINESS_PREQUALIFY_RETRY_OPTIONS,
              });
            },
          }),
        {
          batchSize: discoveryRuntimeConfig.concurrency,
          pollingIntervalSeconds: 1,
          concurrent: true,
        },
      );

      if (env.DISCOVERY_BOOTSTRAP_ON_START) {
        for (let slot = 0; slot < discoveryRuntimeConfig.concurrency; slot += 1) {
          await boss.send(
            DISCOVERY_RUN_SEARCH_TASK_JOB_NAME,
            {
              slot,
              reason: 'worker_bootstrap',
              correlationId: 'bootstrap:discovery.run_search_task',
            } satisfies DiscoveryRunSearchTaskJobPayload,
            {
              ...DISCOVERY_RUN_SEARCH_TASK_RETRY_OPTIONS,
            },
          );
        }

        await boss.send(
          DISCOVERY_SEED_JOB_NAME,
          {
            reason: 'worker_bootstrap',
            correlationId: 'bootstrap:discovery.seed',
          } satisfies DiscoverySeedJobPayload,
          {
            ...DISCOVERY_SEED_RETRY_OPTIONS,
          },
        );

        logger.info(
          {
            discoveryBootstrapOnStart: true,
          },
          'Seeded and started discovery loop from worker bootstrap',
        );
      } else {
        logger.info(
          {
            discoveryBootstrapOnStart: false,
          },
          'Discovery bootstrap on worker start is disabled',
        );
      }
    } else {
      logger.info(
        {
          discoveryQueueWorkersEnabled,
        },
        'Search-task queue workers disabled; processing discovery through job requests only',
      );
    }

    const dispatcher = startJobRequestDispatcher({
      logger,
      config: discoveryRuntimeConfig,
      provider: v2SearchProvider,
      pollMs: env.JOB_REQUEST_POLL_MS,
      maxPerTick: env.JOB_REQUEST_MAX_PER_TICK,
      workerId: env.JOB_REQUEST_WORKER_ID ?? buildDefaultWorkerId(),
    });
    stopJobRequestDispatcher = dispatcher.stop;
  }

  // ── Pipeline: business.prequalify → business.convert → features.compute ──
  await registerWorker<BusinessPrequalifyJobPayload>(
    boss,
    logger,
    BUSINESS_PREQUALIFY_JOB_NAME,
    (jobLogger, job) =>
      handleBusinessPrequalifyJob(jobLogger, job, {
        enqueueBusinessConvert: async (payload) => {
          await boss.send(BUSINESS_CONVERT_JOB_NAME, payload, {
            singletonKey: `business.convert:${payload.businessId}`,
            ...BUSINESS_CONVERT_RETRY_OPTIONS,
          });
        },
      }),
    {
      batchSize: env.WORKER_PREQUALIFY_CONCURRENCY,
      pollingIntervalSeconds: 1,
      concurrent: true,
    },
  );

  await registerWorker<BusinessConvertJobPayload>(
    boss,
    logger,
    BUSINESS_CONVERT_JOB_NAME,
    (jobLogger, job) =>
      handleBusinessConvertJob(jobLogger, job, {
        apolloAdapter: {
          searchContactsByDomain: (domain) => apolloAdapter.searchContactsByDomain(domain),
          preScreenDomain: (domain) => apolloAdapter.preScreenDomain(domain),
          isConfigured: Boolean(env.APOLLO_API_KEY),
        },
        hunterAdapter: {
          searchDomainContacts: (domain) => hunterAdapter.searchDomainContacts(domain),
          isConfigured: Boolean(env.HUNTER_API_KEY),
        },
        websiteScraperAdapter,
        instagramScraperAdapter,
        smtpVerifier: new SmtpVerifier(),
        openAiAdapter: openAiAdapter.isConfigured ? openAiAdapter : undefined,
        llmExtractionConfig: openAiAdapter.isConfigured
          ? {
              openAiApiKey: env.OPENAI_API_KEY,
              openAiBaseUrl: env.OPENAI_BASE_URL,
              model: env.OPENAI_GENERATION_MODEL,
            }
          : undefined,
        enqueueFeaturesCompute: async (payload) => {
          const featuresPayload: FeaturesComputeJobPayload = {
            runId: payload.runId,
            leadId: payload.leadId,
            icpProfileId: payload.icpProfileId,
            snapshotVersion: payload.snapshotVersion,
            ...(payload.correlationId !== undefined ? { correlationId: payload.correlationId } : {}),
          };
          await boss.send(
            FEATURES_COMPUTE_JOB_NAME,
            featuresPayload,
            {
              singletonKey: `features.compute:${payload.leadId}:${payload.snapshotVersion}`,
              ...FEATURES_COMPUTE_RETRY_OPTIONS,
            },
          );
        },
      }),
    {
      batchSize: env.WORKER_CONVERT_CONCURRENCY,
      pollingIntervalSeconds: 1,
      concurrent: true,
    },
  );

  await registerWorker<FeaturesComputeJobPayload>(
    boss,
    logger,
    FEATURES_COMPUTE_JOB_NAME,
    (jobLogger, job) =>
      handleFeaturesComputeJob(jobLogger, job, {
        boss,
      }),
    {
      batchSize: env.WORKER_FEATURES_CONCURRENCY,
      pollingIntervalSeconds: 1,
      concurrent: true,
    },
  );
  await registerWorker<LabelsGenerateJobPayload>(
    boss,
    logger,
    LABELS_GENERATE_JOB_NAME,
    (jobLogger, job) =>
      handleLabelsGenerateJob(jobLogger, job, {
        enqueueModelTrain: async (payload) => {
          await boss.send(MODEL_TRAIN_JOB_NAME, payload, {
            singletonKey: `model.train:labels-triggered:${job.data.runId}`,
            ...MODEL_TRAIN_RETRY_OPTIONS,
          });
        },
      }),
  );
  await registerWorker<ScoringComputeJobPayload>(
    boss,
    logger,
    SCORING_COMPUTE_JOB_NAME,
    (jobLogger, job) =>
      handleScoringComputeJob(jobLogger, job, {
        openAiAdapter,
        deterministicWeight: env.SCORING_DETERMINISTIC_WEIGHT,
        aiWeight: env.SCORING_AI_WEIGHT,
        enqueueApolloEnrich: async (payload) => {
          await boss.send(APOLLO_ENRICH_JOB_NAME, payload, {
            singletonKey: `apollo.enrich:${payload.leadId}:${payload.icpProfileId}`,
            ...APOLLO_ENRICH_RETRY_OPTIONS,
          });
        },
        enqueueMessageGenerate: async (payload) => {
          await boss.send(MESSAGE_GENERATE_JOB_NAME, payload, {
            singletonKey: `message.generate:${payload.leadId}:${payload.icpProfileId}`,
            ...MESSAGE_GENERATE_RETRY_OPTIONS,
          });
        },
      }),
    {
      pollingIntervalSeconds: 1,
    },
  );
  await registerWorker<ApolloEnrichJobPayload>(
    boss,
    logger,
    APOLLO_ENRICH_JOB_NAME,
    (jobLogger, job) =>
      handleApolloEnrichJob(jobLogger, job, {
        apolloAdapter: {
          searchContactsByDomain: (d) => apolloAdapter.searchContactsByDomain(d),
          isConfigured: Boolean(env.APOLLO_API_KEY),
        },
        enqueueMessageGenerate: async (payload) => {
          await boss.send(MESSAGE_GENERATE_JOB_NAME, payload, {
            singletonKey: `message.generate:${payload.leadId}:${payload.icpProfileId}`,
            ...MESSAGE_GENERATE_RETRY_OPTIONS,
          });
        },
      }),
  );
  await registerWorker<ScoringBatchJobPayload>(
    boss,
    logger,
    SCORING_BATCH_JOB_NAME,
    (jobLogger, job) =>
      handleScoringBatchJob(jobLogger, job, {
        enqueueMessageGenerate: async (payload) => {
          await boss.send(
            MESSAGE_GENERATE_JOB_NAME,
            {
              runId: job.data.runId,
              leadId: payload.leadId,
              icpProfileId: payload.icpProfileId,
              scorePredictionId: payload.scorePredictionId,
              knowledgeEntryIds: [],
              promptVersion: 'v1',
              correlationId: job.data.correlationId ?? job.id,
              ...(payload.channel !== undefined ? { channel: payload.channel as 'EMAIL' | 'WHATSAPP' } : {}),
            } satisfies MessageGenerateJobPayload,
            {
              singletonKey: `message.generate:${payload.leadId}:${payload.icpProfileId}`,
              ...MESSAGE_GENERATE_RETRY_OPTIONS,
            },
          );
        },
      }),
  );
  await registerWorker<ModelTrainJobPayload>(
    boss,
    logger,
    MODEL_TRAIN_JOB_NAME,
    (jobLogger, job) => handleModelTrainJob(jobLogger, job, { boss }),
  );
  await registerWorker<ModelEvaluateJobPayload>(
    boss,
    logger,
    MODEL_EVALUATE_JOB_NAME,
    (jobLogger, job) => handleModelEvaluateJob(jobLogger, job, { boss }),
  );
  await registerWorker<MessageGenerateJobPayload>(
    boss,
    logger,
    MESSAGE_GENERATE_JOB_NAME,
    (jobLogger, job) =>
      handleMessageGenerateJob(jobLogger, job, {
        openAiAdapter,
        boss,
      }),
    {
      pollingIntervalSeconds: 1,
    },
  );
  await registerWorker<MessageSendJobPayload>(
    boss,
    logger,
    MESSAGE_SEND_JOB_NAME,
    (jobLogger, job) =>
      handleMessageSendJob(jobLogger, job, {
        resendAdapter,
        trengoAdapter,
        rateLimiter: whatsAppRateLimiter,
        emailRateLimiter,
        boss,
      }),
  );
  await registerWorker<AnalyticsRollupJobPayload>(
    boss,
    logger,
    ANALYTICS_ROLLUP_JOB_NAME,
    handleAnalyticsRollupJob,
  );
  await registerWorker<FollowupCheckJobPayload>(
    boss,
    logger,
    FOLLOWUP_CHECK_JOB_NAME,
    (jobLogger, job) => handleFollowupCheckJob(jobLogger, job, { boss }),
  );
  await registerWorker<ReplyClassifyJobPayload>(
    boss,
    logger,
    REPLY_CLASSIFY_JOB_NAME,
    (jobLogger, job) =>
      handleReplyClassifyJob(jobLogger, job, {
        openAiAdapter,
        boss,
        notifySalesJobName: NOTIFY_SALES_JOB_NAME,
        notifySalesRetryOptions: NOTIFY_SALES_RETRY_OPTIONS,
      }),
  );
  await registerWorker<NotifySalesJobPayload>(
    boss,
    logger,
    NOTIFY_SALES_JOB_NAME,
    (jobLogger, job) =>
      handleNotifySalesJob(jobLogger, job, {
        slackWebhookUrl: env.SLACK_WEBHOOK_URL,
        trengoApiKey: env.TRENGO_API_KEY,
        trengoBaseUrl: env.TRENGO_BASE_URL,
        trengoInternalConversationId: env.TRENGO_INTERNAL_CONVERSATION_ID,
        resendAdapter,
        salesNotificationEmail: env.SALES_NOTIFICATION_EMAIL,
      }),
  );
  await registerWorker<DlqProcessJobPayload>(
    boss,
    logger,
    DLQ_JOB_NAME,
    (jobLogger, job) =>
      handleDlqProcessJob(jobLogger, job, { boss, slackWebhookUrl: env.SLACK_WEBHOOK_URL }),
  );

  await registerWorker<ManagerAnalyzeJobPayload>(
    boss,
    logger,
    MANAGER_ANALYZE_JOB_NAME,
    handleManagerAnalyzeJob,
  );

  await registerWorker<PipelineHealthJobPayload>(
    boss,
    logger,
    PIPELINE_HEALTH_JOB_NAME,
    (jobLogger, job) =>
      handlePipelineHealthJob(jobLogger, job, {
        slackWebhookUrl: env.SLACK_WEBHOOK_URL,
        minSuccessRate: env.PIPELINE_MIN_SUCCESS_RATE,
        minEnrichmentRate: env.PIPELINE_MIN_ENRICHMENT_RATE,
      }),
  );

  await registerWorker<OutboxCleanupJobPayload>(
    boss,
    logger,
    OUTBOX_CLEANUP_JOB_NAME,
    handleOutboxCleanupJob,
  );

  await registerWorker<LeadRecoveryJobPayload>(
    boss,
    logger,
    LEAD_RECOVERY_JOB_NAME,
    handleLeadRecoveryJob,
  );

  await registerWorker<DataRetentionJobPayload>(
    boss,
    logger,
    DATA_RETENTION_JOB_NAME,
    handleDataRetentionJob,
  );

  await registerWorker<ModelDriftJobPayload>(
    boss,
    logger,
    MODEL_DRIFT_JOB_NAME,
    (driftLogger, driftJob) =>
      handleModelDriftJob(driftLogger, driftJob, {
        slackWebhookUrl: env.SLACK_WEBHOOK_URL,
      }),
  );

  await registerWorker<SearchTaskRecoveryJobPayload>(
    boss,
    logger,
    SEARCH_TASK_RECOVERY_JOB_NAME,
    handleSearchTaskRecoveryJob,
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down worker');
    if (stopJobRequestDispatcher) {
      stopJobRequestDispatcher();
      stopJobRequestDispatcher = null;
    }
    clearInterval(outboxInterval);
    clearInterval(staleRunCheckInterval);
    await boss.stop({ graceful: true, timeout: 30_000 });
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

main().catch((error: unknown) => {
  console.error('Worker boot failed:', error);
  process.exit(1);
});
