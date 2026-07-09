import PgBoss from 'pg-boss';

import {
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
  LeadDisplayScoreSource,
  LeadScoreBand,
  ListContactRecoveryItemsQuery,
  ListContactRecoveryItemsResponse,
  ListLeadsQuery,
  RunDiscoverySeedRequest,
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
import type { LearningModelTrainJobPayload } from './modules/learning/learning.service.js';
import type { MessageGenerateJobPayload, MessagingSendJobPayload } from './modules/messaging/messaging.service.js';
import type { ScoringRunJobPayload } from './modules/scoring/scoring.service.js';
import { buildTriggerDiscoveryTaskRun } from './modules/discovery-admin/discovery-task-run.trigger.js';
import {
  buildServer,
  LeadAlreadyExistsError,
  LeadContextUnavailableError,
  type HunterEnrichQueuePayload,
} from './server.js';
import type { ResendReceivedEmail } from './modules/webhook/webhook.service.js';

const OUTBOUND_DISABLED_FAILURE_CODE = 'OUTBOUND_DISABLED';
const OUTBOUND_DISABLED_FAILURE_REASON =
  'Outbound sending is disabled for the Leadzilla demo. Drafts can be reviewed and approved, but email and WhatsApp delivery are blocked.';

function toDayStart(value: string): Date {
  const source = new Date(value);
  return new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth(), source.getUTCDate()));
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function buildResendReceivedEmailFetcher(
  apiKey: string | undefined,
): ((emailId: string) => Promise<ResendReceivedEmail | null>) | undefined {
  if (!apiKey) {
    return undefined;
  }

  return async (emailId: string): Promise<ResendReceivedEmail | null> => {
    const response = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Resend Receiving API returned status ${response.status}`);
    }

    const body = await response.json() as Record<string, unknown>;

    return {
      id: toNullableString(body.id) ?? emailId,
      from: toNullableString(body.from),
      to: toStringArray(body.to),
      subject: toNullableString(body.subject),
      text: toNullableString(body.text),
      html: toNullableString(body.html),
      createdAt: toNullableString(body.created_at),
    };
  };
}

function pushSqlParam(params: unknown[], value: unknown): string {
  params.push(value);
  return `$${params.length}`;
}

function isLeadScoreBand(value: unknown): value is LeadScoreBand {
  return value === 'LOW' || value === 'MEDIUM' || value === 'HIGH';
}

function readLegacyScoreInfo(scoreInfoFallback: Record<string, unknown> | undefined): {
  score: number | null;
  band: LeadScoreBand | null;
} {
  return {
    score: typeof scoreInfoFallback?.blendedScore === 'number' ? scoreInfoFallback.blendedScore : null,
    band: isLeadScoreBand(scoreInfoFallback?.scoreBand) ? scoreInfoFallback.scoreBand : null,
  };
}

function resolveDisplayScore(input: {
  latestScore: { blendedScore: number; scoreBand: LeadScoreBand } | null | undefined;
  legacyScore: number | null;
  legacyBand: LeadScoreBand | null;
  businessScore: number | null | undefined;
  businessBand: LeadScoreBand | null | undefined;
}): {
  score: number | null;
  band: LeadScoreBand | null;
  source: LeadDisplayScoreSource;
} {
  if (input.latestScore) {
    return {
      score: input.latestScore.blendedScore,
      band: input.latestScore.scoreBand,
      source: 'AI_SCORE',
    };
  }

  if (input.legacyScore !== null) {
    return {
      score: input.legacyScore,
      band: input.legacyBand,
      source: 'LEGACY_SCORE',
    };
  }

  if (typeof input.businessScore === 'number' && Number.isFinite(input.businessScore)) {
    return {
      score: input.businessScore,
      band: input.businessBand ?? null,
      source: 'BUSINESS_SCORE',
    };
  }

  return {
    score: null,
    band: null,
    source: 'NONE',
  };
}

function buildLeadIdsSql(
  listQuery: ListLeadsQuery,
  options: { includePagination: boolean } = { includePagination: true },
): { text: string; values: readonly unknown[] } {
  const values: unknown[] = [];
  const where: string[] = ['l."deletedAt" is null'];
  const latestScoreWhere: string[] = ['sp."leadId" = l.id'];
  const legacyScoreSql = `case
    when l."enrichmentData" #>> '{_scoreInfo,blendedScore}' ~ '^[0-9]+(\\.[0-9]+)?$'
    then (l."enrichmentData" #>> '{_scoreInfo,blendedScore}')::double precision
    else null
  end`;
  const legacyBandSql = `case
    when l."enrichmentData" #>> '{_scoreInfo,scoreBand}' in ('LOW', 'MEDIUM', 'HIGH')
    then l."enrichmentData" #>> '{_scoreInfo,scoreBand}'
    else null
  end`;
  const resolvedScoreSql = `coalesce(latest_score."blendedScore", ${legacyScoreSql}, b.deterministic_score)`;
  const resolvedBandSql = `coalesce(latest_score."scoreBand"::text, ${legacyBandSql}, b.score_band::text)`;

  if (listQuery.icpProfileId) {
    const latestScoreIcp = pushSqlParam(values, listQuery.icpProfileId);
    latestScoreWhere.push(`sp."icpProfileId" = ${latestScoreIcp}`);
  }

  if (listQuery.status) {
    const status = pushSqlParam(values, listQuery.status);
    where.push(`l.status = ${status}`);
  } else if (!listQuery.includeRejected) {
    where.push("l.status <> 'rejected'");
  }

  if (listQuery.icpProfileId) {
    const discoveryIcp = pushSqlParam(values, listQuery.icpProfileId);
    const scoreIcp = pushSqlParam(values, listQuery.icpProfileId);
    const conversionIcp = pushSqlParam(values, listQuery.icpProfileId);
    where.push(`(
      exists (
        select 1
        from "LeadDiscoveryRecord" dr
        where dr."leadId" = l.id and dr."icpProfileId" = ${discoveryIcp}
      )
      or exists (
        select 1
        from "LeadScorePrediction" sp_icp
        where sp_icp."leadId" = l.id and sp_icp."icpProfileId" = ${scoreIcp}
      )
      or exists (
        select 1
        from "business_conversions" bc
        where bc."leadId" = l.id and bc."icpProfileId" = ${conversionIcp}
      )
    )`);
  }

  if (listQuery.scoreBand || listQuery.minBlendedScore !== undefined) {
    if (listQuery.scoreBand) {
      const scoreBand = pushSqlParam(values, listQuery.scoreBand);
      where.push(`${resolvedBandSql} = ${scoreBand}`);
    }
    if (listQuery.minBlendedScore !== undefined) {
      const minScore = pushSqlParam(values, listQuery.minBlendedScore);
      where.push(`${resolvedScoreSql} >= ${minScore}`);
    }
  }

  if (listQuery.from) {
    const from = pushSqlParam(values, new Date(listQuery.from));
    where.push(`l."createdAt" >= ${from}`);
  }
  if (listQuery.to) {
    const to = pushSqlParam(values, new Date(listQuery.to));
    where.push(`l."createdAt" <= ${to}`);
  }

  if (listQuery.search) {
    const search = pushSqlParam(values, `%${listQuery.search}%`);
    where.push(`(
      l."firstName" ilike ${search}
      or l."lastName" ilike ${search}
      or l.email ilike ${search}
      or b.name ilike ${search}
      or b.category ilike ${search}
    )`);
  }

  const limit = options.includePagination ? pushSqlParam(values, listQuery.pageSize) : null;
  const offset = options.includePagination ? pushSqlParam(values, (listQuery.page - 1) * listQuery.pageSize) : null;
  const scoreDirection = listQuery.sortBy === 'score_asc' ? 'asc' : 'desc';
  const orderBy = listQuery.sortBy === 'created_desc' || listQuery.sortBy === undefined
    ? 'l."createdAt" desc, l.id desc'
    : `${resolvedScoreSql} ${scoreDirection} nulls last, l."createdAt" desc, l.id desc`;

  return {
    text: `
      select l.id
      from "Lead" l
      left join businesses b on b.id = l."businessId"
      left join lateral (
        select sp."blendedScore"
          , sp."scoreBand"
        from "LeadScorePrediction" sp
        where ${latestScoreWhere.join(' and ')}
        order by sp."predictedAt" desc, sp."createdAt" desc, sp.id desc
        limit 1
      ) latest_score on true
      where ${where.join(' and ')}
      ${options.includePagination ? `order by ${orderBy} limit ${limit} offset ${offset}` : ''}
    `,
    values,
  };
}

function buildLeadCountSql(listQuery: ListLeadsQuery): { text: string; values: readonly unknown[] } {
  const { text, values } = buildLeadIdsSql(listQuery, { includePagination: false });
  return {
    text: `select count(*)::integer as total from (${text}) lead_count`,
    values,
  };
}

async function listResolvedScoreLeadIds(listQuery: ListLeadsQuery): Promise<string[]> {
  const { text, values } = buildLeadIdsSql(listQuery);
  const result = await query<{ id: string }>(text, values);
  return result.rows.map((row) => row.id);
}

async function countResolvedScoreLeads(listQuery: ListLeadsQuery): Promise<number> {
  const { text, values } = buildLeadCountSql(listQuery);
  const result = await query<{ total: number }>(text, values);
  return result.rows[0]?.total ?? 0;
}

function isPrismaKnownRequestError(error: unknown): error is { code: string } {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && typeof error.code === 'string'
  );
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

const leadDetailBusinessContactSelect = {
  id: true,
  name: true,
  title: true,
  email: true,
  phone: true,
  linkedinUrl: true,
  seniority: true,
  positionRank: true,
  source: true,
} satisfies Prisma.BusinessContactSelect;

const leadDetailBusinessSelect = {
  id: true,
  name: true,
  countryCode: true,
  country: true,
  city: true,
  category: true,
  rating: true,
  reviewCount: true,
  followerCount: true,
  deterministicScore: true,
  scoreBand: true,
  websiteDomain: true,
  phoneE164: true,
  instagramHandle: true,
  hasWhatsapp: true,
  hasInstagram: true,
  acceptsOnlinePayments: true,
  recentActivity: true,
  preQualified: true,
  disqualificationReason: true,
  apifyWebsiteScrapeJson: true,
  apifyInstagramScrapeJson: true,
  websiteScrapedAt: true,
  instagramScrapedAt: true,
  contacts: {
    orderBy: [{ positionRank: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }],
    select: leadDetailBusinessContactSelect,
  },
} satisfies Prisma.BusinessSelect;

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
  await boss.createQueue('model.train');
  await boss.createQueue('reply.classify');
  await boss.createQueue('discovery.seed');
  await boss.createQueue('discovery.run_search_task');
  await boss.createQueue('hunter.enrich');

  const enqueueReplyClassify = async (payload: ReplyClassifyJobPayload): Promise<void> => {
    await boss.send('reply.classify', payload, {
      retryLimit: 3,
      retryDelay: 60,
      retryBackoff: true,
      deadLetter: 'reply.classify.dead_letter',
    });
  };

  const enqueueHunterEnrich = async (payload: HunterEnrichQueuePayload): Promise<void> => {
    await boss.send('hunter.enrich', payload, {
      singletonKey: `hunter.enrich:${payload.leadId}`,
      retryLimit: 2,
      retryDelay: 60,
      retryBackoff: true,
      deadLetter: 'hunter.enrich.dead_letter',
    });
  };

  const publishFeaturesCompute = async (input: {
    leadId: string;
    icpProfileId: string;
    jobId: string;
    outboxEventId: string;
  }): Promise<void> => {
    const markTrackedFeaturesComputeRunning = async (): Promise<void> => {
      await prisma.jobExecution.updateMany({
        where: {
          id: input.jobId,
          type: 'features.compute',
          status: 'queued',
        },
        data: {
          status: 'running',
          startedAt: new Date(),
          error: null,
        },
      });
    };

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

      return;
    }

    try {
      await markTrackedFeaturesComputeRunning();
    } catch (error: unknown) {
      logger.error(
        { error, leadId: input.leadId, jobId: input.jobId, outboxEventId: input.outboxEventId },
        'Immediate features.compute publish succeeded but failed to mark the tracked run as running',
      );

      return;
    }

    try {
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
      logger.error(
        { error, leadId: input.leadId, jobId: input.jobId, outboxEventId: input.outboxEventId },
        'Immediate features.compute publish succeeded but failed to mark outbox event as sent',
      );
    }
  };

  const publishScoringCompute = async (payload: ScoringRunJobPayload): Promise<void> => {
    const { outboxEventId, ...bossPayload } = payload;
    if (!outboxEventId) {
      logger.error(
        { runId: payload.runId },
        'Missing outbox event id for scoring.compute immediate publish',
      );
      return;
    }

    try {
      await boss.send('scoring.compute', bossPayload, {
        singletonKey: `scoring.compute:${payload.runId}`,
        retryLimit: 3,
        retryDelay: 30,
        retryBackoff: true,
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to enqueue scoring.compute job';
      logger.error(
        { error, runId: payload.runId, outboxEventId },
        'Immediate queue publish failed; outbox retry will handle dispatch',
      );

      try {
        await prisma.outboxEvent.update({
          where: { id: outboxEventId },
          data: {
            status: 'failed',
            attempts: {
              increment: 1,
            },
            lastError: errorMessage,
            nextAttemptAt: new Date(Date.now() + 5000),
          },
        });
      } catch (updateError: unknown) {
        logger.error(
          { error: updateError, runId: payload.runId, outboxEventId },
          'Failed to mark scoring outbox event for retry after publish failure',
        );
      }

      return;
    }

    try {
      await prisma.jobExecution.updateMany({
        where: {
          id: payload.runId,
          type: 'scoring.compute',
          status: 'queued',
        },
        data: {
          status: 'running',
          startedAt: new Date(),
          error: null,
        },
      });
    } catch (error: unknown) {
      logger.error(
        { error, runId: payload.runId, outboxEventId },
        'Immediate scoring publish succeeded but failed to mark the root scoring run as running',
      );

      return;
    }

    try {
      await prisma.outboxEvent.update({
        where: { id: outboxEventId },
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
      logger.error(
        { error, runId: payload.runId, outboxEventId },
        'Immediate scoring publish succeeded but failed to mark outbox event as sent',
      );
    }
  };

  const publishMessageSend = async (payload: MessagingSendJobPayload): Promise<void> => {
    try {
      await prisma.messageSend.updateMany({
        where: {
          id: payload.sendId,
          status: 'QUEUED',
        },
        data: {
          status: 'FAILED',
          failureCode: OUTBOUND_DISABLED_FAILURE_CODE,
          failureReason: OUTBOUND_DISABLED_FAILURE_REASON,
        },
      });
    } catch (error: unknown) {
      logger.error(
        { error, sendId: payload.sendId },
        'Failed to mark MessageSend failed after blocking outbound publish',
      );
    }

    if (payload.outboxEventId) {
      try {
        await prisma.outboxEvent.update({
          where: { id: payload.outboxEventId },
          data: {
            status: 'sent',
            attempts: {
              increment: 1,
            },
            processedAt: new Date(),
            nextAttemptAt: null,
            lastError: 'Skipped publish because outbound sending is disabled for the Leadzilla demo',
          },
        });
      } catch (updateError: unknown) {
        logger.error(
          { error: updateError, sendId: payload.sendId, outboxEventId: payload.outboxEventId },
          'Failed to mark message.send outbox event as skipped after blocking outbound publish',
        );
      }
    }

    logger.warn(
      { sendId: payload.sendId, outboxEventId: payload.outboxEventId },
      'Skipped message.send publish because outbound sending is disabled for the Leadzilla demo',
    );
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

  const triggerDiscoveryTaskRun = buildTriggerDiscoveryTaskRun(boss);

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
        const activeIcp = input.icpProfileId
          ? null
          : await prisma.icpProfile.findFirst({
              where: { isActive: true },
              select: { id: true },
              orderBy: { createdAt: 'asc' },
            });
        const icpProfileId = input.icpProfileId ?? activeIcp?.id;
        if (!icpProfileId) {
          throw new LeadContextUnavailableError(
            'Lead creation requires an active ICP profile or an explicit icpProfileId',
          );
        }

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
          icpProfileId,
          jobId: jobExecution.id,
          outboxEventId: outboxEvent.id,
        });

        return {
          leadId: lead.id,
          jobId: jobExecution.id,
        };
      } catch (error: unknown) {
        if (isPrismaKnownRequestError(error) && error.code === 'P2002') {
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
        if (isPrismaKnownRequestError(error) && error.code === 'P2002') {
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
      await publishScoringCompute(payload);
    },
    enqueueModelTrain: async (payload: LearningModelTrainJobPayload) => {
      await boss.send('model.train', payload, {
        singletonKey: `model.train:${payload.trainingRunId}`,
        retryLimit: 1,
        retryDelay: 300,
        retryBackoff: true,
        deadLetter: 'model.train.dead_letter',
      });
    },
    enqueueMessageSend: async (payload: MessagingSendJobPayload) => {
      await publishMessageSend(payload);
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
    enqueueHunterEnrich,
    fetchResendReceivedEmail: buildResendReceivedEmailFetcher(env.RESEND_API_KEY),
    trengoWebhookSecret: env.TRENGO_WEBHOOK_SECRET,
    resendWebhookSecret: env.RESEND_WEBHOOK_SECRET,
    triggerDiscoverySeedJob,
    triggerDiscoveryTaskRun,
    ...(env.ADMIN_API_KEY ? { adminApiKey: env.ADMIN_API_KEY } : {}),
    getLeadById: async (leadId) => {
      const lead = await prisma.lead.findUnique({
        where: { id: leadId, deletedAt: null },
        include: {
          discoveryRecords: {
            orderBy: [{ discoveredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
            take: 1,
            select: { icpProfileId: true },
          },
          enrichmentRecords: {
            orderBy: [{ enrichedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
            take: 1,
            select: { normalizedPayload: true },
          },
          scorePredictions: {
            orderBy: [{ predictedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
            take: 1,
            select: { icpProfileId: true },
          },
          businessConversions: {
            take: 1,
            orderBy: [{ convertedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
            select: {
              icpProfileId: true,
              businessInsights: true,
              metadata: true,
              business: {
                select: leadDetailBusinessSelect,
              },
            },
          },
          business: {
            select: leadDetailBusinessSelect,
          },
        },
      });
      if (!lead) return null;
      const latestConversion = lead.businessConversions[0] ?? null;
      const biz = lead.business ?? latestConversion?.business;
      const latestIcpProfileId =
        lead.discoveryRecords[0]?.icpProfileId
        ?? lead.scorePredictions[0]?.icpProfileId
        ?? latestConversion?.icpProfileId
        ?? null;
      const icpProfile = latestIcpProfileId
        ? await prisma.icpProfile.findUnique({
            where: { id: latestIcpProfileId },
            select: { name: true },
          })
        : null;
      const conversionMetadata =
        latestConversion?.metadata && typeof latestConversion.metadata === 'object' && !Array.isArray(latestConversion.metadata)
          ? latestConversion.metadata as Record<string, unknown>
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
        businessDeterministicScore: biz?.deterministicScore ?? null,
        businessScoreBand: biz?.scoreBand ?? null,
        latestIcpProfileId,
        businessId: biz?.id ?? lead.businessId ?? null,
        websiteDomain: biz?.websiteDomain ?? null,
        icpProfileName: icpProfile?.name ?? null,
        businessContacts: biz?.contacts.map((contact) => ({
          id: contact.id,
          name: contact.name,
          title: contact.title,
          email: contact.email,
          phone: contact.phone,
          linkedinUrl: contact.linkedinUrl,
          seniority: contact.seniority,
          positionRank: contact.positionRank,
          source: contact.source,
        })) ?? [],
        businessProfileRaw: biz ?? null,
        conversionContext: {
          businessInsights: latestConversion?.businessInsights ?? null,
          metadata: latestConversion?.metadata ?? null,
        },
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
              OR: [
                {
                  scorePredictions: {
                    some: {
                      ...(query.icpProfileId ? { icpProfileId: query.icpProfileId } : {}),
                      ...(query.scoreBand ? { scoreBand: query.scoreBand } : {}),
                      ...(query.minBlendedScore !== undefined ? { blendedScore: { gte: query.minBlendedScore } } : {}),
                    },
                  },
                },
                {
                  business: {
                    ...(query.scoreBand ? { scoreBand: query.scoreBand } : {}),
                    ...(query.minBlendedScore !== undefined ? { deterministicScore: { gte: query.minBlendedScore } } : {}),
                  },
                },
              ],
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

      const leadInclude = {
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
        _count: {
          select: {
            enrichmentRecords: {
              where: { provider: 'HUNTER' },
            },
            jobs: {
              where: { type: 'hunter.enrich' },
            },
          },
        },
        scorePredictions: {
          ...(query.icpProfileId ? { where: { icpProfileId: query.icpProfileId } } : {}),
          orderBy: [{ predictedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
        },
        business: {
          select: {
            countryCode: true,
            country: true,
            city: true,
            category: true,
            name: true,
            deterministicScore: true,
            scoreBand: true,
          },
        },
      } satisfies Prisma.LeadInclude;
      type LeadListRow = Prisma.LeadGetPayload<{ include: typeof leadInclude }>;

      let total: number;
      let rows: LeadListRow[];
      const sortBy = query.sortBy ?? 'created_desc';
      const shouldUseResolvedScoreQuery =
        sortBy === 'score_desc'
        || sortBy === 'score_asc'
        || query.scoreBand !== undefined
        || query.minBlendedScore !== undefined;

      if (shouldUseResolvedScoreQuery) {
        const [totalCount, orderedIds] = await Promise.all([
          countResolvedScoreLeads(query),
          listResolvedScoreLeadIds(query),
        ]);

        total = totalCount;
        if (orderedIds.length === 0) {
          rows = [];
        } else {
          const unorderedRows = await prisma.lead.findMany({
            where: { id: { in: orderedIds } },
            include: leadInclude,
          });
          const rowsById = new Map(unorderedRows.map((row) => [row.id, row]));
          rows = orderedIds
            .map((id) => rowsById.get(id))
            .filter((row): row is LeadListRow => row !== undefined);
        }
      } else {
        [total, rows] = await Promise.all([
          prisma.lead.count({ where }),
          prisma.lead.findMany({
            where,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
            include: leadInclude,
          }),
        ]);
      }

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
          const legacyScore = readLegacyScoreInfo(scoreInfoFallback);
          const displayScore = resolveDisplayScore({
            latestScore: lead.scorePredictions[0] ?? null,
            legacyScore: legacyScore.score,
            legacyBand: legacyScore.band,
            businessScore: lead.business?.deterministicScore ?? null,
            businessBand: lead.business?.scoreBand ?? null,
          });

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
              ?? legacyScore.band,
            latestBlendedScore: lead.scorePredictions[0]?.blendedScore
              ?? legacyScore.score,
            latestScorePredictionId: lead.scorePredictions[0]?.id ?? null,
            displayScore: displayScore.score,
            displayScoreBand: displayScore.band,
            displayScoreSource: displayScore.source,
            latestDiscoveryRawPayload: lead.discoveryRecords[0]?.rawPayload ?? null,
            latestEnrichmentNormalizedPayload: lead.enrichmentRecords[0]?.normalizedPayload ?? enrichmentFallback ?? null,
            latestEnrichmentRawPayload: lead.enrichmentRecords[0]?.rawPayload ?? null,
            businessCountryCode: lead.business?.countryCode ?? null,
            businessCountry: lead.business?.country ?? null,
            businessCity: lead.business?.city ?? null,
            businessCategory: lead.business?.category ?? null,
            businessDeterministicScore: lead.business?.deterministicScore ?? null,
            businessScoreBand: lead.business?.scoreBand ?? null,
            businessName: lead.business?.name ?? null,
            decisionMakerTitle: lead.decisionMakerTitle ?? null,
            hunterEnrichmentUsed:
              lead._count.enrichmentRecords > 0
              || lead._count.jobs > 0,
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
