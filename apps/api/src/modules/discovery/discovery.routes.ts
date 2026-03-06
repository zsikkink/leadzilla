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
  ListDiscoveryRunsQuerySchema,
  ListDiscoveryRunsResponseSchema,
} from '@lead-flood/contracts';

import { z } from 'zod';

import { DiscoveryNotImplementedError, DiscoveryRunNotFoundError } from './discovery.errors.js';
import { PrismaDiscoveryRepository } from './discovery.repository.js';
import {
  buildDiscoveryService,
  type DiscoveryRunJobPayload,
} from './discovery.service.js';

// ── Inline category mapping (mirrors @lead-flood/discovery icp-category-map) ──
// API can't import @lead-flood/discovery (not a dependency), so we inline the
// read-only mapping data needed for the preview endpoint.

const INLINE_CATEGORY_TAXONOMY_EN = [
  'bakery', 'coffee shop', 'restaurant', 'beauty salon', 'barbershop', 'gym',
  'dental clinic', 'medical clinic', 'fashion boutique', 'grocery store',
  'electronics store', 'bookstore', 'home decor', 'flower shop', 'cleaning service',
  'moving service', 'car repair', 'auto accessories', 'pet shop', 'event planner',
  'catering service', 'furniture store', 'kids clothing', 'optical store',
];

const ICP_INDUSTRY_CATEGORY_MAP: Record<string, string[]> = {
  luxury_retail: ['fashion boutique', 'jewelry store', 'home decor', 'watch store', 'luxury goods'],
  luxury_services: ['fashion boutique', 'jewelry store', 'home decor', 'watch store', 'luxury goods', 'event planner', 'spa'],
  food_beverage: ['restaurant', 'coffee shop', 'bakery', 'catering service'],
  beauty_wellness: ['beauty salon', 'barbershop', 'spa', 'nail salon'],
  health_medical: ['dental clinic', 'medical clinic', 'pharmacy', 'optical store'],
  fitness: ['gym', 'fitness center', 'yoga studio', 'personal trainer'],
  events: ['event planner', 'wedding venue', 'catering service', 'party supplies'],
  automotive: ['car repair', 'auto accessories', 'car wash', 'car dealership'],
  education: ['tutoring center', 'language school', 'training institute', 'nursery'],
  home_services: ['cleaning service', 'moving service', 'plumber', 'electrician'],
  pets: ['pet shop', 'veterinary clinic', 'pet grooming'],
  retail: ['grocery store', 'electronics store', 'bookstore', 'furniture store', 'kids clothing'],
  hospitality: ['hotel', 'resort', 'serviced apartment', 'guest house'],
  ecommerce: ['online store', 'dropshipping', 'marketplace seller'],
  professional_services: ['accounting firm', 'law firm', 'consulting agency', 'recruitment agency'],
  yacht_charter: ['yacht charter', 'boat rental', 'luxury travel', 'marina'],
  private_aviation: ['private jet charter', 'aviation services', 'luxury travel'],
  luxury_travel: ['luxury travel agency', 'travel agency', 'hotel', 'resort', 'serviced apartment'],
  personal_shopping: ['fashion boutique', 'personal stylist', 'luxury goods', 'jewelry store'],
  corporate_gifting: ['gift shop', 'corporate gifting'],
  florists: ['flower shop'],
  gift_boxes: ['gift shop', 'gift boxes'],
  experience_platforms: ['event planner', 'experience platform'],
  bespoke_events: ['event planner', 'catering service'],
  wedding_planning: ['event planner', 'wedding planner', 'catering service'],
  event_production: ['event planner', 'event production'],
  exhibitions: ['event planner', 'exhibition organizer'],
  interior_design: ['interior design', 'home decor', 'furniture store'],
  renovation: ['renovation contractor', 'home decor'],
  architecture: ['architecture firm', 'interior design'],
  landscape_design: ['landscaping', 'garden design'],
  boutique_hotels: ['boutique hotel', 'hotel'],
  holiday_homes: ['holiday home rental', 'serviced apartment'],
  serviced_residences: ['serviced apartment'],
  property_management: ['property management', 'real estate'],
  wellness_clinics: ['wellness clinic', 'beauty salon', 'medical clinic'],
  aesthetic_medicine: ['aesthetic clinic', 'beauty salon', 'medical clinic'],
  medical_tourism: ['medical clinic', 'dental clinic'],
  executive_coaching: ['business coaching', 'consulting'],
  business_advisory: ['consulting', 'business advisory'],
  private_education: ['private school', 'training institute'],
  professional_training: ['training institute', 'professional training'],
  bootcamps: ['coding bootcamp', 'training institute'],
  certifications: ['training institute', 'certification center'],
};

