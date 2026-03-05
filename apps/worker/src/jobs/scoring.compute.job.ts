import type { CreateScoringRunRequest } from '@lead-flood/contracts';
import { prisma, toInputJson } from '@lead-flood/db';
import type { OpenAiAdapter } from '@lead-flood/providers';
import type { Job, SendOptions } from 'pg-boss';

import { classifyError } from '../errors.js';
import {
  evaluateDeterministicScore,
  toScoreBand,
  type DeterministicRule,
} from '../scoring/deterministic.js';
import { predictLogistic } from '../scoring/logistic.js';
import {
  asDeterministicRules,
  computeBlendRatio,
  ensureBaselineModelVersion,
  extractFeatureVectorForModel,
  findActiveTrainedModel,
  getQualificationThreshold,
} from '../scoring/shared.js';

export const SCORING_COMPUTE_JOB_NAME = 'scoring.compute';
export const SCORING_COMPUTE_IDEMPOTENCY_KEY_PATTERN = 'scoring.compute:${runId}';

export const SCORING_COMPUTE_RETRY_OPTIONS: Pick<
  SendOptions,
  'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'
> = {
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
  deadLetter: 'scoring.compute.dead_letter',
};

export interface ScoringComputeJobPayload
  extends Pick<CreateScoringRunRequest, 'mode' | 'icpProfileId' | 'leadIds' | 'modelVersionId' | 'requestedByUserId'> {
  runId: string;
  correlationId?: string;
}

export interface ScoringComputeLogger {
  info: (object: Record<string, unknown>, message: string) => void;
  warn: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
}

export interface ScoringComputeJobDependencies {
  openAiAdapter?: OpenAiAdapter;
  deterministicWeight?: number;
  aiWeight?: number;
  enqueueMessageGenerate?: ((payload: {
    leadId: string;
    icpProfileId: string;
    scorePredictionId: string;
    runId: string;
    correlationId?: string | undefined;
    channel?: string | undefined;
  }) => Promise<void>) | undefined;
  enqueueApolloEnrich?: ((payload: {
    leadId: string;
    icpProfileId: string;
    scorePredictionId: string;
    runId: string;
    scoreBand: 'LOW' | 'MEDIUM' | 'HIGH';
    apolloHasEmail: boolean;
    apolloHasDirectPhone: boolean;
    correlationId?: string | undefined;
  }) => Promise<void>) | undefined;
}

