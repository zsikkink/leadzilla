import { promises as dns } from 'node:dns';

import Fastify, { type FastifyBaseLogger, type FastifyInstance, type FastifyPluginAsync } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  ContactRecoveryDetailResponseSchema,
  ContactRecoveryIdParamsSchema,
  CreateLeadRequestSchema,
  CreateLeadResponseSchema,
  ErrorResponseSchema,
  GetJobStatusResponseSchema,
  GetLeadResponseSchema,
  HealthResponseSchema,
  LeadRejectionResponseSchema,
  ListContactRecoveryItemsQuerySchema,
  ListContactRecoveryItemsResponseSchema,
  ListLeadsQuerySchema,
  ListLeadsResponseSchema,
  ListRejectedLeadsQuerySchema,
  ListRejectedLeadsResponseSchema,
  RejectContactRecoveryRequestSchema,
  RejectLeadRequestSchema,
  type RunDiscoverySeedRequest,
  type RunDiscoveryTasksRequest,
  type TriggerJobRunResponse,
  type ContactRecoveryDetailResponse,
  type ListContactRecoveryItemsQuery,
  type ListContactRecoveryItemsResponse,
  type CreateLeadRequest,
  type ListLeadsQuery,
  type ListLeadsResponse,
  type LoginRequest,
  type LoginResponse,
  type JobStatus,
  type LeadStatus,
  type ReplyClassifyJobPayload,
  ReadyResponseSchema,
  type ReadySchemaHealth,
} from '@lead-flood/contracts';
import { getScoreQualificationThresholdSetting, prisma } from '@lead-flood/db';

import { buildAuthGuard, type AuthGuardOptions, type VerifyAccessToken } from './auth/guard.js';
import type { ApiEnv } from './env.js';
import { registerAnalyticsRoutes } from './modules/analytics/analytics.routes.js';
import type { AnalyticsRollupJobPayload } from './modules/analytics/analytics.service.js';
import { registerDiscoveryRoutes } from './modules/discovery/discovery.routes.js';
import { registerDiscoveryAdminRoutes } from './modules/discovery-admin/discovery-admin.routes.js';
import type { DiscoveryRunJobPayload } from './modules/discovery/discovery.service.js';
import { registerEnrichmentRoutes } from './modules/enrichment/enrichment.routes.js';
import { registerFeedbackRoutes } from './modules/feedback/feedback.routes.js';
import { registerIcpRoutes } from './modules/icp/icp.routes.js';
import { registerLearningRoutes } from './modules/learning/learning.routes.js';
import { registerMessagingRoutes, type MessagingRouteDependencies } from './modules/messaging/messaging.routes.js';
import type { MessageGenerateJobPayload, MessagingSendJobPayload } from './modules/messaging/messaging.service.js';
import { registerScoringRoutes } from './modules/scoring/scoring.routes.js';
import type { ScoringRunJobPayload } from './modules/scoring/scoring.service.js';
import { registerSettingsRoutes } from './modules/settings/settings.routes.js';
import { registerStatsRoutes } from './modules/stats/stats.routes.js';
import { registerWebhookRoutes } from './modules/webhook/webhook.routes.js';

// ── Email normalization (API can't import @lead-flood/providers) ──

const SIMPLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeLeadEmail(raw: string): string {
  let email: string;
  try {
    email = decodeURIComponent(raw);
  } catch {
    email = raw;
  }
  email = email.trim().replace(/\s+/g, '');
  if (SIMPLE_EMAIL_RE.test(email)) return email;
  // If still invalid after normalization, return a safe fallback
  return email.includes('@') ? email : 'unknown@lead.local';
}

// ── Generic email filter (inline — API can't import @lead-flood/providers) ──
const GENERIC_PREFIXES = new Set([
  'info', 'contact', 'hello', 'support', 'admin', 'sales', 'office',
  'help', 'service', 'enquiry', 'inquiry', 'inquiries', 'general', 'team',
  'mail', 'noreply', 'no-reply', 'webmaster', 'postmaster', 'marketing',
  'hr', 'finance', 'billing', 'accounts', 'reception', 'feedback',
  'appointments', 'events', 'press', 'media', 'partnerships',
  'careers', 'jobs', 'recruitment', 'booking', 'bookings', 'reservations',
]);

