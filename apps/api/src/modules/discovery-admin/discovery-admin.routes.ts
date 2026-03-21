import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  AdminLeadDetailResponseSchema,
  AdminLeadIdParamsSchema,
  AdminListLeadsQuerySchema,
  AdminListLeadsResponseSchema,
  AdminListSearchTasksQuerySchema,
  AdminListSearchTasksResponseSchema,
  AdminSearchTaskDetailResponseSchema,
  AdminSearchTaskIdParamsSchema,
  ErrorResponseSchema,
  JobRunDetailResponseSchema,
  JobRunIdParamsSchema,
  JobRunListQuerySchema,
  ListJobRunsResponseSchema,
  MessageSendStatusSchema,
  type RunDiscoverySeedRequest,
  type RunDiscoveryTasksRequest,
  type TriggerJobRunResponse,
  RunDiscoverySeedRequestSchema,
  RunDiscoveryTasksRequestSchema,
  TriggerJobRunResponseSchema,
} from '@lead-flood/contracts';

import { z } from 'zod';
import {
  DiscoveryAdminBadRequestError,
  DiscoveryAdminNotFoundError,
  DiscoveryAdminNotImplementedError,
} from './discovery-admin.errors.js';
import { requireDiscoveryAdminAccess } from './discovery-admin.auth.js';
import { PrismaDiscoveryAdminRepository } from './discovery-admin.repository.js';
import { buildDiscoveryAdminService } from './discovery-admin.service.js';

export interface DiscoveryAdminRouteDependencies {
  adminApiKey?: string;
  triggerDiscoverySeedJob?: (input: RunDiscoverySeedRequest) => Promise<TriggerJobRunResponse>;
  triggerDiscoveryTaskRun?: (input: RunDiscoveryTasksRequest) => Promise<TriggerJobRunResponse>;
}

function requireAuthenticatedUserId(
  request: FastifyRequest,
  reply: FastifyReply,
): string | null {
  const userId = request.user?.sub;
  if (userId) {
    return userId;
  }

  reply.status(401).send(
    ErrorResponseSchema.parse({
      error: 'Authentication required',
      requestId: request.id,
    }),
  );
  return null;
}

function sendValidationError(reply: FastifyReply, requestId: string, message: string) {
  reply.status(400);
  return ErrorResponseSchema.parse({
    error: message,
    requestId,
  });
}

const DiscoveryRunIdParamsSchema = z.object({ id: z.string().min(1) }).strict();
const JobRequestTypeSchema = z.enum(['DISCOVERY_SEED', 'DISCOVERY_RUN']);
const JobRequestStatusSchema = z.enum(['PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELED']);
const JobRequestListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    status: JobRequestStatusSchema.optional(),
    requestType: JobRequestTypeSchema.optional(),
  })
  .strict();
const JobRequestRowSchema = z
  .object({
    id: z.number().int().nonnegative(),
    requestType: JobRequestTypeSchema,
    status: JobRequestStatusSchema,
    paramsJson: z.any(),
    requestedBy: z.string(),
    claimedBy: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    claimedAt: z.string().datetime().nullable(),
    startedAt: z.string().datetime().nullable(),
    finishedAt: z.string().datetime().nullable(),
    errorText: z.string().nullable(),
    jobRunId: z.string().nullable(),
    idempotencyKey: z.string().nullable(),
  })
  .strict();
const JobRequestListResponseSchema = z
  .object({
    items: z.array(JobRequestRowSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0),
  })
  .strict();
const ApolloRevealAttemptStatusSchema = z.enum(['CLAIMED', 'COMPLETED', 'ABANDONED']);
const ApolloRevealAttemptIdParamsSchema = z.object({ id: z.string().min(1) }).strict();
const StaleApolloRevealAttemptsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    olderThanMinutes: z.coerce.number().int().min(1).max(10_080).default(30),
  })
  .strict();
const StaleApolloRevealAttemptRowSchema = z
  .object({
    id: z.string().min(1),
    leadId: z.string().min(1),
    leadEmail: z.string().nullable(),
    leadFirstName: z.string().nullable(),
    leadLastName: z.string().nullable(),
    businessName: z.string().nullable(),
    icpProfileId: z.string().min(1),
    scorePredictionId: z.string().min(1),
    discoveryRunId: z.string().nullable(),
    status: ApolloRevealAttemptStatusSchema,
    jobId: z.string().nullable(),
    claimedAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
const StaleApolloRevealAttemptsResponseSchema = z
  .object({
    items: z.array(StaleApolloRevealAttemptRowSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0),
  })
  .strict();
const StaleMessageSendsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    olderThanMinutes: z.coerce.number().int().min(1).max(10_080).default(30),
  })
  .strict();
