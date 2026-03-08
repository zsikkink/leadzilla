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

// ── Inline category mapping (synced copy of @lead-flood/discovery icp-category-map) ──
// API can't import @lead-flood/discovery (not a dependency), so we keep a synced
// copy. Source of truth: packages/discovery/src/queries/icp-category-map.ts
// Last synced: 2026-03-06

const INLINE_CATEGORY_TAXONOMY_EN = [
  'bakery', 'coffee shop', 'restaurant', 'beauty salon', 'barbershop', 'gym',
  'dental clinic', 'medical clinic', 'fashion boutique', 'grocery store',
  'electronics store', 'bookstore', 'home decor', 'flower shop', 'cleaning service',
  'moving service', 'car repair', 'auto accessories', 'pet shop', 'event planner',
  'catering service', 'furniture store', 'kids clothing', 'optical store',
];

const ICP_INDUSTRY_CATEGORY_MAP: Record<string, string[]> = {
  // ── ICP A: Luxury & High-Ticket Services
  luxury_services: ['jewelry store', 'watch store', 'luxury goods store', 'spa', 'concierge service', 'luxury car rental'],
  yacht_charter: ['yacht charter', 'boat rental', 'marina', 'yacht broker'],
  private_aviation: ['private jet charter', 'aviation services', 'helicopter tour'],
  luxury_travel: ['luxury travel agency', 'travel agency', 'tour operator'],
  personal_shopping: ['fashion boutique', 'personal stylist', 'designer clothing store', 'luxury boutique'],
  // ── ICP B: Gifting, Corporate & Bespoke Experiences
  corporate_gifting: ['corporate gifting', 'gift shop', 'gift hamper'],
  florists: ['flower shop', 'flower delivery', 'wedding florist'],
  gift_boxes: ['chocolate shop', 'gift basket store', 'gourmet food store', 'custom gift shop'],
  experience_platforms: ['experience gift shop', 'activity center', 'adventure tour operator'],
  bespoke_events: ['event planner', 'catering service', 'party planner', 'event decorator'],
  // ── ICP C: Events, Weddings & Experiential Operators
  wedding_planning: ['wedding planner', 'wedding venue', 'bridal shop', 'destination wedding planner'],
  event_production: ['event management company', 'event rental', 'AV rental', 'stage design'],
  exhibitions: ['exhibition organizer', 'convention center', 'trade show organizer', 'expo organizer'],
  'pop-up_markets': ['pop-up shop', 'artisan market', 'weekend market', 'flea market'],
  festivals: ['festival organizer', 'outdoor event venue', 'concert venue', 'event agency'],
  // ── ICP D: Home, Design & High-Value Contracting
  interior_design: ['interior designer', 'home decor store', 'furniture showroom', 'kitchen design', 'lighting showroom'],
  renovation: ['renovation contractor', 'fit-out company', 'tiling store', 'flooring store', 'painting contractor'],
  architecture: ['architecture firm', 'architectural consultant'],
  contracting: ['general contractor', 'construction company', 'maintenance company', 'MEP contractor'],
  landscape_design: ['landscaping company', 'garden center', 'garden design', 'outdoor furniture store'],
  // ── ICP E: Boutique Hospitality & Short-Stay Operators
  boutique_hotels: ['boutique hotel', 'bed and breakfast', 'heritage hotel'],
  holiday_homes: ['holiday home rental', 'vacation rental', 'villa rental', 'chalet rental'],
  serviced_residences: ['serviced apartment', 'furnished apartment', 'aparthotel'],
  property_management: ['property management company', 'real estate agency', 'facilities management'],
  hospitality: ['hotel', 'resort', 'guest house', 'hostel'],
  // ── ICP F: Premium Wellness & Longevity Clinics
  wellness_clinics: ['wellness clinic', 'wellness center', 'holistic health center', 'physiotherapy clinic'],
  aesthetic_medicine: ['aesthetic clinic', 'cosmetic clinic', 'dermatology clinic', 'laser clinic', 'med spa', 'beauty salon'],
  longevity: ['anti-aging clinic', 'regenerative medicine clinic', 'longevity clinic', 'functional medicine clinic'],
  iv_therapy: ['IV drip clinic', 'IV therapy clinic', 'vitamin infusion clinic'],
  medical_tourism: ['medical clinic', 'dental clinic', 'medical center', 'health tourism agency'],
  // ── ICP G: High-Ticket Coaching & Advisory
  executive_coaching: ['executive coach', 'life coach', 'leadership coach', 'career coach', 'business coach'],
  business_advisory: ['business advisory firm', 'financial advisor', 'management consultant', 'strategy consultant'],
  masterminds: ['coworking space', 'business center', 'startup accelerator', 'innovation hub'],
  memberships: ['private members club', 'country club', 'social club', 'business club'],
  consulting: ['consulting firm', 'consulting agency', 'IT consultant', 'HR consultant'],
  // ── ICP H: Education & Training Providers
  private_education: ['private school', 'international school', 'nursery', 'preschool', 'kindergarten'],
  professional_training: ['training institute', 'training center', 'corporate training center', 'professional development center'],
  bootcamps: ['coding bootcamp', 'tech academy', 'programming school'],
  certifications: ['certification center', 'test prep center', 'exam center'],
  cohort_programs: ['learning center', 'education center', 'workshop space', 'tutoring center', 'language school'],
  // ── General categories (for custom/UI-created ICPs)
  luxury_retail: ['luxury boutique', 'designer store', 'high-end fashion store', 'jewelry store', 'watch store'],
  food_beverage: ['restaurant', 'coffee shop', 'bakery', 'catering service', 'juice bar', 'ice cream shop', 'food truck'],
  beauty_wellness: ['beauty salon', 'barbershop', 'spa', 'nail salon', 'massage center', 'lash studio'],
  health_medical: ['dental clinic', 'medical clinic', 'pharmacy', 'optical store', 'laboratory'],
  fitness: ['gym', 'fitness center', 'yoga studio', 'personal trainer', 'Pilates studio', 'CrossFit gym', 'martial arts studio'],
  events: ['event planner', 'wedding venue', 'catering service', 'party supplies', 'DJ service', 'photography studio'],
  automotive: ['car repair', 'auto accessories', 'car wash', 'car dealership', 'tire shop', 'car detailing'],
  education: ['tutoring center', 'language school', 'training institute', 'nursery', 'driving school', 'music school', 'art school'],
  home_services: ['cleaning service', 'moving service', 'plumber', 'electrician', 'pest control', 'handyman', 'locksmith'],
  pets: ['pet shop', 'veterinary clinic', 'pet grooming', 'pet boarding', 'dog trainer'],
  retail: ['grocery store', 'electronics store', 'bookstore', 'furniture store', 'kids clothing', 'toy store', 'sports store', 'stationery store'],
  ecommerce: ['online store', 'dropshipping', 'marketplace seller'],
  professional_services: ['accounting firm', 'law firm', 'consulting agency', 'recruitment agency'],
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
      const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      return sendValidationError(reply, request.id, `Invalid discovery run payload: ${details}`);
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
            evidence: {
              select: { searchTaskId: true },
              take: 1,
            },
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

      const [searchTasks, conversionRows] = await Promise.all([
        prisma.searchTask.findMany({
          where: { discoveryRunId: runId },
          select: {
            id: true,
            queryText: true,
            countryCode: true,
            city: true,
            status: true,
            taskType: true,
            paramsJson: true,
            error: true,
            _count: { select: { businessEvidence: true } },
          },
          orderBy: { createdAt: 'asc' },
        }),
        businessIds.length > 0
          ? prisma.businessConversion.findMany({
              where: { businessId: { in: businessIds } },
              select: {
                metadata: true,
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

      const leads = conversionRows
        .filter((row) => {
          if (!row.metadata || typeof row.metadata !== 'object' || Array.isArray(row.metadata)) {
            return false;
          }
          const metadata = row.metadata as Record<string, unknown>;
          return metadata.discoveryRunId === runId;
        })
        .map((row) => row.lead);

      // Get run counters from result JSON
      const resultJson = (jobExecution.result && typeof jobExecution.result === 'object' && !Array.isArray(jobExecution.result))
        ? jobExecution.result as Record<string, unknown>
        : {};
      const totalFound = typeof resultJson.totalFound === 'number'
        ? resultJson.totalFound
        : businesses.length;
      const newFound = typeof resultJson.newFound === 'number'
        ? resultJson.newFound
        : (typeof resultJson.newBusinesses === 'number' ? resultJson.newBusinesses : null);
      const alreadyKnown = typeof resultJson.alreadyKnown === 'number'
        ? resultJson.alreadyKnown
        : (newFound !== null ? Math.max(0, totalFound - newFound) : null);
      const disqualified = typeof resultJson.disqualified === 'number'
        ? resultJson.disqualified
        : null;
      const converted = typeof resultJson.converted === 'number'
        ? resultJson.converted
        : leads.length;

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
        totalFound,
        alreadyKnown,
        newFound,
        disqualified,
        converted,
        createdAt: jobExecution.createdAt.toISOString(),
        errorMessage: jobExecution.error ?? null,
        outcome: typeof resultJson.outcome === 'object' && resultJson.outcome !== null
          ? resultJson.outcome
          : null,
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
          provider: (() => {
            const params = t.paramsJson && typeof t.paramsJson === 'object' && !Array.isArray(t.paramsJson)
              ? t.paramsJson as Record<string, unknown>
              : {};
            const providerUsed = typeof params.providerUsed === 'string' ? params.providerUsed : null;
            if (providerUsed === 'SERPAPI') return 'SerpAPI';
            if (providerUsed === 'GOOGLE_PLACES') return 'Google Places';
            const tt = t.taskType as string;
            if (tt === 'SERP_MAPS_LOCAL') return 'Google Maps';
            if (tt === 'SERP_GOOGLE_LOCAL') return 'Google Local';
            if (tt === 'SERP_GOOGLE') return 'Google Web';
            if (tt.startsWith('SERP_')) return 'Google Search';
            if (tt === 'GOOGLE_CUSTOM_SEARCH') return 'Google Custom Search';
            return tt;
          })(),
          error: t.error ?? null,
        })),
        businesses: businesses.map((b) => ({
          id: b.id,
          name: b.name,
          websiteDomain: b.websiteDomain,
          deterministicScore: b.deterministicScore,
          scoreBand: b.scoreBand,
          preQualified: b.preQualified,
          disqualificationReason: b.disqualificationReason,
          searchTaskId: b.evidence[0]?.searchTaskId ?? null,
        })),
        leads: leads.map((c) => ({
          id: c.id,
          firstName: c.firstName,
          lastName: c.lastName,
          email: c.email,
          source: c.source,
          blendedScore: c.scorePredictions[0]?.blendedScore ?? null,
          scoreBand: c.scorePredictions[0]?.scoreBand ?? null,
          status: c.status,
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
