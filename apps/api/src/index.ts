import PgBoss from 'pg-boss';

import {
  PrismaRuntime,
  assertDatabaseConnection,
  checkPipelineSchemaHealth,
  prisma,
  query,
  toInputJson,
  type Prisma,
} from '@lead-flood/db';
import { createLogger } from '@lead-flood/observability';
import type {
  ContactRecoveryDetailResponse,
  ContactRecoverySnapshot,
  ListContactRecoveryItemsQuery,
  ListContactRecoveryItemsResponse,
  RunDiscoverySeedRequest,
  RunDiscoveryTasksRequest,
  TriggerJobRunResponse,
} from '@lead-flood/contracts';
import {
  ContactRecoverySnapshotSchema,
  buildFeaturesComputeSingletonKey,
} from '@lead-flood/contracts';

import { buildSupabaseAccessTokenVerifier } from './auth/supabase.js';
import { loadApiEnv } from './env.js';
import type { ReplyClassifyJobPayload } from '@lead-flood/contracts';

import type { AnalyticsRollupJobPayload } from './modules/analytics/analytics.service.js';
import type { DiscoveryRunJobPayload } from './modules/discovery/discovery.service.js';
import type { MessageGenerateJobPayload, MessagingSendJobPayload } from './modules/messaging/messaging.service.js';
import type { ScoringRunJobPayload } from './modules/scoring/scoring.service.js';
import { buildServer, LeadAlreadyExistsError, LeadContextUnavailableError } from './server.js';

function toDayStart(value: string): Date {
  const source = new Date(value);
  return new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth(), source.getUTCDate()));
}

function mapContactRecoveryItem(record: {
  id: string;
  businessId: string;
  icpProfileId: string;
  discoveryRunId: string;
  status: 'OPEN' | 'APPROVED' | 'REJECTED';
  reason: 'NO_CONTACTS_FOUND' | 'NO_EMAIL' | 'DECISION_MAKER_IDENTIFIED';
  evidenceScore: number;
  candidateCount: number;
  recoverySnapshot: Prisma.JsonValue;
  rejectedBy: string | null;
  rejectedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  business: {
    id: string;
    name: string;
    city: string | null;
    country: string | null;
    countryCode: string;
    websiteDomain: string | null;
    instagramHandle: string | null;
    category: string | null;
    deterministicScore: number;
    scoreBand: 'LOW' | 'MEDIUM' | 'HIGH' | null;
    preQualified: boolean | null;
    disqualificationReason: string | null;
  };
  icpProfile: {
    name: string;
  };
}): ContactRecoveryDetailResponse {
  const snapshot = ContactRecoverySnapshotSchema.parse(record.recoverySnapshot) as ContactRecoverySnapshot;

  return {
    id: record.id,
    businessId: record.businessId,
    icpProfileId: record.icpProfileId,
    icpProfileName: record.icpProfile.name,
    discoveryRunId: record.discoveryRunId,
    status: record.status,
    reason: record.reason,
    evidenceScore: Number(record.evidenceScore.toFixed(3)),
    candidateCount: record.candidateCount,
    rejectedBy: record.rejectedBy,
    rejectedAt: record.rejectedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    business: {
      id: record.business.id,
      name: record.business.name,
      city: record.business.city,
      country: record.business.country,
      countryCode: record.business.countryCode,
      websiteDomain: record.business.websiteDomain,
      instagramHandle: record.business.instagramHandle,
      category: record.business.category,
      deterministicScore: record.business.deterministicScore,
      scoreBand: record.business.scoreBand,
      preQualified: record.business.preQualified,
      disqualificationReason: record.business.disqualificationReason,
    },
    snapshot,
  };
}