export async function handleScoringComputeJob(
  logger: ScoringComputeLogger,
  job: Job<ScoringComputeJobPayload>,
  deps?: ScoringComputeJobDependencies,
): Promise<void> {
  const { runId, correlationId, modelVersionId, icpProfileId } = job.data;
  const effectiveCorrelationId = correlationId ?? job.id;

  logger.info(
    {
      jobId: job.id,
      queue: job.name,
      runId,
      correlationId: effectiveCorrelationId,
      modelVersionId,
      icpProfileId,
      mode: job.data.mode,
    },
    'Started scoring.compute job',
  );

  try {
    // Dynamic qualification threshold from PipelineSetting table
    const qualificationThreshold = await getQualificationThreshold();

    const effectiveModelVersionId =
      modelVersionId ??
      (await ensureBaselineModelVersion());

    const targetIcpIds =
      job.data.mode === 'BY_ICP' && icpProfileId
        ? [icpProfileId]
        : job.data.mode === 'ALL_ACTIVE_ICPS'
          ? (
              await prisma.icpProfile.findMany({
                where: { isActive: true },
                select: { id: true },
              })
            ).map((row) => row.id)
          : icpProfileId
            ? [icpProfileId]
            : [];

    if (targetIcpIds.length === 0) {
      logger.warn(
        {
          jobId: job.id,
          queue: job.name,
          runId,
          correlationId: effectiveCorrelationId,
        },
        'No ICP targets resolved for scoring.compute job',
      );
      return;
    }

    const targetLeadIds =
      job.data.mode === 'BY_LEAD_IDS' && job.data.leadIds && job.data.leadIds.length > 0
        ? job.data.leadIds
        : (
            await prisma.lead.findMany({
              where: { deletedAt: null },
              select: { id: true },
            })
          ).map((lead) => lead.id);

    // Pre-load phone data for channel resolution
    const leadPhoneMap = new Map<string, { phone: string | null; decisionMakerPhone: string | null }>();
    if (deps?.enqueueMessageGenerate && targetLeadIds.length > 0) {
      const leadsWithPhone = await prisma.lead.findMany({
        where: { id: { in: targetLeadIds } },
        select: { id: true, phone: true, decisionMakerPhone: true },
      });
      for (const l of leadsWithPhone) {
        leadPhoneMap.set(l.id, { phone: l.phone, decisionMakerPhone: l.decisionMakerPhone });
      }
    }

    const rulesByIcp = new Map<string, DeterministicRule[]>();
    for (const icpId of targetIcpIds) {
      const rules = await prisma.qualificationRule.findMany({
        where: {
          icpProfileId: icpId,
          isActive: true,
        },
        orderBy: [{ orderIndex: 'asc' }, { priority: 'asc' }, { createdAt: 'asc' }],
      });
      rulesByIcp.set(icpId, asDeterministicRules(rules));
    }

    // Look up a trained logistic model (not the baseline stub)
    const trainedModel = await findActiveTrainedModel();
    const blendRatio = await computeBlendRatio();

    let persistedPredictions = 0;
    for (const targetLeadId of targetLeadIds) {
      for (const targetIcpId of targetIcpIds) {
        const latestSnapshot = await prisma.leadFeatureSnapshot.findFirst({
          where: {
            leadId: targetLeadId,
            icpProfileId: targetIcpId,
          },
          orderBy: [{ computedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        });

        if (!latestSnapshot) {
          continue;
        }

        const featurePayload =
          latestSnapshot.featuresJson && typeof latestSnapshot.featuresJson === 'object'
            ? (latestSnapshot.featuresJson as Record<string, unknown>)
            : {};

        // Data alignment hard filter: override scoring when cross-source data mismatch is severe
        const dataAlignmentScore = typeof featurePayload.data_alignment_score === 'number'
          ? featurePayload.data_alignment_score
          : null;
        const dataAlignmentFailed = dataAlignmentScore !== null && dataAlignmentScore < 0.3;

        const rules = rulesByIcp.get(targetIcpId) ?? [];
        const deterministic = evaluateDeterministicScore(rules, featurePayload);

        if (dataAlignmentFailed) {
          deterministic.hardFilterPassed = false;
          deterministic.qualificationScore = 0;
          deterministic.qualificationPath = 'HARD_FILTERED';
          deterministic.reasonCodes.push('HARD_FILTER_FAILED_DATA_ALIGNMENT_SCORE');
        }

        const deterministicScore = deterministic.qualificationScore;

        let logisticScore = 0;
        let aiReasoning: string[] = [];
        let usedTrainedModel = false;

        // Prefer trained logistic model over OpenAI when available
        if (trainedModel) {
          const featureVector = extractFeatureVectorForModel(featurePayload);
          logisticScore = predictLogistic(featureVector, trainedModel.model);
          usedTrainedModel = true;
        } else if (deps?.openAiAdapter?.isConfigured) {
          // Fall back to OpenAI AI scoring when no trained model
          try {
            const icpProfile = await prisma.icpProfile.findUnique({
              where: { id: targetIcpId },
              select: { description: true },
            });

            const aiResult = await deps.openAiAdapter.evaluateLeadScore({
              featuresJson: featurePayload,
              icpDescription: icpProfile?.description ?? 'No ICP description available',
              deterministicScore,
            });

            if (aiResult.status === 'success') {
              logisticScore = aiResult.data.score;
              aiReasoning = aiResult.data.reasoning;
            } else {
              logger.warn(
                { jobId: job.id, leadId: targetLeadId, icpId: targetIcpId, status: aiResult.status },
                'AI scoring failed, using deterministic-only',
              );
            }
          } catch (error: unknown) {
            logger.warn(
              { jobId: job.id, leadId: targetLeadId, icpId: targetIcpId, error },
              'AI scoring error, using deterministic-only',
            );
          }
        }

        const dWeight = deps?.deterministicWeight ?? blendRatio.deterministicWeight;
        const aWeight = deps?.aiWeight ?? blendRatio.aiWeight;
        const blendedScore = usedTrainedModel || logisticScore > 0
          ? dWeight * deterministicScore + aWeight * logisticScore
          : deterministicScore;
        const scoreBand = toScoreBand(blendedScore);

        const prediction = await prisma.leadScorePrediction.upsert({
          where: {
            leadId_icpProfileId_featureSnapshotId_modelVersionId: {
              leadId: targetLeadId,
              icpProfileId: targetIcpId,
              featureSnapshotId: latestSnapshot.id,
              modelVersionId: effectiveModelVersionId,
            },
          },
          create: {
            leadId: targetLeadId,
            icpProfileId: targetIcpId,
            featureSnapshotId: latestSnapshot.id,
            modelVersionId: effectiveModelVersionId,
            deterministicScore,
            logisticScore,
            blendedScore,
            scoreBand,
            reasonsJson: toInputJson({
              reasonCodes: deterministic.reasonCodes,
              hardFilterPassed: deterministic.hardFilterPassed,
              categoryScores: deterministic.categoryScores,
              qualificationPath: deterministic.qualificationPath,
              aiReasoning: aiReasoning.length > 0 ? aiReasoning : undefined,
              usedTrainedModel,
              blendWeights: { deterministic: dWeight, ai: aWeight },
            }),
            ruleEvaluationJson: toInputJson(deterministic.ruleEvaluation),
            predictedAt: new Date(),
          },
          update: {
            deterministicScore,
            logisticScore,
            blendedScore,
            scoreBand,
            reasonsJson: toInputJson({
              reasonCodes: deterministic.reasonCodes,
              hardFilterPassed: deterministic.hardFilterPassed,
              categoryScores: deterministic.categoryScores,
              qualificationPath: deterministic.qualificationPath,
              aiReasoning: aiReasoning.length > 0 ? aiReasoning : undefined,
              usedTrainedModel,
              blendWeights: { deterministic: dWeight, ai: aWeight },
            }),
            ruleEvaluationJson: toInputJson(deterministic.ruleEvaluation),
            predictedAt: new Date(),
          },
        });

        persistedPredictions += 1;

        if (blendedScore >= qualificationThreshold) {
          // Prefer apollo.enrich (post-scoring reveal) over direct message.generate
          if (deps?.enqueueApolloEnrich) {
            // Look up BusinessConversion for apolloHasEmail/apolloHasDirectPhone
            const businessConversion = await prisma.businessConversion.findFirst({
              where: { leadId: targetLeadId, icpProfileId: targetIcpId },
              select: { apolloHasEmail: true, apolloHasDirectPhone: true },
              orderBy: { createdAt: 'desc' },
            });

            await deps.enqueueApolloEnrich({
              leadId: targetLeadId,
              icpProfileId: targetIcpId,
              scorePredictionId: prediction.id,
              runId,
              scoreBand: scoreBand as 'LOW' | 'MEDIUM' | 'HIGH',
              apolloHasEmail: businessConversion?.apolloHasEmail ?? false,
              apolloHasDirectPhone: businessConversion?.apolloHasDirectPhone ?? false,
              correlationId: effectiveCorrelationId,
            });
            logger.info(
              { jobId: job.id, leadId: targetLeadId, icpProfileId: targetIcpId, blendedScore, scoreBand },
              'Enqueued apollo.enrich for qualifying lead',
            );
          } else if (deps?.enqueueMessageGenerate) {
            // Fallback: direct to message.generate if apollo.enrich not wired
            const phoneData = leadPhoneMap.get(targetLeadId);
            const hasPhone = Boolean(phoneData?.decisionMakerPhone || phoneData?.phone);
            const channel = blendedScore >= 0.67 && hasPhone ? 'WHATSAPP' : 'EMAIL';
            await deps.enqueueMessageGenerate({
              leadId: targetLeadId,
              icpProfileId: targetIcpId,
              scorePredictionId: prediction.id,
              runId,
              correlationId: effectiveCorrelationId,
              channel,
            });
            logger.info(
              { jobId: job.id, leadId: targetLeadId, icpProfileId: targetIcpId, blendedScore },
              'Enqueued message.generate for qualifying lead (no apollo.enrich)',
            );
          }
        }
      }
    }

    logger.info(
      {
        jobId: job.id,
        queue: job.name,
        runId,
        correlationId: effectiveCorrelationId,
        persistedPredictions,
        modelVersionId: effectiveModelVersionId,
      },
      'Completed scoring.compute job',
    );
  } catch (error: unknown) {
    logger.error(
      {
        jobId: job.id,
        queue: job.name,
        runId,
        correlationId: correlationId ?? job.id,
        error,
      },
      'Failed scoring.compute job',
    );

    throw classifyError(error);
  }
}