function isGenericEmail(email: string): boolean {
  const prefix = email.split('@')[0]?.toLowerCase();
  if (!prefix) return true;
  return GENERIC_PREFIXES.has(prefix);
}

// ── Email deliverability gate (inline — API can't import @lead-flood/providers) ──
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'yopmail.com', 'tempmail.com',
  'throwaway.email', 'guerrillamail.de', 'dispostable.com', 'temp-mail.org',
  'fakeinbox.com', 'sharklasers.com', 'guerrillamailblock.com',
  'grr.la', 'mailnesia.com', 'trashmail.com', 'maildrop.cc',
  'mailnator.com', 'guerrillamail.net', 'guerrillamail.org',
  'tempail.com', 'throwaway.com', 'getnada.com', 'mohmal.com',
  'tempr.email', 'discard.email', 'mailsac.com', 'harakirimail.com',
  'mytemp.email', 'emailondeck.com', 'tempinbox.com',
]);

export async function isEmailDeliverable(
  email: string,
): Promise<{ ok: boolean; reason?: string | undefined }> {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return { ok: false, reason: 'INVALID_FORMAT' };

  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { ok: false, reason: 'DISPOSABLE_DOMAIN' };
  }

  try {
    const mx = await dns.resolveMx(domain);
    if (!mx || mx.length === 0) {
      return { ok: false, reason: 'NO_MX_RECORDS' };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'DNS_LOOKUP_FAILED' };
  }
}

export class LeadAlreadyExistsError extends Error {
  constructor(message = 'Lead already exists') {
    super(message);
    this.name = 'LeadAlreadyExistsError';
  }
}

export interface LeadRecord {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  source: string;
  status: LeadStatus;
  enrichmentData: unknown | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  businessCountryCode?: string | null | undefined;
  businessCountry?: string | null | undefined;
  businessCity?: string | null | undefined;
  businessCategory?: string | null | undefined;
  contactDiscovery?: unknown | null | undefined;
}

export interface JobRecord {
  id: string;
  type: string;
  status: JobStatus;
  attempts: number;
  leadId: string | null;
  result: unknown | null;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  updatedAt: Date;
}

export interface BuildServerOptions {
  env: ApiEnv;
  logger: FastifyBaseLogger;
  verifyAccessToken?: VerifyAccessToken | undefined;
  checkDatabaseHealth: () => Promise<boolean>;
  checkSchemaHealth: () => Promise<ReadySchemaHealth>;
  checkEmailDeliverability?: ((email: string) => Promise<{ ok: boolean; reason?: string | undefined }>) | undefined;
  authenticateUser?: ((input: LoginRequest) => Promise<LoginResponse | null>) | undefined;
  createLeadAndEnqueue: (input: CreateLeadRequest) => Promise<{ leadId: string; jobId: string }>;
  enqueueDiscoveryRun?: (payload: DiscoveryRunJobPayload) => Promise<void>;
  enqueueScoringRun?: (payload: ScoringRunJobPayload) => Promise<void>;
  enqueueMessageSend?: (payload: MessagingSendJobPayload) => Promise<void>;
  enqueueMessageGenerate?: ((payload: MessageGenerateJobPayload) => Promise<void>) | undefined;
  enqueueAnalyticsRollup?: ((payload: AnalyticsRollupJobPayload) => Promise<void>) | undefined;
  enqueueReplyClassify?: ((payload: ReplyClassifyJobPayload) => Promise<void>) | undefined;
  trengoWebhookSecret?: string | undefined;
  resendWebhookSecret?: string | undefined;
  triggerDiscoverySeedJob?: ((input: RunDiscoverySeedRequest) => Promise<TriggerJobRunResponse>) | undefined;
  triggerDiscoveryTaskRun?: ((input: RunDiscoveryTasksRequest) => Promise<TriggerJobRunResponse>) | undefined;
  adminApiKey?: string | undefined;
  checkUserActive?: ((userId: string) => Promise<boolean>) | undefined;
  getLeadById: (leadId: string) => Promise<LeadRecord | null>;
  softDeleteLead?: ((leadId: string) => Promise<boolean>) | undefined;
  listLeads: (query: ListLeadsQuery) => Promise<ListLeadsResponse>;
  listContactRecoveryItems: (query: ListContactRecoveryItemsQuery) => Promise<ListContactRecoveryItemsResponse>;
  getContactRecoveryItem: (id: string) => Promise<ContactRecoveryDetailResponse | null>;
  rejectContactRecoveryItem: (input: {
    id: string;
    rejectedBy: string;
    reason?: string | undefined;
  }) => Promise<ContactRecoveryDetailResponse | null>;
  getJobById: (jobId: string) => Promise<JobRecord | null>;
}

