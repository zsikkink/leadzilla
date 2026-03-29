import type {
  ActivateModelRequest,
  CreateRetrainRunRequest,
  CreateRetrainRunResponse,
  ListModelEvaluationsQuery,
  ListModelEvaluationsResponse,
  ListModelVersionsQuery,
  ListModelVersionsResponse,
  ListTrainingRunsQuery,
  ListTrainingRunsResponse,
  ModelVersionResponse,
  TrainingTrigger,
  TrainingRunResponse,
} from '@lead-flood/contracts';

import type { LearningRepository } from './learning.repository.js';

export type CreateRetrainRunInput = CreateRetrainRunRequest & {
  requestedByUserId?: string | undefined;
};

export interface LearningModelTrainJobPayload
  extends Pick<CreateRetrainRunRequest, 'windowDays' | 'minSamples' | 'activateIfPass'> {
  runId: string;
  trainingRunId: string;
  trigger: TrainingTrigger;
  correlationId?: string | undefined;
  requestedByUserId?: string | undefined;
}

export interface LearningServiceDependencies {
  enqueueModelTrain: (payload: LearningModelTrainJobPayload) => Promise<void>;
}

export interface LearningService {
  createRetrainRun(input: CreateRetrainRunInput): Promise<CreateRetrainRunResponse>;
  listTrainingRuns(query: ListTrainingRunsQuery): Promise<ListTrainingRunsResponse>;
  getTrainingRun(trainingRunId: string): Promise<TrainingRunResponse>;
  listModelVersions(query: ListModelVersionsQuery): Promise<ListModelVersionsResponse>;
  getModelVersion(modelVersionId: string): Promise<ModelVersionResponse>;
  listModelEvaluations(
    modelVersionId: string,
    query: ListModelEvaluationsQuery,
  ): Promise<ListModelEvaluationsResponse>;
  activateModel(modelVersionId: string, input: ActivateModelRequest): Promise<ModelVersionResponse>;
}

function formatModelTrainEnqueueFailure(error: unknown): string {
  return `Failed to enqueue model.train job: ${error instanceof Error ? error.message : String(error)}`;
}

export function buildLearningService(
  repository: LearningRepository,
  dependencies: LearningServiceDependencies,
): LearningService {
  return {
    async createRetrainRun(input) {
      // TODO: validate minimum sample constraints before scheduling.
      const result = await repository.createRetrainRun(input);

      if (result.status === 'QUEUED') {
        try {
          await dependencies.enqueueModelTrain({
            runId: result.trainingRunId,
            trainingRunId: result.trainingRunId,
            trigger: input.trigger,
            windowDays: input.windowDays,
            minSamples: input.minSamples,
            activateIfPass: input.activateIfPass,
            ...(input.requestedByUserId !== undefined
              ? { requestedByUserId: input.requestedByUserId }
              : {}),
          });
        } catch (error: unknown) {
          try {
            await repository.markTrainingRunFailed(
              result.trainingRunId,
              formatModelTrainEnqueueFailure(error),
            );
          } catch {
            // Preserve the original enqueue error for the caller.
          }
          throw error;
        }
      }

      return result;
    },
    async listTrainingRuns(query) {
      // TODO: add default ordering by createdAt desc.
      return repository.listTrainingRuns(query);
    },
    async getTrainingRun(trainingRunId) {
      // TODO: include downstream scoring trigger details.
      return repository.getTrainingRun(trainingRunId);
    },
    async listModelVersions(query) {
      // TODO: include activation eligibility metadata.
      return repository.listModelVersions(query);
    },
    async getModelVersion(modelVersionId) {
      // TODO: include model artifact metadata.
      return repository.getModelVersion(modelVersionId);
    },
    async listModelEvaluations(modelVersionId, query) {
      // TODO: include baseline comparison metrics.
      return repository.listModelEvaluations(modelVersionId, query);
    },
    async activateModel(modelVersionId, input) {
      // TODO: ensure only one active model per model type.
      return repository.activateModel(modelVersionId, input);
    },
  };
}