const StaleMessageSendRowSchema = z
  .object({
    id: z.string().min(1),
    leadId: z.string().min(1),
    leadEmail: z.string().nullable(),
    leadFirstName: z.string().nullable(),
    leadLastName: z.string().nullable(),
    businessName: z.string().nullable(),
    messageDraftId: z.string().min(1),
    messageVariantId: z.string().min(1),
    channel: z.enum(['EMAIL', 'WHATSAPP']),
    provider: z.enum(['RESEND', 'TRENGO']),
    status: z.literal('SENDING'),
    idempotencyKey: z.string().min(1),
    providerMessageId: z.string().nullable(),
    providerConversationId: z.string().nullable(),
    scheduledAt: z.string().datetime().nullable(),
    sentAt: z.string().datetime().nullable(),
    followUpNumber: z.number().int().min(0),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    sendingAgeMinutes: z.number().int().min(0),
  })
  .strict();
const StaleMessageSendsResponseSchema = z
  .object({
    items: z.array(StaleMessageSendRowSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0),
  })
  .strict();
const MessageSendIdParamsSchema = z.object({ id: z.string().min(1) }).strict();
const ResolveMessageSendResponseSchema = z
  .object({
    id: z.string().min(1),
    status: MessageSendStatusSchema,
    providerMessageId: z.string().nullable(),
    providerConversationId: z.string().nullable(),
    sentAt: z.string().datetime().nullable(),
    updatedAt: z.string().datetime(),
  })
  .strict();
const ResolveApolloRevealAttemptResponseSchema = z
  .object({
    id: z.string().min(1),
    status: ApolloRevealAttemptStatusSchema,
    claimedAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
    resolvedAt: z.string().datetime().nullable(),
    resolvedByUserId: z.string().min(1).nullable(),
    updatedAt: z.string().datetime(),
  })
  .strict();

function handleModuleError(error: unknown, request: FastifyRequest, reply: FastifyReply): boolean {
  if (error instanceof DiscoveryAdminNotFoundError) {
    reply.status(404).send(
      ErrorResponseSchema.parse({
        error: error.message,
        requestId: request.id,
      }),
    );
    return true;
  }

  if (error instanceof DiscoveryAdminBadRequestError) {
    reply.status(400).send(
      ErrorResponseSchema.parse({
        error: error.message,
        requestId: request.id,
      }),
    );
    return true;
  }

  if (error instanceof DiscoveryAdminNotImplementedError) {
    reply.status(501).send(
      ErrorResponseSchema.parse({
        error: error.message,
        requestId: request.id,
      }),
    );
    return true;
  }

  return false;
}

