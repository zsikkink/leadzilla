import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '@lead-flood/db';
import {
  CreateDiscoveryRunRequestSchema,
  CreateDiscoveryRunResponseSchema,
  DiscoveryRunIdParamsSchema,
  DiscoveryRunStatusResponseSchema,
  ErrorResponseSchema,
  ListDiscoveryRecordsQuerySchema,
  ListDiscoveryRecordsResponseSchema,
} from '@lead-flood/contracts';

import { z } from 'zod';

import { DiscoveryNotImplementedError, DiscoveryRunNotFoundError } from './discovery.errors.js';
import { PrismaDiscoveryRepository } from './discovery.repository.js';
import {
  buildDiscoveryService,
  type DiscoveryRunJobPayload,
} from './discovery.service.js';

const DiscoveryLimitsSchema = z.object({
  DISCOVERY_MAX_RUNS_PER_DAY: z.coerce.number().int().min(1).default(10),
  DISCOVERY_MAX_CONCURRENT_RUNS: z.coerce.number().int().min(1).default(3),
  DISCOVERY_MAX_LEADS_PER_RUN: z.coerce.number().int().min(1).default(200),
});

let _limits: z.infer<typeof DiscoveryLimitsSchema> | undefined;

function getDiscoveryLimits() {
  if (!_limits) {
    _limits = DiscoveryLimitsSchema.parse(process.env);
  }
  return _limits;
}

export interface DiscoveryRouteDependencies {
  enqueueDiscoveryRun?: (payload: DiscoveryRunJobPayload) => Promise<void>;
}

function sendValidationError(reply: FastifyReply, requestId: string, message: string) {
  reply.status(400);
  return ErrorResponseSchema.parse({
    error: message,
    requestId,
  });
}

function handleModuleError(error: unknown, request: FastifyRequest, reply: FastifyReply): boolean {
  if (error instanceof DiscoveryRunNotFoundError) {
    reply.status(404).send(
      ErrorResponseSchema.parse({
        error: error.message,
        requestId: request.id,
      }),
    );
    return true;
  }

  if (error instanceof DiscoveryNotImplementedError) {
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

export function registerDiscoveryRoutes(
  app: FastifyInstance,
  dependencies?: DiscoveryRouteDependencies,
): void {
  const repository = new PrismaDiscoveryRepository();
  const service = buildDiscoveryService(repository, {
    enqueueDiscoveryRun: dependencies?.enqueueDiscoveryRun
      ? dependencies.enqueueDiscoveryRun
      : async () => {
          throw new DiscoveryNotImplementedError('Discovery queue publisher is not configured');
        },
  });

  app.post('/v1/discovery/runs', async (request, reply) => {
    const parsed = CreateDiscoveryRunRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationError(reply, request.id, 'Invalid discovery run payload');
    }

    const userId = request.user?.sub;
    if (!userId) {
      reply.status(401).send(
        ErrorResponseSchema.parse({
          error: 'Authentication required',
          requestId: request.id,
        }),
      );
      return;
    }

    const limits = getDiscoveryLimits();

    // Cap leads per run
    const cappedLimit = Math.min(parsed.data.limit ?? limits.DISCOVERY_MAX_LEADS_PER_RUN, limits.DISCOVERY_MAX_LEADS_PER_RUN);

    // Check per-user concurrent runs (QUEUED or RUNNING)
    const concurrentCount = await prisma.jobExecution.count({
      where: {
        type: 'discovery.run',
        status: { in: ['queued', 'running'] },
        payload: {
          path: ['requestedByUserId'],
          equals: userId,
        },
      },
    });

    if (concurrentCount >= limits.DISCOVERY_MAX_CONCURRENT_RUNS) {
      reply.status(429);
      reply.header('retry-after', '60');
      return ErrorResponseSchema.parse({
        error: `Concurrent discovery run limit reached (max ${limits.DISCOVERY_MAX_CONCURRENT_RUNS}). Wait for existing runs to complete.`,
        requestId: request.id,
      });
    }

    // Check per-user daily cap
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const dailyCount = await prisma.jobExecution.count({
      where: {
        type: 'discovery.run',
        createdAt: { gte: twentyFourHoursAgo },
        payload: {
          path: ['requestedByUserId'],
          equals: userId,
        },
      },
    });

    if (dailyCount >= limits.DISCOVERY_MAX_RUNS_PER_DAY) {
      const retryAfterSeconds = Math.ceil(
        (twentyFourHoursAgo.getTime() + 24 * 60 * 60 * 1000 - Date.now()) / 1000,
      );
      reply.status(429);
      reply.header('retry-after', String(Math.max(retryAfterSeconds, 60)));
      return ErrorResponseSchema.parse({
        error: `Daily discovery run limit reached (max ${limits.DISCOVERY_MAX_RUNS_PER_DAY} per 24h).`,
        requestId: request.id,
      });
    }

    try {
      const result = await service.createDiscoveryRun({
        ...parsed.data,
        limit: cappedLimit,
        requestedByUserId: parsed.data.requestedByUserId ?? userId,
      });
      return CreateDiscoveryRunResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.get('/v1/discovery/runs/:runId', async (request, reply) => {
    const parsedParams = DiscoveryRunIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendValidationError(reply, request.id, 'Invalid discovery run id');
    }

    try {
      const result = await service.getDiscoveryRunStatus(parsedParams.data.runId);
      return DiscoveryRunStatusResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.get('/v1/discovery/records', async (request, reply) => {
    const parsedQuery = ListDiscoveryRecordsQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return sendValidationError(reply, request.id, 'Invalid discovery records query');
    }

    try {
      const result = await service.listDiscoveryRecords(parsedQuery.data);
      return ListDiscoveryRecordsResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });
}