export function buildServer(options: BuildServerOptions): FastifyInstance {
  const app = Fastify({
    logger: false,
    loggerInstance: options.logger,
    disableRequestLogging: false,
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
  });

  app.register(cors, {
    origin: options.env.CORS_ORIGIN,
    credentials: true,
  });

  app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    allowList: ['127.0.0.1'],
  });

  app.addHook('onSend', (request, reply, payload, done) => {
    reply.header('x-request-id', request.id);
    done(null, payload);
  });

  app.decorateRequest('user', null);
  const checkEmailDeliverability = options.checkEmailDeliverability ?? isEmailDeliverable;

  // Public routes - no auth required
  app.get('/health', async () => {
    return HealthResponseSchema.parse({ status: 'ok' });
  });

  app.get('/ready', async (_request, reply) => {
    const databaseReady = await options.checkDatabaseHealth();
    const schemaHealth = databaseReady
      ? await options.checkSchemaHealth()
      : { status: 'fail', missingTables: [], missingEnumValues: [] } satisfies ReadySchemaHealth;

    if (!databaseReady) {
      reply.status(503);
      return ReadyResponseSchema.parse({ status: 'not_ready', db: 'fail', schema: schemaHealth });
    }

    if (schemaHealth.status !== 'ok') {
      reply.status(503);
      return ReadyResponseSchema.parse({ status: 'not_ready', db: 'ok', schema: schemaHealth });
    }

    return ReadyResponseSchema.parse({ status: 'ready', db: 'ok', schema: schemaHealth });
  });

  app.post('/v1/auth/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    reply.status(410);
    return ErrorResponseSchema.parse({
      error:
        'Deprecated endpoint. Use Supabase Auth sign-in from the web client and send Supabase bearer token to API.',
      requestId: request.id,
    });
  });

  // Public webhook routes - no auth, signature-verified
  if (options.trengoWebhookSecret || options.resendWebhookSecret) {
    registerWebhookRoutes(app, {
      trengoWebhookSecret: options.trengoWebhookSecret,
      resendWebhookSecret: options.resendWebhookSecret,
      enqueueReplyClassify: options.enqueueReplyClassify,
    });
  }

  // Protected routes - JWT guard applied to all routes registered in this plugin
  if (!options.verifyAccessToken) {
    throw new Error('Missing verifyAccessToken configuration for protected API routes');
  }

  const verifyAccessToken = options.verifyAccessToken;

  const guardOptions: AuthGuardOptions = {};
  if (options.checkUserActive) {
    guardOptions.checkUserActive = options.checkUserActive;
  }
  const authGuard = buildAuthGuard(verifyAccessToken, guardOptions);

  const protectedRoutes: FastifyPluginAsync = async (api) => {
    api.addHook('onRequest', authGuard);

    api.post('/v1/leads', async (request, reply) => {
      const parsedRequest = CreateLeadRequestSchema.safeParse(request.body);

      if (!parsedRequest.success) {
        reply.status(400);
        return ErrorResponseSchema.parse({
          error: 'Invalid lead payload',
          requestId: request.id,
        });
      }

      // Reject generic emails (info@, contact@, etc.)
      if (isGenericEmail(parsedRequest.data.email)) {
        reply.status(400);
        return ErrorResponseSchema.parse({
          error: 'Generic email addresses (info@, contact@, etc.) are not accepted. Please provide a personal email.',
          requestId: request.id,
        });
      }

      // Check email deliverability (MX records + disposable domain)
      const deliverability = await checkEmailDeliverability(parsedRequest.data.email);
      if (!deliverability.ok) {
        reply.status(422);
        return ErrorResponseSchema.parse({
          error: `Undeliverable email: ${deliverability.reason}`,
          requestId: request.id,
        });
      }

      try {
        const created = await options.createLeadAndEnqueue(parsedRequest.data);
        reply.status(201);
        return CreateLeadResponseSchema.parse(created);
      } catch (error: unknown) {
        if (error instanceof LeadAlreadyExistsError) {
          reply.status(409);
          return ErrorResponseSchema.parse({
            error: error.message,
            requestId: request.id,
          });
        }

        throw error;
      }
    });

    api.get('/v1/leads', async (request, reply) => {
      const parsedQuery = ListLeadsQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        reply.status(400);
        return ErrorResponseSchema.parse({
          error: 'Invalid lead list query',
          requestId: request.id,
        });
      }

      try {
        const result = await options.listLeads(parsedQuery.data);
        const normalized = {
          ...result,
          items: result.items.map((item) => ({
            ...item,
            email: normalizeLeadEmail(item.email),
          })),
        };
        return ListLeadsResponseSchema.parse(normalized);
      } catch (error: unknown) {
        request.log.error({ error }, 'Failed to list leads');
        reply.status(500);
        return ErrorResponseSchema.parse({
          error: 'Failed to list leads',
          requestId: request.id,
        });
      }
    });

    api.get('/v1/leads/:id', async (request, reply) => {
      const parsedParams = z.object({ id: z.string().min(1) }).safeParse(request.params);
      if (!parsedParams.success) {
        reply.status(400);
        return ErrorResponseSchema.parse({
          error: 'Invalid lead id',
          requestId: request.id,
        });
      }
      const leadId = parsedParams.data.id;

      const lead = await options.getLeadById(leadId);

      if (!lead) {
        reply.status(404);
        return ErrorResponseSchema.parse({
          error: 'Lead not found',
          requestId: request.id,
        });
      }

      return GetLeadResponseSchema.parse({
        ...lead,
        email: normalizeLeadEmail(lead.email),
        createdAt: lead.createdAt.toISOString(),
        updatedAt: lead.updatedAt.toISOString(),
        businessCountryCode: lead.businessCountryCode ?? null,
        businessCountry: lead.businessCountry ?? null,
        businessCity: lead.businessCity ?? null,
        businessCategory: lead.businessCategory ?? null,
        contactDiscovery: lead.contactDiscovery ?? null,
      });
    });

    api.get('/v1/leads/recovery', async (request, reply) => {
      const parsedQuery = ListContactRecoveryItemsQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        reply.status(400);
        return ErrorResponseSchema.parse({
          error: 'Invalid contact recovery query',
          requestId: request.id,
        });
      }

      try {
        const result = await options.listContactRecoveryItems(parsedQuery.data);
        return ListContactRecoveryItemsResponseSchema.parse(result);
      } catch (error: unknown) {
        request.log.error({ error }, 'Failed to list contact recovery items');
        reply.status(500);
        return ErrorResponseSchema.parse({
          error: 'Failed to list contact recovery items',
          requestId: request.id,
        });
      }
    });

    api.get('/v1/leads/recovery/:id', async (request, reply) => {
      const parsedParams = ContactRecoveryIdParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        reply.status(400);
        return ErrorResponseSchema.parse({
          error: 'Invalid contact recovery id',
          requestId: request.id,
        });
      }

      const item = await options.getContactRecoveryItem(parsedParams.data.id);
      if (!item) {
        reply.status(404);
        return ErrorResponseSchema.parse({
          error: 'Contact recovery item not found',
          requestId: request.id,
        });
      }

      return ContactRecoveryDetailResponseSchema.parse(item);
    });

    api.delete('/v1/leads/:id', async (request, reply) => {
      const parsedParams = z.object({ id: z.string().min(1) }).safeParse(request.params);
      if (!parsedParams.success) {
        reply.status(400);
        return ErrorResponseSchema.parse({
          error: 'Invalid lead id',
          requestId: request.id,
        });
      }
      const leadId = parsedParams.data.id;

      if (!options.softDeleteLead) {
        reply.status(501);
        return ErrorResponseSchema.parse({
          error: 'Lead deletion not implemented',
          requestId: request.id,
        });
      }

      const deleted = await options.softDeleteLead(leadId);

      if (!deleted) {
        reply.status(404);
        return ErrorResponseSchema.parse({
          error: 'Lead not found',
          requestId: request.id,
        });
      }

      reply.status(204);
      return;
    });

    api.patch('/v1/leads/:id/reject', async (request, reply) => {
      const parsedParams = z.object({ id: z.string().min(1) }).safeParse(request.params);
      if (!parsedParams.success) {
        reply.status(400);
        return ErrorResponseSchema.parse({ error: 'Invalid lead id', requestId: request.id });
      }
      const parsedBody = RejectLeadRequestSchema.safeParse(request.body);
      if (!parsedBody.success) {
        reply.status(400);
        return ErrorResponseSchema.parse({ error: 'Invalid rejection payload', requestId: request.id });
      }

      const leadId = parsedParams.data.id;
      const userId = request.user?.sub;
      if (!userId) {
        reply.status(401);
        return ErrorResponseSchema.parse({ error: 'Authentication required', requestId: request.id });
      }

      const lead = await prisma.lead.findFirst({
        where: { id: leadId, deletedAt: null },
        select: { id: true, businessId: true },
      });
      if (!lead) {
        reply.status(404);
        return ErrorResponseSchema.parse({ error: 'Lead not found', requestId: request.id });
      }

      // Get latest blended score for the rejection record
      const latestScore = await prisma.leadScorePrediction.findFirst({
        where: { leadId },
        orderBy: [{ predictedAt: 'desc' }, { createdAt: 'desc' }],
        select: { blendedScore: true },
      });

      const metadataValue = parsedBody.data.metadata
        ? JSON.parse(JSON.stringify(parsedBody.data.metadata)) as Prisma.InputJsonValue
        : Prisma.JsonNull;

      const [rejection] = await prisma.$transaction([
        prisma.leadRejection.upsert({
          where: { leadId },
          create: {
            leadId,
            reason: parsedBody.data.reason,
            rejectedBy: userId,
            score: latestScore?.blendedScore ?? null,
            metadata: metadataValue,
            businessId: lead.businessId ?? null,
          },
          update: {
            reason: parsedBody.data.reason,
            rejectedBy: userId,
            score: latestScore?.blendedScore ?? null,
            metadata: metadataValue,
            rejectedAt: new Date(),
          },
        }),
        prisma.lead.update({
          where: { id: leadId },
          data: { status: 'rejected' },
        }),
      ]);

      reply.status(200);
      return LeadRejectionResponseSchema.parse({
        id: rejection.id,
        leadId: rejection.leadId,
        reason: rejection.reason,
        rejectedBy: rejection.rejectedBy,
        rejectedAt: rejection.rejectedAt.toISOString(),
        score: rejection.score,
        metadata: rejection.metadata as Record<string, unknown> | null,
      });
    });

    api.patch('/v1/leads/recovery/:id/reject', async (request, reply) => {
      const parsedParams = ContactRecoveryIdParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        reply.status(400);
        return ErrorResponseSchema.parse({ error: 'Invalid contact recovery id', requestId: request.id });
      }

      const parsedBody = RejectContactRecoveryRequestSchema.safeParse(request.body ?? {});
      if (!parsedBody.success) {
        reply.status(400);
        return ErrorResponseSchema.parse({ error: 'Invalid contact recovery rejection payload', requestId: request.id });
      }

      const rejectedBy = request.user?.sub;
      if (!rejectedBy) {
        reply.status(401);
        return ErrorResponseSchema.parse({ error: 'Authentication required', requestId: request.id });
      }

      const result = await options.rejectContactRecoveryItem({
        id: parsedParams.data.id,
        rejectedBy,
        reason: parsedBody.data.reason,
      });

      if (!result) {
        reply.status(404);
        return ErrorResponseSchema.parse({ error: 'Contact recovery item not found', requestId: request.id });
      }

      return ContactRecoveryDetailResponseSchema.parse(result);
    });

    api.patch('/v1/leads/:id/unreject', async (request, reply) => {
      const parsedParams = z.object({ id: z.string().min(1) }).safeParse(request.params);
      if (!parsedParams.success) {
        reply.status(400);
        return ErrorResponseSchema.parse({ error: 'Invalid lead id', requestId: request.id });
      }

      const leadId = parsedParams.data.id;
      const lead = await prisma.lead.findFirst({ where: { id: leadId, deletedAt: null } });
      if (!lead) {
        reply.status(404);
        return ErrorResponseSchema.parse({ error: 'Lead not found', requestId: request.id });
      }

      // Determine what status to restore.
      // Restore to `qualified` when the latest score still passes threshold,
      // otherwise restore to `scored`; if no score exists, restore to `new`.
      const latestScore = await prisma.leadScorePrediction.findFirst({
        where: { leadId },
        orderBy: [{ predictedAt: 'desc' }, { createdAt: 'desc' }],
        select: { blendedScore: true },
      });

      const qualificationThreshold = await getScoreQualificationThresholdSetting(0.5);

      const restoredStatus: LeadStatus = latestScore
        ? (latestScore.blendedScore >= qualificationThreshold ? 'qualified' : 'scored')
        : 'new';

      await prisma.$transaction([
        prisma.leadRejection.deleteMany({ where: { leadId } }),
        prisma.lead.update({ where: { id: leadId }, data: { status: restoredStatus } }),
      ]);

      reply.status(204);
      return;
    });

    api.get('/v1/leads/rejected', async (request, reply) => {
      const parsedQuery = ListRejectedLeadsQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        reply.status(400);
        return ErrorResponseSchema.parse({
          error: 'Invalid rejected leads query',
          requestId: request.id,
        });
      }

      const where: Prisma.LeadRejectionWhereInput = {
        ...(parsedQuery.data.reason ? { reason: parsedQuery.data.reason } : {}),
      };

      const [total, rows] = await Promise.all([
        prisma.leadRejection.count({ where }),
        prisma.leadRejection.findMany({
          where,
          orderBy: [{ rejectedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
          skip: (parsedQuery.data.page - 1) * parsedQuery.data.pageSize,
          take: parsedQuery.data.pageSize,
          include: {
            lead: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                enrichmentData: true,
                business: {
                  select: {
                    name: true,
                    websiteDomain: true,
                    category: true,
                    city: true,
                    countryCode: true,
                  },
                },
              },
            },
          },
        }),
      ]);

      const icpIds = Array.from(new Set(rows.map((row) => row.icpProfileId).filter(Boolean))) as string[];
      const icps = icpIds.length > 0
        ? await prisma.icpProfile.findMany({
            where: { id: { in: icpIds } },
            select: { id: true, name: true },
          })
        : [];
      const icpNameMap = new Map(icps.map((icp) => [icp.id, icp.name]));

      return ListRejectedLeadsResponseSchema.parse({
        items: rows.map((row) => {
          const enrichment =
            row.lead.enrichmentData && typeof row.lead.enrichmentData === 'object' && !Array.isArray(row.lead.enrichmentData)
              ? row.lead.enrichmentData as Record<string, unknown>
              : null;
          const metadata =
            row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
              ? row.metadata as Record<string, unknown>
              : null;
          const reasonDetails = Array.isArray(metadata?.failedHardFilters)
            ? metadata.failedHardFilters.filter((value): value is string => typeof value === 'string')
            : [];

          return {
            id: row.id,
            leadId: row.leadId,
            firstName: row.lead.firstName,
            lastName: row.lead.lastName,
            email: row.lead.email,
            companyName:
              (typeof enrichment?.companyName === 'string' ? enrichment.companyName : null)
              ?? (typeof enrichment?.company_name === 'string' ? enrichment.company_name : null)
              ?? row.lead.business?.name
              ?? null,
            businessName: row.lead.business?.name ?? null,
            websiteDomain: row.lead.business?.websiteDomain ?? null,
            category: row.lead.business?.category ?? null,
            city: row.lead.business?.city ?? null,
            country: row.lead.business?.countryCode ?? null,
            icpProfileId: row.icpProfileId ?? null,
            icpProfileName: row.icpProfileId ? (icpNameMap.get(row.icpProfileId) ?? null) : null,
            reason: row.reason,
            reasonDetails,
            score: row.score ?? null,
            rejectedAt: row.rejectedAt.toISOString(),
          };
        }),
        page: parsedQuery.data.page,
        pageSize: parsedQuery.data.pageSize,
        total,
      });
    });

    api.get('/v1/jobs/:id', async (request, reply) => {
      const parsedParams = z.object({ id: z.string().min(1) }).safeParse(request.params);
      if (!parsedParams.success) {
        reply.status(400);
        return ErrorResponseSchema.parse({
          error: 'Invalid job id',
          requestId: request.id,
        });
      }
      const jobId = parsedParams.data.id;

      const job = await options.getJobById(jobId);

      if (!job) {
        reply.status(404);
        return ErrorResponseSchema.parse({
          error: 'Job not found',
          requestId: request.id,
        });
      }

      return GetJobStatusResponseSchema.parse({
        ...job,
        createdAt: job.createdAt.toISOString(),
        startedAt: job.startedAt?.toISOString() ?? null,
        finishedAt: job.finishedAt?.toISOString() ?? null,
        updatedAt: job.updatedAt.toISOString(),
      });
    });

    registerIcpRoutes(api, {
      ...(options.adminApiKey ? { adminApiKey: options.adminApiKey } : {}),
    });
    if (options.enqueueDiscoveryRun) {
      registerDiscoveryRoutes(api, {
        enqueueDiscoveryRun: options.enqueueDiscoveryRun,
      });
    } else {
      registerDiscoveryRoutes(api);
    }
    registerEnrichmentRoutes(api);
    if (options.enqueueScoringRun) {
      registerScoringRoutes(api, { enqueueScoringRun: options.enqueueScoringRun });
    } else {
      registerScoringRoutes(api);
    }
    const messagingDeps: MessagingRouteDependencies = {};
    if (options.enqueueMessageSend) {
      messagingDeps.enqueueMessageSend = options.enqueueMessageSend;
    }
    if (options.enqueueMessageGenerate) {
      messagingDeps.enqueueMessageGenerate = options.enqueueMessageGenerate;
    }
    if (messagingDeps.enqueueMessageSend || messagingDeps.enqueueMessageGenerate) {
      registerMessagingRoutes(api, messagingDeps);
    } else {
      registerMessagingRoutes(api);
    }
    registerLearningRoutes(api);
    registerFeedbackRoutes(api);
    if (options.enqueueAnalyticsRollup) {
      registerAnalyticsRoutes(api, {
        enqueueAnalyticsRollup: options.enqueueAnalyticsRollup,
        adminApiKey: options.adminApiKey,
      });
    } else {
      registerAnalyticsRoutes(api, { adminApiKey: options.adminApiKey });
    }
    registerDiscoveryAdminRoutes(api, {
      ...(options.adminApiKey ? { adminApiKey: options.adminApiKey } : {}),
      ...(options.triggerDiscoverySeedJob
        ? { triggerDiscoverySeedJob: options.triggerDiscoverySeedJob }
        : {}),
      ...(options.triggerDiscoveryTaskRun
        ? { triggerDiscoveryTaskRun: options.triggerDiscoveryTaskRun }
        : {}),
    });
    registerSettingsRoutes(api);
    registerStatsRoutes(api);
  };

  app.register(protectedRoutes);

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send(
      ErrorResponseSchema.parse({
        error: 'Route not found',
        requestId: request.id,
      }),
    );
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'Unhandled API error');

    if (!reply.sent) {
      reply.status(500).send(
        ErrorResponseSchema.parse({
          error: 'Internal server error',
          requestId: request.id,
        }),
      );
    }
  });

  return app;
}