function fuzzyMatchInlineCategories(industry: string): string[] {
  const tokens = industry.toLowerCase().split(/[_\s]+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return [];
  return INLINE_CATEGORY_TAXONOMY_EN.filter((category) => {
    const categoryWords = category.toLowerCase().split(/\s+/);
    return tokens.some((token) => categoryWords.includes(token));
  });
}

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

  app.get('/v1/discovery/runs', async (request, reply) => {
    const parsedQuery = ListDiscoveryRunsQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return sendValidationError(reply, request.id, 'Invalid discovery runs query');
    }

    try {
      const result = await service.listDiscoveryRuns(parsedQuery.data);
      return ListDiscoveryRunsResponseSchema.parse(result);
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

  app.get('/v1/discovery/runs/:runId/details', async (request, reply) => {
    const parsedParams = DiscoveryRunIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendValidationError(reply, request.id, 'Invalid discovery run id');
    }

    const { runId } = parsedParams.data;

    try {
      // Load the run metadata from JobExecution
      const jobExecution = await prisma.jobExecution.findFirst({
        where: { id: runId, type: 'discovery.run' },
      });

      if (!jobExecution) {
        throw new DiscoveryRunNotFoundError();
      }

      const payload = (jobExecution.payload && typeof jobExecution.payload === 'object' && !Array.isArray(jobExecution.payload))
        ? jobExecution.payload as Record<string, unknown>
        : {};

      // Query all related entities in parallel
      const [businesses, costEvents] = await Promise.all([
        prisma.business.findMany({
          where: { discoveryRunId: runId },
          select: {
            id: true,
            name: true,
            websiteDomain: true,
            deterministicScore: true,
            scoreBand: true,
            preQualified: true,
            disqualificationReason: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.discoveryCostEvent.findMany({
          where: { discoveryRunId: runId },
          select: {
            id: true,
            provider: true,
            apiCallType: true,
            costCents: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        }),
      ]);

      const businessIds = businesses.map((b) => b.id);

      // Get search tasks linked via business evidence
      const [searchTaskRows, leads] = await Promise.all([
        businessIds.length > 0
          ? prisma.businessEvidence.findMany({
              where: { businessId: { in: businessIds }, searchTaskId: { not: null } },
              select: { searchTaskId: true },
              distinct: ['searchTaskId'],
            })
          : Promise.resolve([]),
        businessIds.length > 0
          ? prisma.businessConversion.findMany({
              where: { businessId: { in: businessIds } },
              select: {
                lead: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    source: true,
                    scorePredictions: {
                      orderBy: [{ predictedAt: 'desc' }, { createdAt: 'desc' }],
                      take: 1,
                      select: { blendedScore: true, scoreBand: true },
                    },
                    status: true,
                  },
                },
              },
            })
          : Promise.resolve([]),
      ]);

      const searchTaskIds = searchTaskRows
        .map((r) => r.searchTaskId)
        .filter((id): id is string => id !== null);

      const searchTasks = searchTaskIds.length > 0
        ? await prisma.searchTask.findMany({
            where: { id: { in: searchTaskIds } },
            select: {
              id: true,
              queryText: true,
              countryCode: true,
              city: true,
              status: true,
              taskType: true,
              _count: { select: { businessEvidence: true } },
            },
            orderBy: { createdAt: 'asc' },
          })
        : [];

      // Get run counters from result JSON
      const resultJson = (jobExecution.result && typeof jobExecution.result === 'object' && !Array.isArray(jobExecution.result))
        ? jobExecution.result as Record<string, unknown>
        : {};

      const run = {
        id: runId,
        status: jobExecution.status,
        icpProfileId: typeof payload.icpProfileId === 'string' ? payload.icpProfileId : null,
        config: payload,
        tasksTotal: typeof resultJson.totalItems === 'number' ? resultJson.totalItems : searchTasks.length,
        tasksCompleted: typeof resultJson.processedItems === 'number' ? resultJson.processedItems : 0,
        tasksFailed: typeof resultJson.failedItems === 'number' ? resultJson.failedItems : 0,
        businessesFound: businesses.length,
        leadsConverted: leads.length,
        createdAt: jobExecution.createdAt.toISOString(),
      };

      return {
        run,
        searchTasks: searchTasks.map((t) => ({
          id: t.id,
          queryText: t.queryText,
          countryCode: t.countryCode,
          city: t.city,
          status: t.status,
          resultsCount: t._count.businessEvidence,
          provider: t.taskType.startsWith('SERP_') ? 'SERPAPI' : t.taskType,
        })),
        businesses: businesses.map((b) => ({
          id: b.id,
          name: b.name,
          websiteDomain: b.websiteDomain,
          deterministicScore: b.deterministicScore,
          scoreBand: b.scoreBand,
          preQualified: b.preQualified,
          disqualificationReason: b.disqualificationReason,
        })),
        leads: leads.map((c) => ({
          id: c.lead.id,
          firstName: c.lead.firstName,
          lastName: c.lead.lastName,
          email: c.lead.email,
          source: c.lead.source,
          blendedScore: c.lead.scorePredictions[0]?.blendedScore ?? null,
          scoreBand: c.lead.scorePredictions[0]?.scoreBand ?? null,
          status: c.lead.status,
        })),
        costEvents: costEvents.map((e) => ({
          id: e.id,
          provider: e.provider,
          action: e.apiCallType,
          creditCost: e.costCents,
          createdAt: e.createdAt.toISOString(),
        })),
      };
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  const PreviewCategoriesBodySchema = z.object({
    industries: z.array(z.string()).min(1).max(50),
  });

  app.post('/v1/discovery/preview-categories', async (request, reply) => {
    const parsed = PreviewCategoriesBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationError(reply, request.id, 'Invalid preview-categories payload');
    }

    // Inline preview logic — API can't import @lead-flood/discovery directly.
    // This mirrors previewIndustryMappings() from icp-category-map.ts.
    const mappings = parsed.data.industries.map((industry) => {
      const key = industry.toLowerCase().trim().replaceAll(' ', '_');
      const mapped = ICP_INDUSTRY_CATEGORY_MAP[key];
      if (mapped) {
        return { industry, categories: [...mapped], source: 'mapped' as const };
      }
      const fuzzy = fuzzyMatchInlineCategories(key);
      if (fuzzy.length > 0) {
        return { industry, categories: fuzzy, source: 'fuzzy' as const };
      }
      return { industry, categories: [industry.trim()], source: 'direct' as const };
    });

    return { mappings };
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
