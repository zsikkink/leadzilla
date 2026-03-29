import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  CreateScoringRunRequestSchema,
  CreateScoringRunResponseSchema,
  ErrorResponseSchema,
  LatestLeadDeterministicScoreResponseSchema,
  LatestLeadFeatureSnapshotResponseSchema,
  LatestLeadScoreResponseSchema,
  LatestLeadScoreQuerySchema,
  LeadIdParamsSchema,
  ListScorePredictionsQuerySchema,
  ListScorePredictionsResponseSchema,
  QualificationOperatorSchema,
  QualificationRuleResponseSchema,
  QualificationRuleTypeSchema,
  ScoringRunIdParamsSchema,
  ScoringRunStatusResponseSchema,
} from '@lead-flood/contracts';

import { requireAppAdminAccess, requireAuthenticatedUserId } from '../../auth/guard.js';
import { ScoringNotImplementedError } from './scoring.errors.js';
import { PrismaScoringRepository } from './scoring.repository.js';
import {
  buildScoringService,
  type ScoringRunJobPayload,
} from './scoring.service.js';

export interface ScoringRouteDependencies {
  enqueueScoringRun?: ((payload: ScoringRunJobPayload) => Promise<void>) | undefined;
}

function sendValidationError(reply: FastifyReply, requestId: string, message: string) {
  reply.status(400);
  return ErrorResponseSchema.parse({
    error: message,
    requestId,
  });
}

function handleModuleError(error: unknown, request: FastifyRequest, reply: FastifyReply): boolean {
  if (error instanceof ScoringNotImplementedError) {
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

export function registerScoringRoutes(
  app: FastifyInstance,
  dependencies?: ScoringRouteDependencies,
): void {
  const repository = new PrismaScoringRepository();
  const service = buildScoringService(repository, {
    enqueueScoringRun: dependencies?.enqueueScoringRun
      ? dependencies.enqueueScoringRun
      : async () => {
          throw new ScoringNotImplementedError('Scoring queue publisher is not configured');
        },
  });
  const requireAppAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAppAdminAccess(request, reply))) {
      return reply;
    }
  };

  app.post('/v1/scoring/runs', { preHandler: requireAppAdmin }, async (request, reply) => {
    const parsed = CreateScoringRunRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationError(reply, request.id, 'Invalid scoring run payload');
    }

    const userId = requireAuthenticatedUserId(request, reply);
    if (!userId) {
      return;
    }

    try {
      const createScoringRunInput = {
        ...parsed.data,
        requestedByUserId: userId,
      };
      const result = await service.createScoringRun(createScoringRunInput);
      return CreateScoringRunResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.get('/v1/scoring/runs/:runId', async (request, reply) => {
    const parsedParams = ScoringRunIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendValidationError(reply, request.id, 'Invalid scoring run id');
    }

    try {
      const result = await service.getScoringRunStatus(parsedParams.data.runId);
      return ScoringRunStatusResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.get('/v1/scoring/predictions', async (request, reply) => {
    const parsedQuery = ListScorePredictionsQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return sendValidationError(reply, request.id, 'Invalid score predictions query');
    }

    try {
      const result = await service.listScorePredictions(parsedQuery.data);
      return ListScorePredictionsResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.get('/v1/scoring/leads/:leadId/latest', async (request, reply) => {
    const parsedParams = LeadIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendValidationError(reply, request.id, 'Invalid lead id');
    }
    const parsedQuery = LatestLeadScoreQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return sendValidationError(reply, request.id, 'Invalid scoring query');
    }

    try {
      const result = await service.getLatestLeadScore(parsedParams.data.leadId, parsedQuery.data);
      return LatestLeadScoreResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.get('/v1/scoring/leads/:leadId/latest-feature-snapshot', async (request, reply) => {
    const parsedParams = LeadIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendValidationError(reply, request.id, 'Invalid lead id');
    }
    const parsedQuery = LatestLeadScoreQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return sendValidationError(reply, request.id, 'Invalid scoring query');
    }

    try {
      const result = await service.getLatestLeadFeatureSnapshot(
        parsedParams.data.leadId,
        parsedQuery.data,
      );
      return LatestLeadFeatureSnapshotResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.get('/v1/scoring/leads/:leadId/latest-deterministic', async (request, reply) => {
    const parsedParams = LeadIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendValidationError(reply, request.id, 'Invalid lead id');
    }
    const parsedQuery = LatestLeadScoreQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return sendValidationError(reply, request.id, 'Invalid scoring query');
    }

    try {
      const result = await service.getLatestLeadDeterministicScore(
        parsedParams.data.leadId,
        parsedQuery.data,
      );
      return LatestLeadDeterministicScoreResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  // Known field keys for qualification rule validation.
  // Mirrors FIELD_KEY_CATEGORY_MAP + TRAINED_MODEL_FEATURE_KEYS from worker scoring module.
  const KNOWN_FIELD_KEYS = new Set([
    'industry_supported', 'has_whatsapp', 'has_instagram', 'accepts_online_payments',
    'review_count', 'follower_count', 'physical_address_present', 'recent_activity',
    'custom_order_signals', 'pure_self_serve_ecom', 'shopify_detected', 'multi_staff_detected',
    'follower_growth_signal', 'high_engagement_signal', 'has_booking_or_contact_form',
    'variable_pricing_detected', 'industry_match', 'geo_match', 'high_ticket_signals',
    'deposit_milestone_signals', 'subscription_billing_detected', 'international_customer_signals',
    'icp_segment_priority', 'review_count_tier', 'follower_count_tier', 'bank_transfer_reliance',
    'upsell_signals', 'apify_payment_widget_count', 'apify_has_shopify', 'apify_has_booking_form',
    'apify_has_pricing_tiers', 'apify_has_product_catalog', 'instagram_follower_count',
    'instagram_engagement_rate', 'instagram_is_business_account', 'instagram_days_since_last_post',
    'instagram_has_bio_link', 'has_decision_maker_phone', 'decision_maker_count',
    'apollo_has_direct_phone', 'website_email_count', 'website_phone_count', 'social_link_count',
    'has_linkedin', 'tech_stack_size', 'has_crm', 'has_live_chat', 'has_analytics',
    'estimated_employees', 'certification_count', 'instagram_has_business_email',
    'data_alignment_score',
  ]);

  // POST /v1/scoring/rules — includes icpProfileId in body (unlike ICP module where it's a URL param)
  const CreateScoringRuleBodySchema = z.object({
    icpProfileId: z.string().min(1),
    fieldKey: z.string().min(1).max(120),
    operator: QualificationOperatorSchema,
    valueJson: z.unknown(),
    weight: z.number(),
    ruleType: QualificationRuleTypeSchema,
    name: z.string().min(1).max(120),
  }).strict();

  app.post('/v1/scoring/rules', { preHandler: requireAppAdmin }, async (request, reply) => {
    const parsed = CreateScoringRuleBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationError(reply, request.id, 'Invalid qualification rule payload');
    }

    if (!KNOWN_FIELD_KEYS.has(parsed.data.fieldKey)) {
      return sendValidationError(
        reply,
        request.id,
        `Unknown fieldKey: ${parsed.data.fieldKey}`,
      );
    }

    try {
      const result = await service.createQualificationRule(parsed.data);
      reply.status(201);
      return QualificationRuleResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });
}
