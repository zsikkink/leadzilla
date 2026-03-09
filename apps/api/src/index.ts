import PgBoss from 'pg-boss';

import { Prisma, checkPipelineSchemaHealth, prisma, toInputJson } from '@lead-flood/db';
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
import { ContactRecoverySnapshotSchema } from '@lead-flood/contracts';

import { buildSupabaseAccessTokenVerifier } from './auth/supabase.js';
import { loadApiEnv } from './env.js';
import type { ReplyClassifyJobPayload } from '@lead-flood/contracts';

import type { AnalyticsRollupJobPayload } from './modules/analytics/analytics.service.js';
import type { DiscoveryRunJobPayload } from './modules/discovery/discovery.service.js';
import type { MessageGenerateJobPayload, MessagingSendJobPayload } from './modules/messaging/messaging.service.js';
import type { ScoringRunJobPayload } from './modules/scoring/scoring.service.js';
import { buildServer, LeadAlreadyExistsError } from './server.js';

function toDayStart(value: string): Date {
  const source = new Date(value);
  return new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth(), source.getUTCDate()));
}

function mapContactRecoveryItem(record: {
  id: string;
  businessId: string;
  icpProfileId: string;
  discoveryRunId: string;
  status: 'OPEN' | 'REJECTED';
  reason: 'NO_CONTACTS_FOUND' | 'NO_EMAIL';
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
  });

  await boss.start();
  await boss.createQueue('features.compute');
  await boss.createQueue('scoring.compute');
  await boss.createQueue('message.send');
  await boss.createQueue('message.generate');
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
      const rows = await prisma.$queryRaw<Array<{ banned_until: Date | null }>>`
        SELECT banned_until FROM auth.users WHERE id = ${userId}::uuid LIMIT 1
      `;
      if (rows.length === 0) return false;
      const bannedUntil = rows[0]!.banned_until;
      return bannedUntil === null || bannedUntil < new Date();
    },
    checkDatabaseHealth: async () => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        return true;
      } catch (error: unknown) {
        logger.error({ error }, 'Database readiness check failed');
        return false;
      }
    },
    checkSchemaHealth: async () => {
      try {
        return await checkPipelineSchemaHealth(prisma);
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

        try {
          await boss.send(
            'features.compute',
            {
              leadId: lead.id,
              icpProfileId,
              snapshotVersion: 1,
              runId: jobExecution.id,
            },
            {
              singletonKey: `features.compute:${lead.id}`,
              retryLimit: 3,
              retryDelay: 5,
              retryBackoff: true,
            },
          );

          await prisma.outboxEvent.update({
            where: { id: outboxEvent.id },
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
            { error, leadId: lead.id, outboxEventId: outboxEvent.id },
            'Immediate queue publish failed; outbox retry will handle dispatch',
          );

          await prisma.outboxEvent.update({
            where: { id: outboxEvent.id },
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

        return {
          leadId: lead.id,
          jobId: jobExecution.id,
        };
      } catch (error: unknown) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
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
                    queryFamily:
                      item.queryFamily === 'V1_linkedin_exact'
                      || item.queryFamily === 'V2_company_domain_exact'
                      || item.queryFamily === 'V3_public_web_exact'
                      || item.queryFamily === 'V4_exact_without_title'
                      || item.queryFamily === 'D1_linkedin_roles'
                      || item.queryFamily === 'D2_company_team_pages'
                      || item.queryFamily === 'D3_company_about_pages'
                      || item.queryFamily === 'D4_press_news_mentions'
                      || item.queryFamily === 'D5_public_web_role_queries'
                      || item.queryFamily === 'D6_locality_first_queries'
                        ? item.queryFamily
                        : 'D5_public_web_role_queries',
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
                telemetry.topQueryFamily === 'V1_linkedin_exact'
                || telemetry.topQueryFamily === 'V2_company_domain_exact'
                || telemetry.topQueryFamily === 'V3_public_web_exact'
                || telemetry.topQueryFamily === 'V4_exact_without_title'
                || telemetry.topQueryFamily === 'D1_linkedin_roles'
                || telemetry.topQueryFamily === 'D2_company_team_pages'
                || telemetry.topQueryFamily === 'D3_company_about_pages'
                || telemetry.topQueryFamily === 'D4_press_news_mentions'
                || telemetry.topQueryFamily === 'D5_public_web_role_queries'
                || telemetry.topQueryFamily === 'D6_locality_first_queries'
                  ? telemetry.topQueryFamily
                  : contactRecovery?.topQueryFamily === 'V1_linkedin_exact'
                    || contactRecovery?.topQueryFamily === 'V2_company_domain_exact'
                    || contactRecovery?.topQueryFamily === 'V3_public_web_exact'
                    || contactRecovery?.topQueryFamily === 'V4_exact_without_title'
                    || contactRecovery?.topQueryFamily === 'D1_linkedin_roles'
                    || contactRecovery?.topQueryFamily === 'D2_company_team_pages'
                    || contactRecovery?.topQueryFamily === 'D3_company_about_pages'
                    || contactRecovery?.topQueryFamily === 'D4_press_news_mentions'
                    || contactRecovery?.topQueryFamily === 'D5_public_web_role_queries'
                    || contactRecovery?.topQueryFamily === 'D6_locality_first_queries'
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
              select: { countryCode: true, country: true, city: true, category: true },
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
          };
        }),
        qualityMetrics,
        page: query.page,
        pageSize: query.pageSize,
        total,
      };
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
        select: { id: true, recoverySnapshot: true },
      });

      if (!existing) {
        return null;
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
