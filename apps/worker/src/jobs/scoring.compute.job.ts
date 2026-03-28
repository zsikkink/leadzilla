import type { CreateScoringRunRequest } from '@lead-flood/contracts';
import { prisma, toInputJson } from '@lead-flood/db';
import type { OpenAiAdapter } from '@lead-flood/providers';
import type { Job, SendOptions } from 'pg-boss';

import { classifyError } from '../errors.js';
import { tryFinalizeDiscoveryRun } from '../utils/discovery-run-tracker.js';
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
} from '../scoring/shared.js';
import {
  getDeterministicAiBlend,
  getScoreQualificationThreshold,
  getScoreTierBands,
} from '../utils/pipeline-settings.js';

export const SCORING_COMPUTE_JOB_NAME = 'scoring.compute';
/** Batch/API-triggered scoring singleton key. Per-lead scoring (from features.compute) uses a 3-part key: scoring.compute:${runId}:${leadId}:${icpProfileId} */
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

async function markTrackedScoringRunRunning(runId: string): Promise<void> {
  await prisma.jobExecution.updateMany({
    where: {
      id: runId,
      type: SCORING_COMPUTE_JOB_NAME,
      status: 'queued',
    },
    data: {
      status: 'running',
      startedAt: new Date(),
      error: null,
    },
  });
}

async function finalizeTrackedScoringRun(
  runId: string,
  status: 'completed' | 'failed',
  error: string | null = null,
): Promise<void> {
  await prisma.jobExecution.updateMany({
    where: {
      id: runId,
      type: SCORING_COMPUTE_JOB_NAME,
      status: {
        in: ['queued', 'running'],
      },
    },
    data: {
      status,
      finishedAt: new Date(),
      error,
    },
  });
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
    await markTrackedScoringRunRunning(runId);

    // Dynamic qualification threshold from PipelineSetting table
    const qualificationThreshold = await getScoreQualificationThreshold();

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
      await finalizeTrackedScoringRun(runId, 'completed');
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

    const leadBusinessIdMap = new Map<string, string | null>();
    if (deps?.enqueueApolloEnrich && targetLeadIds.length > 0) {
      const leadsWithBusiness = await prisma.lead.findMany({
        where: { id: { in: targetLeadIds } },
        select: { id: true, businessId: true },
      });
      for (const lead of leadsWithBusiness) {
        leadBusinessIdMap.set(lead.id, lead.businessId);
      }
    }

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

    // Read UI-configured blend override and tier bands (same pattern as scoring.batch)
    const deterministicAiBlend = await getDeterministicAiBlend();
    const blendRatio = deterministicAiBlend !== null
      ? { deterministicWeight: deterministicAiBlend, aiWeight: 1 - deterministicAiBlend }
      : await computeBlendRatio();
    const scoreTierBands = await getScoreTierBands();

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
        const blendedScore = Math.min(1, Math.max(0,
          usedTrainedModel || logisticScore > 0
            ? dWeight * deterministicScore + aWeight * logisticScore
            : deterministicScore,
        ));
        const scoreBand = toScoreBand(blendedScore, scoreTierBands);

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

        // ── Lead status transition + rejection tracking ──────────────
        // Preserve downstream lifecycle states (messaged/replied/cold) during scheduled rescoring.
        const isRejected = !deterministic.hardFilterPassed || blendedScore < qualificationThreshold;
        const statusUpdated = await prisma.lead.updateMany({
          where: {
            id: targetLeadId,
            status: { in: ['new', 'processing', 'enriched', 'scored', 'qualified', 'rejected', 'stuck'] },
          },
          data: { status: isRejected ? 'rejected' : 'qualified' },
        });
        if (statusUpdated.count === 0) {
          logger.info(
            { jobId: job.id, leadId: targetLeadId },
            'Skipped lead status update to preserve downstream lifecycle state',
          );
          await tryFinalizeDiscoveryRun(runId, logger);
          continue;
        }

        if (isRejected) {
          const rejectionReason = !deterministic.hardFilterPassed ? 'HARD_FILTER_FAILED' : 'BELOW_THRESHOLD';
          const failedFilters = deterministic.reasonCodes
            .filter((c) => c.startsWith('HARD_FILTER_FAILED_'))
            .map((c) => c.replace('HARD_FILTER_FAILED_', ''));

          await prisma.leadRejection.upsert({
            where: { leadId: targetLeadId },
            create: {
              leadId: targetLeadId,
              icpProfileId: targetIcpId,
              score: blendedScore,
              reason: rejectionReason,
              rejectedBy: 'SYSTEM',
              metadata: toInputJson({
                failedHardFilters: failedFilters,
                threshold: qualificationThreshold,
              }),
            },
            update: {
              icpProfileId: targetIcpId,
              score: blendedScore,
              reason: rejectionReason,
              rejectedBy: 'SYSTEM',
              rejectedAt: new Date(),
              metadata: toInputJson({
                failedHardFilters: failedFilters,
                threshold: qualificationThreshold,
              }),
            },
          });

          logger.info(
            { jobId: job.id, leadId: targetLeadId, icpProfileId: targetIcpId, blendedScore, reason: rejectionReason },
            `Lead rejected — ${rejectionReason}`,
          );
        } else {
          await prisma.leadRejection.deleteMany({
            where: { leadId: targetLeadId },
          });
        }

        if (!isRejected) {
          // Keep discovery leads in `qualified` until a human explicitly starts draft generation.
          // Apollo reveal can still run to enrich contact data, but drafting is manual.
          if (deps?.enqueueApolloEnrich) {
            const primaryBusinessId = leadBusinessIdMap.get(targetLeadId) ?? null;
            // Look up BusinessConversion for apolloHasEmail/apolloHasDirectPhone
            const businessConversion = primaryBusinessId
              ? await prisma.businessConversion.findFirst({
                  where: {
                    leadId: targetLeadId,
                    icpProfileId: targetIcpId,
                    businessId: primaryBusinessId,
                  },
                  select: { apolloHasEmail: true, apolloHasDirectPhone: true },
                  orderBy: { createdAt: 'desc' },
                })
              : null;

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
          }
        }

        // Always check if discovery run can finalize or update progress
        // (LOW scores are terminal; HIGH/MEDIUM may still be in-flight but
        // tryFinalizeDiscoveryRun handles that correctly)
        await tryFinalizeDiscoveryRun(runId, logger);
      }
    }

    // Update JobExecution tracking records for scored leads
    const scoredLeadIds = job.data.mode === 'BY_LEAD_IDS' && job.data.leadIds
      ? job.data.leadIds
      : targetLeadIds;
    if (scoredLeadIds.length > 0) {
      await prisma.jobExecution.updateMany({
        where: {
          type: SCORING_COMPUTE_JOB_NAME,
          status: 'queued',
          leadId: { in: scoredLeadIds },
        },
        data: { status: 'completed', finishedAt: new Date() },
      });
    }

    await finalizeTrackedScoringRun(runId, 'completed');

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
    const errorMessage =
      error instanceof Error ? error.message : 'Failed scoring.compute job';

    await finalizeTrackedScoringRun(runId, 'failed', errorMessage).catch(() => { /* best-effort */ });

    // Mark JobExecution as failed for tracked leads
    const failedLeadIds = job.data.leadIds ?? [];
    if (failedLeadIds.length > 0) {
      await prisma.jobExecution.updateMany({
        where: {
          type: SCORING_COMPUTE_JOB_NAME,
          status: 'queued',
          leadId: { in: failedLeadIds },
        },
        data: { status: 'failed', finishedAt: new Date(), error: errorMessage },
      }).catch(() => { /* best-effort */ });
    }

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