export function registerDiscoveryAdminRoutes(
  app: FastifyInstance,
  dependencies: DiscoveryAdminRouteDependencies = {},
): void {
  const repository = new PrismaDiscoveryAdminRepository();
  const service = buildDiscoveryAdminService(repository, {
    ...(dependencies.triggerDiscoverySeedJob
      ? { triggerDiscoverySeedJob: dependencies.triggerDiscoverySeedJob }
      : {}),
    ...(dependencies.triggerDiscoveryTaskRun
      ? { triggerDiscoveryTaskRun: dependencies.triggerDiscoveryTaskRun }
      : {}),
  });

  app.get('/v1/admin/leads', async (request, reply) => {
    if (!(await requireDiscoveryAdminAccess(request, reply, dependencies.adminApiKey))) {
      return;
    }

    const parsedQuery = AdminListLeadsQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return sendValidationError(reply, request.id, 'Invalid admin leads query');
    }

    try {
      const result = await service.listLeads(parsedQuery.data);
      return AdminListLeadsResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.get('/v1/admin/leads/:id', async (request, reply) => {
    if (!(await requireDiscoveryAdminAccess(request, reply, dependencies.adminApiKey))) {
      return;
    }

    const parsedParams = AdminLeadIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendValidationError(reply, request.id, 'Invalid lead id');
    }

    try {
      const result = await service.getLeadById(parsedParams.data.id);
      return AdminLeadDetailResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.get('/v1/admin/search-tasks', async (request, reply) => {
    if (!(await requireDiscoveryAdminAccess(request, reply, dependencies.adminApiKey))) {
      return;
    }

    const parsedQuery = AdminListSearchTasksQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return sendValidationError(reply, request.id, 'Invalid search task query');
    }

    try {
      const result = await service.listSearchTasks(parsedQuery.data);
      return AdminListSearchTasksResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.get('/v1/admin/search-tasks/:id', async (request, reply) => {
    if (!(await requireDiscoveryAdminAccess(request, reply, dependencies.adminApiKey))) {
      return;
    }

    const parsedParams = AdminSearchTaskIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendValidationError(reply, request.id, 'Invalid search task id');
    }

    try {
      const result = await service.getSearchTaskById(parsedParams.data.id);
      return AdminSearchTaskDetailResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.post('/v1/admin/jobs/discovery/seed', async (request, reply) => {
    if (!(await requireDiscoveryAdminAccess(request, reply, dependencies.adminApiKey))) {
      return;
    }

    const parsedBody = RunDiscoverySeedRequestSchema.safeParse(request.body);
    if (!parsedBody.success) {
      return sendValidationError(reply, request.id, 'Invalid discovery seed payload');
    }

    try {
      const result = await service.triggerDiscoverySeed(parsedBody.data);
      reply.status(202);
      return TriggerJobRunResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.post('/v1/admin/jobs/discovery/run', async (request, reply) => {
    if (!(await requireDiscoveryAdminAccess(request, reply, dependencies.adminApiKey))) {
      return;
    }

    const parsedBody = RunDiscoveryTasksRequestSchema.safeParse(request.body);
    if (!parsedBody.success) {
      return sendValidationError(reply, request.id, 'Invalid discovery run payload');
    }

    try {
      const result = await service.triggerDiscoveryTaskRun(parsedBody.data);
      reply.status(202);
      return TriggerJobRunResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.get('/v1/admin/jobs/requests', async (request, reply) => {
    if (!(await requireDiscoveryAdminAccess(request, reply, dependencies.adminApiKey))) {
      return;
    }

    const parsedQuery = JobRequestListQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return sendValidationError(reply, request.id, 'Invalid job requests query');
    }

    try {
      const result = await service.listJobRequests(parsedQuery.data);
      return JobRequestListResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.get('/v1/admin/jobs/message-sends/stale', async (request, reply) => {
    if (!(await requireDiscoveryAdminAccess(request, reply, dependencies.adminApiKey))) {
      return;
    }

    const parsedQuery = StaleMessageSendsQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return sendValidationError(reply, request.id, 'Invalid stale message sends query');
    }

    try {
      const result = await service.listStaleMessageSends(parsedQuery.data);
      return StaleMessageSendsResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.post('/v1/admin/jobs/message-sends/:id/resolve', async (request, reply) => {
    if (!(await requireDiscoveryAdminAccess(request, reply, dependencies.adminApiKey))) {
      return;
    }

    const parsedParams = MessageSendIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendValidationError(reply, request.id, 'Invalid message send id');
    }

    try {
      const result = await service.resolveMessageSend(parsedParams.data.id);
      return ResolveMessageSendResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.get('/v1/admin/jobs/apollo-reveal-attempts/stale', async (request, reply) => {
    if (!(await requireDiscoveryAdminAccess(request, reply, dependencies.adminApiKey))) {
      return;
    }

    const parsedQuery = StaleApolloRevealAttemptsQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return sendValidationError(reply, request.id, 'Invalid stale Apollo claims query');
    }

    try {
      const result = await service.listStaleApolloRevealAttempts(parsedQuery.data);
      return StaleApolloRevealAttemptsResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.post('/v1/admin/jobs/apollo-reveal-attempts/:id/resolve', async (request, reply) => {
    if (!(await requireDiscoveryAdminAccess(request, reply, dependencies.adminApiKey))) {
      return;
    }

    const userId = requireAuthenticatedUserId(request, reply);
    if (!userId) {
      return;
    }

    const parsedParams = ApolloRevealAttemptIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendValidationError(reply, request.id, 'Invalid Apollo reveal attempt id');
    }

    try {
      const result = await service.resolveApolloRevealAttempt(parsedParams.data.id, userId);
      return ResolveApolloRevealAttemptResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.get('/v1/admin/jobs/runs', async (request, reply) => {
    if (!(await requireDiscoveryAdminAccess(request, reply, dependencies.adminApiKey))) {
      return;
    }

    const parsedQuery = JobRunListQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return sendValidationError(reply, request.id, 'Invalid job runs query');
    }

    try {
      const result = await service.listJobRuns(parsedQuery.data);
      return ListJobRunsResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.get('/v1/admin/jobs/runs/:id', async (request, reply) => {
    if (!(await requireDiscoveryAdminAccess(request, reply, dependencies.adminApiKey))) {
      return;
    }

    const parsedParams = JobRunIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendValidationError(reply, request.id, 'Invalid job run id');
    }

    try {
      const result = await service.getJobRunById(parsedParams.data.id);
      return JobRunDetailResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  // ── B1: Cancel a discovery run (JobExecution) ──
  app.post('/v1/discovery-admin/runs/:id/cancel', async (request, reply) => {
    // Auth is handled by the protectedRoutes plugin (JWT guard)
    const userId = requireAuthenticatedUserId(request, reply);
    if (!userId) {
      return;
    }

    const parsedParams = DiscoveryRunIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendValidationError(reply, request.id, 'Invalid run id');
    }

    try {
      const result = await service.cancelDiscoveryRun(parsedParams.data.id, userId);
      return result;
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  // ── B5: Get discovery run detail with converted leads ──
  app.get('/v1/discovery-admin/runs/:id', async (request, reply) => {
    if (!(await requireDiscoveryAdminAccess(request, reply, dependencies.adminApiKey))) {
      return;
    }

    const parsedParams = DiscoveryRunIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendValidationError(reply, request.id, 'Invalid run id');
    }

    try {
      const result = await service.getDiscoveryRunDetail(parsedParams.data.id);
      return result;
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });
}