async function main(): Promise<void> {
  const env = loadApiEnv(process.env);
  const supabaseJwtIssuer =
    env.SUPABASE_JWT_ISSUER ??
    (env.SUPABASE_PROJECT_REF
      ? `https://${env.SUPABASE_PROJECT_REF}.supabase.co/auth/v1`
      : null);
  if (!supabaseJwtIssuer) {
    throw new Error('SUPABASE_JWT_ISSUER or SUPABASE_PROJECT_REF is required');
  }

  const verifyAccessToken = buildSupabaseAccessTokenVerifier({
    issuer: supabaseJwtIssuer,
    audience: env.SUPABASE_JWT_AUDIENCE ?? 'authenticated',
  });
  const logger = createLogger({
    service: 'api',
    env: env.APP_ENV,
    level: env.LOG_LEVEL,
  });
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: env.PG_BOSS_SCHEMA,
    max: 2,
  });

  await boss.start();
  await boss.createQueue('features.compute');
  await boss.createQueue('scoring.compute');
  await boss.createQueue('message.send', { name: 'message.send', policy: 'short' });
  await boss.createQueue('message.generate', { name: 'message.generate', policy: 'short' });
  await boss.createQueue('analytics.rollup');
  await boss.createQueue('reply.classify');
  await boss.createQueue('discovery.seed');
  await boss.createQueue('discovery.run_search_task');

  const enqueueReplyClassify = async (payload: ReplyClassifyJobPayload): Promise<void> => {
    await boss.send('reply.classify', payload, {
      retryLimit: 3,
      retryDelay: 60,
      retryBackoff: true,
      deadLetter: 'reply.classify.dead_letter',
    });
  };

  const publishFeaturesCompute = async (input: {
    leadId: string;
    icpProfileId: string;
    jobId: string;
    outboxEventId: string;
  }): Promise<void> => {
    try {
      await boss.send(
        'features.compute',
        {
          leadId: input.leadId,
          icpProfileId: input.icpProfileId,
          snapshotVersion: 1,
          runId: input.jobId,
        },
        {
          singletonKey: buildFeaturesComputeSingletonKey({
            leadId: input.leadId,
            icpProfileId: input.icpProfileId,
            snapshotVersion: 1,
          }),
          retryLimit: 3,
          retryDelay: 5,
          retryBackoff: true,
        },
      );

      await prisma.outboxEvent.update({
        where: { id: input.outboxEventId },
        data: {
          status: 'sent',
          attempts: {
            increment: 1,
          },
          processedAt: new Date(),
          nextAttemptAt: null,
          lastError: null,
        },
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to enqueue features.compute job';
      logger.error(
        { error, leadId: input.leadId, outboxEventId: input.outboxEventId },
        'Immediate queue publish failed; outbox retry will handle dispatch',
      );

      await prisma.outboxEvent.update({
        where: { id: input.outboxEventId },
        data: {
          status: 'failed',
          attempts: {
            increment: 1,
          },
          lastError: errorMessage,
          nextAttemptAt: new Date(Date.now() + 5000),
        },
      });
    }
  };

  const triggerDiscoverySeedJob = async (
    input: RunDiscoverySeedRequest,
  ): Promise<TriggerJobRunResponse> => {
    const startedAt = new Date();
    const run = await prisma.jobRun.create({
      data: {
        jobName: 'discovery.seed',
        status: 'RUNNING',
        startedAt,
        paramsJson: toInputJson(input),
        countersJson: {
          generated: 0,
          inserted: 0,
        } as Prisma.InputJsonValue,
        resourceJson: {
          db_writes: {
            search_tasks_inserted: 0,
          },
        } as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    try {
      await boss.send(
        'discovery.seed',
        {
          reason: 'api',
          correlationId: `api:job_run:${run.id}`,
          jobRunId: run.id,
          profile: input.profile,
          maxTasks: input.maxTasks,
          maxPages: input.maxPages,
          bucket: input.bucket,
          taskTypes: input.taskTypes,
          countries: input.countries,
          languages: input.languages,
        },
        {
          singletonKey: `discovery.seed:${run.id}`,
          retryLimit: 3,
          retryDelay: 60,
          retryBackoff: true,
        },
      );
    } catch (error: unknown) {
      await prisma.jobRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          durationMs: Math.max(0, Date.now() - startedAt.getTime()),
          errorText: error instanceof Error ? error.message : 'Failed to enqueue discovery.seed job',
        },
      });
      throw error;
    }

    return {
      jobRunId: run.id,
      status: 'RUNNING',
    };
  };

  const triggerDiscoveryTaskRun = async (
    input: RunDiscoveryTasksRequest,
  ): Promise<TriggerJobRunResponse> => {
    const startedAt = new Date();
    const concurrency = input.concurrency ?? 1;
    const run = await prisma.jobRun.create({
      data: {
        jobName: 'discovery.run_search_task',
        status: 'RUNNING',
        startedAt,
        paramsJson: toInputJson({
          ...input,
          concurrency,
        }),
        countersJson: {
          tasks_processed: 0,
          done: 0,
          failed: 0,
          skipped: 0,
          new_businesses: 0,
          new_sources: 0,
        } as Prisma.InputJsonValue,
        resourceJson: {
          serpapi_requests: 0,
          serpapi_cached_responses: 0,
          estimated_serpapi_cost_units: 0,
          db_writes: {
            businesses_inserted: 0,
            sources_inserted: 0,
            evidence_inserted: 0,
          },
        } as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    try {
      for (let slot = 0; slot < concurrency; slot += 1) {
        await boss.send(
          'discovery.run_search_task',
          {
            slot,
            reason: 'api',
            correlationId: `api:job_run:${run.id}`,
            jobRunId: run.id,
            maxTasks: input.maxTasks,
            timeBucket: input.timeBucket,
          },
          {
            retryLimit: 5,
            retryDelay: 30,
            retryBackoff: true,
          },
        );
      }
    } catch (error: unknown) {
      await prisma.jobRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          durationMs: Math.max(0, Date.now() - startedAt.getTime()),
          errorText:
            error instanceof Error
              ? error.message
              : 'Failed to enqueue discovery.run_search_task job',
        },
      });
      throw error;
    }

    return {
      jobRunId: run.id,
      status: 'RUNNING',
    };
  };

  const server = buildServer({
    env,
    logger,
    verifyAccessToken,
    checkUserActive: async (userId: string) => {
      const result = await query<{ banned_until: Date | string | null }>(
        `
          select banned_until
          from auth.users
          where id = $1::uuid
          limit 1
        `,
        [userId],
      );
      const bannedUntil = result.rows[0]?.banned_until;
      if (bannedUntil === undefined) return false;
      if (bannedUntil === null) return true;
      const bannedUntilDate = bannedUntil instanceof Date ? bannedUntil : new Date(bannedUntil);
      return bannedUntilDate < new Date();
    },
    checkDatabaseHealth: async () => {
      try {
        await assertDatabaseConnection();
        return true;
      } catch (error: unknown) {
        logger.error({ error }, 'Database readiness check failed');
        return false;
      }
    },
    checkSchemaHealth: async () => {
      try {
        return await checkPipelineSchemaHealth();
      } catch (error: unknown) {
        logger.error({ error }, 'Schema readiness check failed');
        return {
          status: 'fail',
          missingTables: [],
          missingEnumValues: [],
        };
      }
    },
    createLeadAndEnqueue: async (input) => {
      try {
        // B5 fix: resolve icpProfileId for manual leads — use first active ICP
        const activeIcp = await prisma.icpProfile.findFirst({
          where: { isActive: true },
          select: { id: true },
          orderBy: { createdAt: 'asc' },
        });
        const icpProfileId = input.icpProfileId ?? activeIcp?.id ?? undefined;

        const { lead, jobExecution, outboxEvent } = await prisma.$transaction(async (tx) => {
          const lead = await tx.lead.create({
            data: {
              firstName: input.firstName,
              lastName: input.lastName,
              email: input.email,
              source: input.source,
              status: 'new',
            },
          });

          const jobExecution = await tx.jobExecution.create({
            data: {
              type: 'features.compute',
              status: 'queued',
              payload: {
                leadId: lead.id,
                icpProfileId,
                snapshotVersion: 1,
              },
              leadId: lead.id,
            },
          });

          const outboxEvent = await tx.outboxEvent.create({
            data: {
              type: 'features.compute',
              payload: {
                leadId: lead.id,
                icpProfileId,
                snapshotVersion: 1,
                runId: jobExecution.id,
              },
              status: 'pending',
            },
          });

          return {
            lead,
            jobExecution,
            outboxEvent,
          };
        });

        await publishFeaturesCompute({
          leadId: lead.id,
          icpProfileId: icpProfileId!,
          jobId: jobExecution.id,
          outboxEventId: outboxEvent.id,
        });

        return {
          leadId: lead.id,
          jobId: jobExecution.id,
        };
      } catch (error: unknown) {
        if (error instanceof PrismaRuntime.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new LeadAlreadyExistsError('Lead already exists for this email');
        }

        throw error;
      }
    },
    createBackupLeadAndEnqueue: async (sourceLeadId, input) => {
      try {
        const sourceLead = await prisma.lead.findFirst({
          where: { id: sourceLeadId, deletedAt: null },
          select: {
            id: true,
            businessId: true,
            enrichmentData: true,
            scorePredictions: {
              orderBy: [{ predictedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
              take: 1,
              select: { icpProfileId: true },
            },
            discoveryRecords: {
              orderBy: [{ discoveredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
              take: 1,
              select: { icpProfileId: true },
            },
            businessConversions: {
              orderBy: [{ convertedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
              take: 1,
              select: { businessId: true, icpProfileId: true },
            },
          },
        });

        const resolvedIcpProfileId =
          input.icpProfileId
          ?? sourceLead?.scorePredictions[0]?.icpProfileId
          ?? sourceLead?.businessConversions[0]?.icpProfileId
          ?? sourceLead?.discoveryRecords[0]?.icpProfileId
          ?? undefined;
        const resolvedBusinessId =
          sourceLead?.businessId
          ?? sourceLead?.businessConversions[0]?.businessId
          ?? null;

        const [latestDiscovery, latestEnrichment, latestBusinessConversion] = await Promise.all([
          resolvedIcpProfileId
            ? prisma.leadDiscoveryRecord.findFirst({
                where: {
                  leadId: sourceLeadId,
                  icpProfileId: resolvedIcpProfileId,
                },
                orderBy: [{ discoveredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
              })
            : null,
          prisma.leadEnrichmentRecord.findFirst({
            where: { leadId: sourceLeadId },
            orderBy: [{ enrichedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
          }),
          resolvedBusinessId
            ? prisma.businessConversion.findFirst({
                where: {
                  leadId: sourceLeadId,
                  businessId: resolvedBusinessId,
                  ...(resolvedIcpProfileId ? { icpProfileId: resolvedIcpProfileId } : {}),
                },
                orderBy: [{ convertedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
              })
            : null,
        ]);
        const hasReusableEnrichmentContext = Boolean(
          latestEnrichment
          && (latestEnrichment.normalizedPayload !== null || latestEnrichment.rawPayload !== null),
        );

        if (!resolvedIcpProfileId) {
          throw new LeadContextUnavailableError(
            'Source lead is missing ICP context for backup contact staging',
          );
        }

        if (!resolvedBusinessId && !latestDiscovery && !hasReusableEnrichmentContext && !latestBusinessConversion) {
          throw new LeadContextUnavailableError(
            'Source lead does not have enough business qualification context to stage a backup contact',
          );
        }

        const inheritedEnrichmentData =
          sourceLead?.enrichmentData
          ?? latestEnrichment?.normalizedPayload
          ?? latestEnrichment?.rawPayload
          ?? null;

        const { lead, jobExecution, outboxEvent } = await prisma.$transaction(async (tx) => {
          const lead = await tx.lead.create({
            data: {
              firstName: input.firstName,
              lastName: input.lastName,
              email: input.email,
              source: input.source,
              status: 'new',
              ...(resolvedBusinessId ? { businessId: resolvedBusinessId } : {}),
              ...(inheritedEnrichmentData !== null
                ? { enrichmentData: toInputJson(inheritedEnrichmentData) }
                : {}),
            },
          });

          if (latestDiscovery) {
            await tx.leadDiscoveryRecord.create({
              data: {
                leadId: lead.id,
                icpProfileId: resolvedIcpProfileId,
                provider: latestDiscovery.provider,
                ...(latestDiscovery.providerSource
                  ? { providerSource: latestDiscovery.providerSource }
                  : {}),
                ...(latestDiscovery.providerConfidence !== null
                  ? { providerConfidence: latestDiscovery.providerConfidence }
                  : {}),
                providerRecordId: latestDiscovery.providerRecordId,
                ...(latestDiscovery.providerCursor
                  ? { providerCursor: latestDiscovery.providerCursor }
                  : {}),
                queryHash: latestDiscovery.queryHash,
                status: latestDiscovery.status,
                rawPayload: toInputJson(latestDiscovery.rawPayload),
                ...(latestDiscovery.provenanceJson !== null
                  ? { provenanceJson: toInputJson(latestDiscovery.provenanceJson) }
                  : {}),
                ...(latestDiscovery.errorMessage
                  ? { errorMessage: latestDiscovery.errorMessage }
                  : {}),
                discoveredAt: latestDiscovery.discoveredAt,
              },
            });
          }

          if (latestEnrichment && hasReusableEnrichmentContext) {
            await tx.leadEnrichmentRecord.create({
              data: {
                leadId: lead.id,
                provider: latestEnrichment.provider,
                status: latestEnrichment.status,
                attempt: latestEnrichment.attempt,
                ...(latestEnrichment.providerRecordId
                  ? { providerRecordId: latestEnrichment.providerRecordId }
                  : {}),
                ...(latestEnrichment.normalizedPayload !== null
                  ? { normalizedPayload: toInputJson(latestEnrichment.normalizedPayload) }
                  : {}),
                ...(latestEnrichment.rawPayload !== null
                  ? { rawPayload: toInputJson(latestEnrichment.rawPayload) }
                  : {}),
                ...(latestEnrichment.errorCode
                  ? { errorCode: latestEnrichment.errorCode }
                  : {}),
                ...(latestEnrichment.errorMessage
                  ? { errorMessage: latestEnrichment.errorMessage }
                  : {}),
                ...(latestEnrichment.enrichedAt
                  ? { enrichedAt: latestEnrichment.enrichedAt }
                  : {}),
                requestKey: `backup-contact:${sourceLeadId}:${lead.id}:${latestEnrichment.id}`,
              },
            });
          }

          if (latestBusinessConversion && resolvedBusinessId) {
            await tx.businessConversion.create({
              data: {
                businessId: resolvedBusinessId,
                leadId: lead.id,
                icpProfileId: latestBusinessConversion.icpProfileId ?? resolvedIcpProfileId,
                ...(latestBusinessConversion.apolloContactJson !== null
                  ? { apolloContactJson: toInputJson(latestBusinessConversion.apolloContactJson) }
                  : {}),
                ...(latestBusinessConversion.hunterContactJson !== null
                  ? { hunterContactJson: toInputJson(latestBusinessConversion.hunterContactJson) }
                  : {}),
                ...(latestBusinessConversion.metadata !== null
                  ? { metadata: toInputJson(latestBusinessConversion.metadata) }
                  : {}),
                ...(latestBusinessConversion.businessInsights
                  ? { businessInsights: latestBusinessConversion.businessInsights }
                  : {}),
                ...(latestBusinessConversion.apolloHasEmail !== null
                  ? { apolloHasEmail: latestBusinessConversion.apolloHasEmail }
                  : {}),
                ...(latestBusinessConversion.apolloHasDirectPhone !== null
                  ? { apolloHasDirectPhone: latestBusinessConversion.apolloHasDirectPhone }
                  : {}),
                convertedAt: latestBusinessConversion.convertedAt,
              },
            });
          }

          const jobExecution = await tx.jobExecution.create({
            data: {
              type: 'features.compute',
              status: 'queued',
              payload: {
                leadId: lead.id,
                icpProfileId: resolvedIcpProfileId,
                snapshotVersion: 1,
                sourceLeadId,
              },
              leadId: lead.id,
            },
          });

          const outboxEvent = await tx.outboxEvent.create({
            data: {
              type: 'features.compute',
              payload: {
                leadId: lead.id,
                icpProfileId: resolvedIcpProfileId,
                snapshotVersion: 1,
                runId: jobExecution.id,
                sourceLeadId,
              },
              status: 'pending',
            },
          });

          return {
            lead,
            jobExecution,
            outboxEvent,
          };
        });

        await publishFeaturesCompute({
          leadId: lead.id,
          icpProfileId: resolvedIcpProfileId,
          jobId: jobExecution.id,
          outboxEventId: outboxEvent.id,
        });

        return {
          leadId: lead.id,
          jobId: jobExecution.id,
        };
      } catch (error: unknown) {
        if (error instanceof PrismaRuntime.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new LeadAlreadyExistsError('Lead already exists for this email');
        }

        throw error;
      }
    },
    enqueueDiscoveryRun: async (payload: DiscoveryRunJobPayload) => {
      await boss.send(
        'discovery.seed',
        {
          reason: 'api',
          correlationId: payload.runId,
          countries: payload.countries,
          ...(payload.cities !== undefined ? { cities: payload.cities } : {}),
          discoveryRunId: payload.runId,
          icpProfileId: payload.icpProfileId,
          includeWebsiteAnalysis: payload.includeWebsiteAnalysis,
          includeSocialMediaAnalysis: payload.includeSocialMediaAnalysis,
          ...(payload.limit !== undefined ? { maxTasks: payload.limit } : {}),
          ...(payload.validationMode !== undefined ? { validationMode: payload.validationMode } : {}),
          ...(payload.minReviewCount !== undefined ? { minReviewCount: payload.minReviewCount } : {}),
          enqueueRunTasks: true,
        },
        {
          singletonKey: `discovery.seed:${payload.runId}:${payload.icpProfileId}`,
          retryLimit: 3,
          retryDelay: 60,
          retryBackoff: true,
        },
      );
    },
    enqueueScoringRun: async (payload: ScoringRunJobPayload) => {
      await boss.send('scoring.compute', payload, {
        singletonKey: `scoring.compute:${payload.runId}`,
        retryLimit: 3,
        retryDelay: 30,
        retryBackoff: true,
      });
    },
    enqueueMessageSend: async (payload: MessagingSendJobPayload) => {
      await boss.send('message.send', payload, {
        singletonKey: `message.send:${payload.sendId}`,
        retryLimit: 5,
        retryDelay: 90,
        retryBackoff: true,
      });
    },
    enqueueMessageGenerate: async (payload: MessageGenerateJobPayload) => {
      await boss.send('message.generate', payload, {
        singletonKey: `message.generate:${payload.leadId}:${payload.icpProfileId}`,
        retryLimit: 3,
        retryDelay: 30,
        retryBackoff: true,
      });
    },
    enqueueAnalyticsRollup: async (payload: AnalyticsRollupJobPayload) => {
      await boss.send('analytics.rollup', payload, {
        singletonKey: `analytics.rollup:${payload.icpProfileId}:${payload.day}`,
        retryLimit: 3,
        retryDelay: 30,
        retryBackoff: true,
      });
    },
    enqueueReplyClassify,
    trengoWebhookSecret: env.TRENGO_WEBHOOK_SECRET,
    resendWebhookSecret: env.RESEND_WEBHOOK_SECRET,
    triggerDiscoverySeedJob,
    triggerDiscoveryTaskRun,
    ...(env.ADMIN_API_KEY ? { adminApiKey: env.ADMIN_API_KEY } : {}),
    getLeadById: async (leadId) => {
      const lead = await prisma.lead.findUnique({
        where: { id: leadId, deletedAt: null },
        include: {
          enrichmentRecords: {
            orderBy: [{ enrichedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
            take: 1,
            select: { normalizedPayload: true },
          },
          businessConversions: {
            take: 1,
            orderBy: { createdAt: 'desc' },
            include: {
              business: {
                select: { countryCode: true, country: true, city: true, category: true },
              },
            },
          },
        },
      });
      if (!lead) return null;
      const biz = lead.businessConversions[0]?.business;
      const conversionMetadata =
        lead.businessConversions[0]?.metadata && typeof lead.businessConversions[0].metadata === 'object' && !Array.isArray(lead.businessConversions[0].metadata)
          ? lead.businessConversions[0].metadata as Record<string, unknown>
          : null;
      const contactRecovery =
        conversionMetadata?.contactRecovery && typeof conversionMetadata.contactRecovery === 'object' && !Array.isArray(conversionMetadata.contactRecovery)
          ? conversionMetadata.contactRecovery as Record<string, unknown>
          : null;
      const telemetry =
        contactRecovery?.telemetry && typeof contactRecovery.telemetry === 'object' && !Array.isArray(contactRecovery.telemetry)
          ? contactRecovery.telemetry as Record<string, unknown>
          : null;
      const confidence =
        conversionMetadata?.confidence && typeof conversionMetadata.confidence === 'object' && !Array.isArray(conversionMetadata.confidence)
          ? conversionMetadata.confidence as Record<string, unknown>
          : null;
      const decisionProvenance =
        conversionMetadata?.decisionProvenance && typeof conversionMetadata.decisionProvenance === 'object' && !Array.isArray(conversionMetadata.decisionProvenance)
          ? conversionMetadata.decisionProvenance as Record<string, unknown>
          : null;
      const topCandidates = Array.isArray(contactRecovery?.topCandidates)
        ? contactRecovery.topCandidates
        : [];
      const latestEnrichmentPayload =
        (lead.enrichmentRecords[0]?.normalizedPayload as Prisma.JsonValue | null | undefined) ?? null;
      return {
        ...lead,
        enrichmentData: latestEnrichmentPayload ?? lead.enrichmentData,
        businessCountryCode: biz?.countryCode ?? null,
        businessCountry: biz?.country ?? null,
        businessCity: biz?.city ?? null,
        businessCategory: biz?.category ?? null,
        latestIcpProfileId: lead.businessConversions[0]?.icpProfileId ?? null,
        contactDiscovery: telemetry
          ? {
              cseVerifyAttempted: telemetry.cseVerifyAttempted === true,
              cseVerifySucceeded: telemetry.cseVerifySucceeded === true,
              cseDiscoverAttempted: telemetry.cseDiscoverAttempted === true,
              cseDiscoverSucceeded: telemetry.cseDiscoverSucceeded === true,
              cseRawResults: typeof telemetry.cseRawResults === 'number' ? telemetry.cseRawResults : 0,
              cseValidProfiles: typeof telemetry.cseValidProfiles === 'number' ? telemetry.cseValidProfiles : 0,
              cseCandidatesAdded: typeof telemetry.cseCandidatesAdded === 'number' ? telemetry.cseCandidatesAdded : 0,
              cseCandidatesValidated: typeof telemetry.cseCandidatesValidated === 'number' ? telemetry.cseCandidatesValidated : 0,
              cseEmailsInferred: typeof telemetry.cseEmailsInferred === 'number' ? telemetry.cseEmailsInferred : 0,
              verificationVerdict:
                telemetry.verificationVerdict === 'verified'
                || telemetry.verificationVerdict === 'not_verified'
                || telemetry.verificationVerdict === 'inconclusive'
                || telemetry.verificationVerdict === 'skipped'
                  ? telemetry.verificationVerdict
                  : 'skipped',
              supportingUrls: Array.isArray(telemetry.supportingUrls)
                ? telemetry.supportingUrls.filter((url): url is string => typeof url === 'string')
                : Array.isArray(contactRecovery?.supportingUrls)
                  ? contactRecovery.supportingUrls.filter((url): url is string => typeof url === 'string')
                  : [],
              diagnostics: Array.isArray(telemetry.diagnostics)
                ? telemetry.diagnostics
                  .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
                  .map((item) => ({
                    stage: typeof item.stage === 'string' ? item.stage : 'unknown',
                    sourceFamily:
                      item.sourceFamily === 'linkedin'
                      || item.sourceFamily === 'company_page'
                      || item.sourceFamily === 'public_web'
                      || item.sourceFamily === 'mixed'
                      || item.sourceFamily === 'unknown'
                        ? item.sourceFamily
                        : 'unknown',
                    queryFamily: item.queryFamily === 'DISCOVER_ROLES'
                      ? item.queryFamily
                      : 'DISCOVER_ROLES',
                    rawResultCount: typeof item.rawResultCount === 'number' ? item.rawResultCount : 0,
                    promotedCount: typeof item.promotedCount === 'number' ? item.promotedCount : 0,
                    verdict:
                      item.verdict === 'verified'
                      || item.verdict === 'not_verified'
                      || item.verdict === 'inconclusive'
                      || item.verdict === 'skipped'
                        ? item.verdict
                        : 'skipped',
                  }))
                : [],
              topQueryFamily:
                telemetry.topQueryFamily === 'DISCOVER_ROLES'
                  ? telemetry.topQueryFamily
                  : contactRecovery?.topQueryFamily === 'DISCOVER_ROLES'
                    ? contactRecovery.topQueryFamily
                    : null,
              topSourceFamily:
                telemetry.topSourceFamily === 'linkedin'
                || telemetry.topSourceFamily === 'company_page'
                || telemetry.topSourceFamily === 'public_web'
                || telemetry.topSourceFamily === 'mixed'
                || telemetry.topSourceFamily === 'unknown'
                  ? telemetry.topSourceFamily
                  : contactRecovery?.topSourceFamily === 'linkedin'
                    || contactRecovery?.topSourceFamily === 'company_page'
                    || contactRecovery?.topSourceFamily === 'public_web'
                    || contactRecovery?.topSourceFamily === 'mixed'
                    || contactRecovery?.topSourceFamily === 'unknown'
                      ? contactRecovery.topSourceFamily
                  : 'unknown',
              finalOutcome:
                telemetry.finalOutcome === 'lead_created'
                || telemetry.finalOutcome === 'recovery_opened'
                || telemetry.finalOutcome === 'no_contact_terminal'
                  ? telemetry.finalOutcome
                  : 'lead_created',
              topCandidates: topCandidates
                .filter((candidate): candidate is Record<string, unknown> => Boolean(candidate) && typeof candidate === 'object' && !Array.isArray(candidate))
                .slice(0, 3)
                .map((candidate) => ({
                  name: typeof candidate.name === 'string' ? candidate.name : 'Unknown',
                  title: typeof candidate.title === 'string' ? candidate.title : null,
                  sourceStage: typeof candidate.sourceStage === 'string' ? candidate.sourceStage : null,
                  linkedinUrl: typeof candidate.linkedinUrl === 'string' ? candidate.linkedinUrl : null,
                  email: typeof candidate.email === 'string' ? candidate.email : null,
                  confidence: typeof candidate.confidence === 'number' ? candidate.confidence : null,
                  verificationVerdict:
                    candidate.verificationVerdict === 'verified'
                    || candidate.verificationVerdict === 'not_verified'
                    || candidate.verificationVerdict === 'inconclusive'
                    || candidate.verificationVerdict === 'skipped'
                      ? candidate.verificationVerdict
                      : 'skipped',
                  supportingUrls: Array.isArray(candidate.supportingUrls)
                    ? candidate.supportingUrls.filter((url): url is string => typeof url === 'string')
                    : [],
                  matchedSignals: Array.isArray(candidate.matchedSignals)
                    ? candidate.matchedSignals.filter((signal): signal is string => typeof signal === 'string')
                    : [],
                })),
              identityConfidence: typeof contactRecovery?.identityConfidence === 'number'
                ? contactRecovery.identityConfidence
                : typeof confidence?.identityConfidence === 'number'
                  ? confidence.identityConfidence
                  : null,
              contactConfidence: typeof contactRecovery?.contactConfidence === 'number'
                ? contactRecovery.contactConfidence
                : typeof confidence?.contactConfidence === 'number'
                  ? confidence.contactConfidence
                  : null,
              terminalReason:
                contactRecovery?.terminalReason === 'no_named_candidate_found'
                || contactRecovery?.terminalReason === 'named_candidate_no_email'
                || contactRecovery?.terminalReason === 'email_inferred_failed_verification'
                || contactRecovery?.terminalReason === 'ambiguous_winner'
                  ? contactRecovery.terminalReason
                  : null,
              resolutionState:
                contactRecovery?.resolutionState === 'lead_created'
                || contactRecovery?.resolutionState === 'inconclusive_but_promising'
                || contactRecovery?.resolutionState === 'no_contact_terminal'
                  ? contactRecovery.resolutionState
                  : null,
              winnerSelectionMethod:
                contactRecovery?.winnerSelectionMethod === 'llm'
                || contactRecovery?.winnerSelectionMethod === 'deterministic'
                  ? contactRecovery.winnerSelectionMethod
                  : decisionProvenance?.winnerSelectionMethod === 'llm'
                    || decisionProvenance?.winnerSelectionMethod === 'deterministic'
                      ? decisionProvenance.winnerSelectionMethod
                      : null,
              adjudication:
                contactRecovery?.adjudication && typeof contactRecovery.adjudication === 'object' && !Array.isArray(contactRecovery.adjudication)
                  ? {
                      verdict:
                        (contactRecovery.adjudication as Record<string, unknown>).verdict === 'select_candidate'
                        || (contactRecovery.adjudication as Record<string, unknown>).verdict === 'inconclusive'
                        || (contactRecovery.adjudication as Record<string, unknown>).verdict === 'reject_all'
                          ? (contactRecovery.adjudication as Record<string, unknown>).verdict
                          : 'inconclusive',
                      selectedCandidateId: typeof (contactRecovery.adjudication as Record<string, unknown>).selectedCandidateId === 'string'
                        ? (contactRecovery.adjudication as Record<string, unknown>).selectedCandidateId
                        : null,
                      confidenceBucket:
                        (contactRecovery.adjudication as Record<string, unknown>).confidenceBucket === 'high'
                        || (contactRecovery.adjudication as Record<string, unknown>).confidenceBucket === 'medium'
                        || (contactRecovery.adjudication as Record<string, unknown>).confidenceBucket === 'low'
                          ? (contactRecovery.adjudication as Record<string, unknown>).confidenceBucket
                          : null,
                      rationale: typeof (contactRecovery.adjudication as Record<string, unknown>).rationale === 'string'
                        ? (contactRecovery.adjudication as Record<string, unknown>).rationale
                        : 'No rationale available',
                    }
                  : null,
            }
          : null,
      };
    },
    softDeleteLead: async (leadId) => {
      const lead = await prisma.lead.findUnique({
        where: { id: leadId, deletedAt: null },
        select: { id: true },
      });
      if (!lead) return false;
      await prisma.lead.update({
        where: { id: leadId },
        data: { deletedAt: new Date() },
      });
      return true;
    },
    listLeads: async (query) => {
      try {
      const where: Prisma.LeadWhereInput = {
        deletedAt: null,
        // Exclude rejected leads by default unless includeRejected is true
        ...(!query.includeRejected ? { status: { not: 'rejected' } } : {}),
        ...(query.icpProfileId
          ? {
              OR: [
                { discoveryRecords: { some: { icpProfileId: query.icpProfileId } } },
                { scorePredictions: { some: { icpProfileId: query.icpProfileId } } },
                { businessConversions: { some: { icpProfileId: query.icpProfileId } } },
              ],
            }
          : {}),
        // Status filter (overrides the rejected exclusion if explicitly set)
        ...(query.status ? { status: query.status } : {}),
        ...(query.scoreBand || query.minBlendedScore !== undefined
          ? {
              scorePredictions: {
                some: {
                  ...(query.icpProfileId ? { icpProfileId: query.icpProfileId } : {}),
                  ...(query.scoreBand ? { scoreBand: query.scoreBand } : {}),
                  ...(query.minBlendedScore !== undefined ? { blendedScore: { gte: query.minBlendedScore } } : {}),
                },
              },
            }
          : {}),
        ...(query.from || query.to
          ? {
              createdAt: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
              },
            }
          : {}),
        // Search filter: match firstName, lastName, or email (case-insensitive)
        ...(query.search
          ? {
              AND: [
                {
                  OR: [
                    { firstName: { contains: query.search, mode: 'insensitive' as const } },
                    { lastName: { contains: query.search, mode: 'insensitive' as const } },
                    { email: { contains: query.search, mode: 'insensitive' as const } },
                    { business: { name: { contains: query.search, mode: 'insensitive' as const } } },
                    { business: { category: { contains: query.search, mode: 'insensitive' as const } } },
                  ],
                },
              ],
            }
          : {}),
      };

      const [total, rows] = await Promise.all([
        prisma.lead.count({ where }),
        prisma.lead.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: {
            discoveryRecords: {
              ...(query.icpProfileId ? { where: { icpProfileId: query.icpProfileId } } : {}),
              orderBy: [{ discoveredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
              take: 1,
            },
            businessConversions: {
              orderBy: [{ convertedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
              take: 1,
              select: { id: true, convertedAt: true, icpProfileId: true },
            },
            enrichmentRecords: {
              orderBy: [{ enrichedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
              take: 1,
            },
            scorePredictions: {
              ...(query.icpProfileId ? { where: { icpProfileId: query.icpProfileId } } : {}),
              orderBy: [{ predictedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
              take: 1,
            },
            business: {
              select: { countryCode: true, country: true, city: true, category: true, name: true },
            },
          },
        }),
      ]);

      const qualityRows = query.includeQualityMetrics
        ? await prisma.analyticsDailyRollup.findMany({
            where: {
              ...(query.icpProfileId ? { icpProfileId: query.icpProfileId } : {}),
              ...(query.from || query.to
                ? {
                    day: {
                      ...(query.from ? { gte: toDayStart(query.from) } : {}),
                      ...(query.to ? { lte: toDayStart(query.to) } : {}),
                    },
                  }
                : {}),
            },
            select: {
              discoveredCount: true,
              validEmailCount: true,
              validDomainCount: true,
              industryMatchRate: true,
              geoMatchRate: true,
            },
          })
        : [];
      const qualityDenominator = qualityRows.reduce((sum, row) => sum + row.discoveredCount, 0);
      const qualityMetrics = query.includeQualityMetrics
        ? {
            validEmailCount: qualityRows.reduce((sum, row) => sum + row.validEmailCount, 0),
            validDomainCount: qualityRows.reduce((sum, row) => sum + row.validDomainCount, 0),
            industryMatchRate:
              qualityDenominator > 0
                ? Number(
                    (
                      qualityRows.reduce(
                        (sum, row) => sum + row.industryMatchRate * row.discoveredCount,
                        0,
                      ) / qualityDenominator
                    ).toFixed(6),
                  )
                : 0,
            geoMatchRate:
              qualityDenominator > 0
                ? Number(
                    (
                      qualityRows.reduce((sum, row) => sum + row.geoMatchRate * row.discoveredCount, 0) /
                      qualityDenominator
                    ).toFixed(6),
                  )
                : 0,
          }
        : undefined;

      return {
        items: rows.map((lead) => {
          // Fall back to lead.enrichmentData when relation tables are empty (e.g. seed data)
          const enrichmentFallback = lead.enrichmentData as Record<string, unknown> | null;
          const scoreInfoFallback = enrichmentFallback?._scoreInfo as Record<string, unknown> | undefined;

          return {
            id: lead.id,
            firstName: lead.firstName,
            lastName: lead.lastName,
            email: lead.email,
            source: lead.source,
            status: lead.status,
            error: lead.error,
            createdAt: lead.createdAt.toISOString(),
            updatedAt: lead.updatedAt.toISOString(),
            latestIcpProfileId: lead.discoveryRecords[0]?.icpProfileId ?? lead.scorePredictions[0]?.icpProfileId ?? lead.businessConversions[0]?.icpProfileId ?? null,
            latestScoreBand: lead.scorePredictions[0]?.scoreBand
              ?? (scoreInfoFallback?.scoreBand === 'HIGH' || scoreInfoFallback?.scoreBand === 'MEDIUM' || scoreInfoFallback?.scoreBand === 'LOW'
                ? scoreInfoFallback.scoreBand : null),
            latestBlendedScore: lead.scorePredictions[0]?.blendedScore
              ?? (typeof scoreInfoFallback?.blendedScore === 'number' ? scoreInfoFallback.blendedScore : null),
            latestScorePredictionId: lead.scorePredictions[0]?.id ?? null,
            latestDiscoveryRawPayload: lead.discoveryRecords[0]?.rawPayload ?? null,
            latestEnrichmentNormalizedPayload: lead.enrichmentRecords[0]?.normalizedPayload ?? enrichmentFallback ?? null,
            latestEnrichmentRawPayload: lead.enrichmentRecords[0]?.rawPayload ?? null,
            businessCountryCode: lead.business?.countryCode ?? null,
            businessCountry: lead.business?.country ?? null,
            businessCity: lead.business?.city ?? null,
            businessCategory: lead.business?.category ?? null,
            businessName: lead.business?.name ?? null,
            decisionMakerTitle: lead.decisionMakerTitle ?? null,
          };
        }),
        qualityMetrics,
        page: query.page,
        pageSize: query.pageSize,
        total,
      };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error({ error: message }, 'listLeads query failed — returning empty result');
        return {
          items: [],
          qualityMetrics: undefined,
          page: query.page,
          pageSize: query.pageSize,
          total: 0,
        };
      }
    },
    listContactRecoveryItems: async (query: ListContactRecoveryItemsQuery): Promise<ListContactRecoveryItemsResponse> => {
      const where: Prisma.ContactRecoveryItemWhereInput = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.icpProfileId ? { icpProfileId: query.icpProfileId } : {}),
        ...(query.from || query.to
          ? {
              createdAt: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
              },
            }
          : {}),
        ...(query.q
          ? {
              OR: [
                { business: { name: { contains: query.q, mode: 'insensitive' } } },
                { business: { websiteDomain: { contains: query.q, mode: 'insensitive' } } },
                { business: { city: { contains: query.q, mode: 'insensitive' } } },
                { business: { category: { contains: query.q, mode: 'insensitive' } } },
              ],
            }
          : {}),
        // Exclude businesses whose associated leads are currently rejected.
        // Do NOT key this off LeadRejection existence, because a lead may have
        // historical rejection records but later move back to a non-rejected status.
        NOT: {
          business: {
            businessConversions: {
              some: {
                lead: {
                  status: 'rejected',
                },
              },
            },
          },
        },
      };

      const [total, rows] = await Promise.all([
        prisma.contactRecoveryItem.count({ where }),
        prisma.contactRecoveryItem.findMany({
          where,
          orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: {
            business: {
              select: {
                id: true,
                name: true,
                city: true,
                country: true,
                countryCode: true,
                websiteDomain: true,
                instagramHandle: true,
                category: true,
                deterministicScore: true,
                scoreBand: true,
                preQualified: true,
                disqualificationReason: true,
              },
            },
            icpProfile: {
              select: { name: true },
            },
          },
        }),
      ]);

      return {
        items: rows.map(mapContactRecoveryItem),
        page: query.page,
        pageSize: query.pageSize,
        total,
      };
    },
    getContactRecoveryItem: async (id: string): Promise<ContactRecoveryDetailResponse | null> => {
      const row = await prisma.contactRecoveryItem.findUnique({
        where: { id },
        include: {
          business: {
            select: {
              id: true,
              name: true,
              city: true,
              country: true,
              countryCode: true,
              websiteDomain: true,
              instagramHandle: true,
              category: true,
              deterministicScore: true,
              scoreBand: true,
              preQualified: true,
              disqualificationReason: true,
            },
          },
          icpProfile: {
            select: { name: true },
          },
        },
      });

      return row ? mapContactRecoveryItem(row) : null;
    },
    rejectContactRecoveryItem: async ({ id, rejectedBy, reason }): Promise<ContactRecoveryDetailResponse | null> => {
      const existing = await prisma.contactRecoveryItem.findUnique({
        where: { id },
        select: { id: true, status: true, recoverySnapshot: true },
      });

      if (!existing) {
        return null;
      }

      // Already rejected or approved — skip re-rejection
      if (existing.status !== 'OPEN') {
        // Return the current state instead of re-rejecting
        const current = await prisma.contactRecoveryItem.findUnique({
          where: { id },
          include: {
            business: {
              select: {
                id: true,
                name: true,
                city: true,
                country: true,
                countryCode: true,
                websiteDomain: true,
                instagramHandle: true,
                category: true,
                deterministicScore: true,
                scoreBand: true,
                preQualified: true,
                disqualificationReason: true,
              },
            },
            icpProfile: {
              select: { name: true },
            },
          },
        });
        return current ? mapContactRecoveryItem(current) : null;
      }

      const snapshotObject =
        existing.recoverySnapshot && typeof existing.recoverySnapshot === 'object' && !Array.isArray(existing.recoverySnapshot)
          ? existing.recoverySnapshot as Record<string, unknown>
          : {};

      const nextSnapshot = {
        ...snapshotObject,
        rejectedReason: reason ?? null,
      } satisfies Record<string, unknown>;

      const updated = await prisma.contactRecoveryItem.update({
        where: { id },
        data: {
          status: 'REJECTED',
          rejectedBy,
          rejectedAt: new Date(),
          recoverySnapshot: toInputJson(nextSnapshot),
        },
        include: {
          business: {
            select: {
              id: true,
              name: true,
              city: true,
              country: true,
              countryCode: true,
              websiteDomain: true,
              instagramHandle: true,
              category: true,
              deterministicScore: true,
              scoreBand: true,
              preQualified: true,
              disqualificationReason: true,
            },
          },
          icpProfile: {
            select: { name: true },
          },
        },
      });

      return mapContactRecoveryItem(updated);
    },
    getJobById: async (jobId) => {
      return prisma.jobExecution.findUnique({
        where: { id: jobId },
      });
    },
  });

  await server.listen({
    host: '0.0.0.0',
    port: env.API_PORT,
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down API');
    await server.close();
    await boss.stop();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

main().catch((error: unknown) => {
  console.error('API boot failed:', error);
  process.exit(1);
});
