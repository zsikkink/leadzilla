import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ActivateModelRequestSchema,
  CreateRetrainRunRequestSchema,
  CreateRetrainRunResponseSchema,
  ErrorResponseSchema,
  ListModelEvaluationsQuerySchema,
  ListModelEvaluationsResponseSchema,
  ListModelVersionsQuerySchema,
  ListModelVersionsResponseSchema,
  ListTrainingRunsQuerySchema,
  ListTrainingRunsResponseSchema,
  ModelVersionIdParamsSchema,
  ModelVersionResponseSchema,
  TrainingRunIdParamsSchema,
  TrainingRunResponseSchema,
} from '@lead-flood/contracts';

import { requireAppAdminAccess, requireAuthenticatedUserId } from '../../auth/guard.js';
import { LearningNotFoundError, LearningNotImplementedError } from './learning.errors.js';
import { PrismaLearningRepository } from './learning.repository.js';
import { buildLearningService, type LearningModelTrainJobPayload } from './learning.service.js';

export interface LearningRouteDependencies {
  enqueueModelTrain?: ((payload: LearningModelTrainJobPayload) => Promise<void>) | undefined;
}

function sendValidationError(reply: FastifyReply, requestId: string, message: string) {
  reply.status(400);
  return ErrorResponseSchema.parse({
    error: message,
    requestId,
  });
}

function handleModuleError(error: unknown, request: FastifyRequest, reply: FastifyReply): boolean {
  if (error instanceof LearningNotFoundError) {
    reply.status(404).send(
      ErrorResponseSchema.parse({
        error: error.message,
        requestId: request.id,
      }),
    );
    return true;
  }

  if (error instanceof LearningNotImplementedError) {
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

export function registerLearningRoutes(
  app: FastifyInstance,
  dependencies?: LearningRouteDependencies,
): void {
  const repository = new PrismaLearningRepository();
  const service = buildLearningService(repository, {
    enqueueModelTrain: dependencies?.enqueueModelTrain
      ? dependencies.enqueueModelTrain
      : async () => {
          throw new LearningNotImplementedError('Learning queue publisher is not configured');
        },
  });
  const requireAppAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAppAdminAccess(request, reply))) {
      return reply;
    }
  };

  app.post('/v1/learning/runs/retrain', { preHandler: requireAppAdmin }, async (request, reply) => {
    const parsed = CreateRetrainRunRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationError(reply, request.id, 'Invalid retrain run payload');
    }

    const userId = requireAuthenticatedUserId(request, reply);
    if (!userId) {
      return;
    }

    try {
      const createRetrainRunInput = {
        ...parsed.data,
        requestedByUserId: userId,
      };
      const result = await service.createRetrainRun(createRetrainRunInput);
      return CreateRetrainRunResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.get('/v1/learning/runs', async (request, reply) => {
    const parsedQuery = ListTrainingRunsQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return sendValidationError(reply, request.id, 'Invalid training runs query');
    }

    try {
      const result = await service.listTrainingRuns(parsedQuery.data);
      return ListTrainingRunsResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.get('/v1/learning/runs/:trainingRunId', async (request, reply) => {
    const parsedParams = TrainingRunIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendValidationError(reply, request.id, 'Invalid training run id');
    }

    try {
      const result = await service.getTrainingRun(parsedParams.data.trainingRunId);
      return TrainingRunResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.get('/v1/learning/models', async (request, reply) => {
    const parsedQuery = ListModelVersionsQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return sendValidationError(reply, request.id, 'Invalid model versions query');
    }

    try {
      const result = await service.listModelVersions(parsedQuery.data);
      return ListModelVersionsResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.get('/v1/learning/models/:modelVersionId', async (request, reply) => {
    const parsedParams = ModelVersionIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendValidationError(reply, request.id, 'Invalid model version id');
    }

    try {
      const result = await service.getModelVersion(parsedParams.data.modelVersionId);
      return ModelVersionResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.get('/v1/learning/models/:modelVersionId/evaluations', async (request, reply) => {
    const parsedParams = ModelVersionIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendValidationError(reply, request.id, 'Invalid model version id');
    }

    const parsedQuery = ListModelEvaluationsQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return sendValidationError(reply, request.id, 'Invalid model evaluations query');
    }

    try {
      const result = await service.listModelEvaluations(parsedParams.data.modelVersionId, parsedQuery.data);
      return ListModelEvaluationsResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.post('/v1/learning/models/:modelVersionId/activate', { preHandler: requireAppAdmin }, async (request, reply) => {
    const parsedParams = ModelVersionIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendValidationError(reply, request.id, 'Invalid model version id');
    }

    const parsedBody = ActivateModelRequestSchema.safeParse(request.body);
    if (!parsedBody.success) {
      return sendValidationError(reply, request.id, 'Invalid activate model payload');
    }

    try {
      const result = await service.activateModel(parsedParams.data.modelVersionId, parsedBody.data);
      return ModelVersionResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });
}
