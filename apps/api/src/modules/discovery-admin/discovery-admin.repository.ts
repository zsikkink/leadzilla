import type {
  AdminBusinessContact,
  AdminBusinessDetailResponse,
  AdminBusinessRow,
  AdminLeadDetailResponse,
  AdminLeadRow,
  AdminListBusinessesQuery,
  AdminListBusinessesResponse,
  AdminListLeadsQuery,
  AdminListLeadsResponse,
  AdminListSearchTasksQuery,
  AdminListSearchTasksResponse,
  AdminSearchTaskDetailResponse,
  JobRunDetailResponse,
  JobRunListQuery,
  ListJobRunsResponse,
  MessageSendStatus,
} from '@lead-flood/contracts';
import { PrismaRuntime, prisma, type Prisma } from '@lead-flood/db';

import { DiscoveryAdminBadRequestError, DiscoveryAdminNotFoundError } from './discovery-admin.errors.js';

const DEFAULT_PG_BOSS_SCHEMA = 'pgboss';

function readPgBossSchema(): string {
  const schema = process.env.PG_BOSS_SCHEMA ?? DEFAULT_PG_BOSS_SCHEMA;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new DiscoveryAdminBadRequestError('Invalid pg-boss schema configuration');
  }
  return schema;
}

const SCORE_WEIGHTS = {
  hasWhatsapp: 0.2,
  hasInstagram: 0.1,
  acceptsOnlinePayments: 0.15,
  reviewCount: 0.2,
  followerCount: 0.1,
  physicalAddressPresent: 0.1,
  recentActivity: 0.15,
} as const;

type BusinessScoreTier = 'LOW' | 'MEDIUM' | 'HIGH';

function toTier(score: number): BusinessScoreTier {
  if (score >= 0.67) {
    return 'HIGH';
  }
  if (score >= 0.34) {
    return 'MEDIUM';
  }
  return 'LOW';
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

function computeBusinessScore(row: {
  hasWhatsapp: boolean;
  hasInstagram: boolean;
  acceptsOnlinePayments: boolean;
  reviewCount: number | null;
  followerCount: number | null;
  physicalAddressPresent: boolean;
  recentActivity: boolean;
}) {
  const reviewCount = row.reviewCount ?? 0;
  const followerCount = row.followerCount ?? 0;

  const contributions = [
    {
      code: 'HAS_WHATSAPP',
      label: 'Has WhatsApp',
      value: row.hasWhatsapp,
      weight: SCORE_WEIGHTS.hasWhatsapp,
      contribution: row.hasWhatsapp ? SCORE_WEIGHTS.hasWhatsapp : 0,
    },
    {
      code: 'HAS_INSTAGRAM',
      label: 'Has Instagram',
      value: row.hasInstagram,
      weight: SCORE_WEIGHTS.hasInstagram,
      contribution: row.hasInstagram ? SCORE_WEIGHTS.hasInstagram : 0,
    },
    {
      code: 'ACCEPTS_ONLINE_PAYMENTS',
      label: 'Accepts Online Payments',
      value: row.acceptsOnlinePayments,
      weight: SCORE_WEIGHTS.acceptsOnlinePayments,
      contribution: row.acceptsOnlinePayments ? SCORE_WEIGHTS.acceptsOnlinePayments : 0,
    },
    {
      code: 'REVIEW_COUNT',
      label: 'Review Count',
      value: reviewCount,
      weight: SCORE_WEIGHTS.reviewCount,
      contribution: Math.min(reviewCount / 200, 1) * SCORE_WEIGHTS.reviewCount,
    },
    {
      code: 'FOLLOWER_COUNT',
      label: 'Follower Count',
      value: followerCount,
      weight: SCORE_WEIGHTS.followerCount,
      contribution: Math.min(followerCount / 5000, 1) * SCORE_WEIGHTS.followerCount,
    },
    {
      code: 'PHYSICAL_ADDRESS_PRESENT',
      label: 'Physical Address Present',
      value: row.physicalAddressPresent,
      weight: SCORE_WEIGHTS.physicalAddressPresent,
      contribution: row.physicalAddressPresent ? SCORE_WEIGHTS.physicalAddressPresent : 0,
    },
    {
      code: 'RECENT_ACTIVITY',
      label: 'Recent Activity',
      value: row.recentActivity,
      weight: SCORE_WEIGHTS.recentActivity,
      contribution: row.recentActivity ? SCORE_WEIGHTS.recentActivity : 0,
    },
  ].map((entry) => ({
    ...entry,
    contribution: round(entry.contribution),
  }));

  const total = round(contributions.reduce((sum, entry) => sum + entry.contribution, 0));
  return {
    total,
    tier: toTier(total),
    contributions,
  };
}

function toLeadRow(row: {
  id: string;
  name: string;
  countryCode: string;
  city: string | null;
  category: string | null;
  deterministicScore: number;
  scoreBand: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  hasWhatsapp: boolean;
  hasInstagram: boolean;
  acceptsOnlinePayments: boolean;
  reviewCount: number | null;
  followerCount: number | null;
  physicalAddressPresent: boolean;
  recentActivity: boolean;
  websiteDomain: string | null;
  phoneE164: string | null;
  instagramHandle: string | null;
  createdAt: Date;
  updatedAt: Date;
}): AdminLeadRow {
  return {
    id: row.id,
    name: row.name,
    countryCode: row.countryCode,
    city: row.city,
    category: row.category,
    score: row.deterministicScore,
    scoreTier: row.scoreBand ?? toTier(row.deterministicScore),
    hasWhatsapp: row.hasWhatsapp,
    hasInstagram: row.hasInstagram,
    acceptsOnlinePayments: row.acceptsOnlinePayments,
    reviewCount: row.reviewCount,
    followerCount: row.followerCount,
    physicalAddressPresent: row.physicalAddressPresent,
    recentActivity: row.recentActivity,
    websiteDomain: row.websiteDomain,
    phoneE164: row.phoneE164,
    instagramHandle: row.instagramHandle,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function buildLeadWhere(query: AdminListLeadsQuery): Prisma.BusinessWhereInput {
  const and: Prisma.BusinessWhereInput[] = [];

  if (query.scoreMin !== undefined || query.scoreMax !== undefined) {
    and.push({
      deterministicScore: {
        ...(query.scoreMin !== undefined ? { gte: query.scoreMin } : {}),
        ...(query.scoreMax !== undefined ? { lte: query.scoreMax } : {}),
      },
    });
  }

  if (query.countries && query.countries.length > 0) {
    and.push({
      countryCode: {
        in: query.countries.map((value) => value.toUpperCase()),
      },
    });
  }

  if (query.city) {
    and.push({
      city: {
        contains: query.city,
        mode: 'insensitive',
      },
    });
  }

  if (query.industries && query.industries.length > 0) {
    and.push({
      OR: query.industries.map((category) => ({
        category: {
          equals: category,
          mode: 'insensitive',
        },
      })),
    });
  }

  if (query.hasWhatsapp !== undefined) {
    and.push({ hasWhatsapp: query.hasWhatsapp });
  }

  if (query.hasInstagram !== undefined) {
    and.push({ hasInstagram: query.hasInstagram });
  }

  if (query.acceptsOnlinePayments !== undefined) {
    and.push({ acceptsOnlinePayments: query.acceptsOnlinePayments });
  }

  if (query.recentlyActive !== undefined) {
    and.push({ recentActivity: query.recentlyActive });
  }

  if (query.minReviewCount !== undefined) {
    and.push({
      reviewCount: {
        gte: query.minReviewCount,
      },
    });
  }

  if (query.minFollowerCount !== undefined) {
    and.push({
      followerCount: {
        gte: query.minFollowerCount,
      },
    });
  }

  if (query.from || query.to) {
    and.push({
      createdAt: {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      },
    });
  }

  return and.length > 0 ? { AND: and } : {};
}

function buildLeadOrderBy(
  sortBy: AdminListLeadsQuery['sortBy'],
): Prisma.BusinessOrderByWithRelationInput[] {
  if (sortBy === 'recent') {
    return [{ updatedAt: 'desc' }, { id: 'desc' }];
  }
  if (sortBy === 'score_desc') {
    return [{ deterministicScore: 'desc' }, { updatedAt: 'desc' }, { id: 'desc' }];
  }
  if (sortBy === 'review_count') {
    return [{ reviewCount: 'desc' }, { deterministicScore: 'desc' }, { id: 'desc' }];
  }
  // 'newest' or fallthrough: newest first
  return [{ createdAt: 'desc' }, { id: 'desc' }];
}

function buildBusinessWhere(query: AdminListBusinessesQuery): Prisma.BusinessWhereInput {
  const and: Prisma.BusinessWhereInput[] = [
    {
      OR: [
        { contactRecoveryItems: { none: {} } },
        { businessConversions: { some: {} } },
      ],
    },
  ];

  if (query.q) {
    and.push({
      OR: [
        { name: { contains: query.q, mode: 'insensitive' } },
        { category: { contains: query.q, mode: 'insensitive' } },
        { websiteDomain: { contains: query.q, mode: 'insensitive' } },
        { city: { contains: query.q, mode: 'insensitive' } },
        { instagramHandle: { contains: query.q, mode: 'insensitive' } },
      ],
    });
  }

  return { AND: and };
}

function readBusinessLeadBlendedScore(lead: {
  enrichmentData: Prisma.JsonValue | null;
  scorePredictions: Array<{ blendedScore: number | null }>;
}): number | null {
  const predicted = lead.scorePredictions[0]?.blendedScore;
  if (typeof predicted === 'number') {
    return predicted;
  }

  if (!lead.enrichmentData || typeof lead.enrichmentData !== 'object' || Array.isArray(lead.enrichmentData)) {
    return null;
  }

  const scoreInfo = (lead.enrichmentData as Record<string, unknown>)._scoreInfo;
  if (!scoreInfo || typeof scoreInfo !== 'object' || Array.isArray(scoreInfo)) {
    return null;
  }

  return typeof (scoreInfo as Record<string, unknown>).blendedScore === 'number'
    ? (scoreInfo as Record<string, unknown>).blendedScore as number
    : null;
}

function mapBusinessContact(contact: {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  seniority: string;
  positionRank: number;
  source: string;
}): AdminBusinessContact {
  return {
    id: contact.id,
    name: contact.name,
    title: contact.title,
    email: contact.email,
    phone: contact.phone,
    linkedinUrl: contact.linkedinUrl,
    seniority: contact.seniority,
    positionRank: contact.positionRank,
    source: contact.source,
  };
}

function toBusinessRow(row: {
  id: string;
  name: string;
  countryCode: string;
  country: string | null;
  city: string | null;
  category: string | null;
  rating: number | null;
  reviewCount: number | null;
  followerCount: number | null;
  deterministicScore: number;
  scoreBand: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  hasWhatsapp: boolean;
  hasInstagram: boolean;
  acceptsOnlinePayments: boolean;
  recentActivity: boolean;
  websiteDomain: string | null;
  phoneE164: string | null;
  instagramHandle: string | null;
  preQualified: boolean | null;
  disqualificationReason: string | null;
  apifyWebsiteScrapeJson: Prisma.JsonValue | null;
  apifyInstagramScrapeJson: Prisma.JsonValue | null;
  websiteScrapedAt: Date | null;
  instagramScrapedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  contactRecoveryItems: Array<{
    status: 'OPEN' | 'APPROVED' | 'REJECTED';
    reason: 'NO_CONTACTS_FOUND' | 'NO_EMAIL' | 'DECISION_MAKER_IDENTIFIED';
    updatedAt: Date;
  }>;
  businessConversions: Array<{
    leadId: string;
    lead: {
      id: string;
      enrichmentData: Prisma.JsonValue | null;
      scorePredictions: Array<{ blendedScore: number | null }>;
    };
  }>;
}): AdminBusinessRow {
  const latestRecovery = row.contactRecoveryItems[0] ?? null;
  const latestConversion = row.businessConversions[0] ?? null;

  return {
    id: row.id,
    name: row.name,
    countryCode: row.countryCode,
    country: row.country,
    city: row.city,
    category: row.category,
    rating: row.rating,
    reviewCount: row.reviewCount,
    followerCount: row.followerCount,
    deterministicScore: row.deterministicScore,
    scoreBand: row.scoreBand,
    hasWhatsapp: row.hasWhatsapp,
    hasInstagram: row.hasInstagram,
    acceptsOnlinePayments: row.acceptsOnlinePayments,
    recentActivity: row.recentActivity,
    websiteDomain: row.websiteDomain,
    phoneE164: row.phoneE164,
    instagramHandle: row.instagramHandle,
    preQualified: row.preQualified,
    disqualificationReason: row.disqualificationReason,
    apifyWebsiteScrapeJson: row.apifyWebsiteScrapeJson,
    apifyInstagramScrapeJson: row.apifyInstagramScrapeJson,
    websiteScrapedAt: row.websiteScrapedAt?.toISOString() ?? null,
    instagramScrapedAt: row.instagramScrapedAt?.toISOString() ?? null,
    manualReviewStatus: latestRecovery?.status ?? null,
    manualReviewReason: latestRecovery?.reason ?? null,
    manualReviewUpdatedAt: latestRecovery?.updatedAt.toISOString() ?? null,
    leadBlendedScore: latestConversion ? readBusinessLeadBlendedScore(latestConversion.lead) : null,
    leadId: latestConversion?.leadId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function buildTaskOrderBy(
  sortBy: AdminListSearchTasksQuery['sortBy'],
): Prisma.SearchTaskOrderByWithRelationInput[] {
  if (sortBy === 'run_after_asc') {
    return [{ runAfter: 'asc' }, { updatedAt: 'desc' }, { id: 'asc' }];
  }
  if (sortBy === 'attempts_desc') {
    return [{ attempts: 'desc' }, { updatedAt: 'desc' }, { id: 'asc' }];
  }
  return [{ updatedAt: 'desc' }, { id: 'asc' }];
}

function readDerivedTaskParams(paramsJson: unknown): {
  engine: string | null;
  q: string | null;
  location: string | null;
  gl: string | null;
  hl: string | null;
  z: string | number | null;
  m: string | number | null;
  start: string | number | null;
} {
  if (!paramsJson || typeof paramsJson !== 'object' || Array.isArray(paramsJson)) {
    return {
      engine: null,
      q: null,
      location: null,
      gl: null,
      hl: null,
      z: null,
      m: null,
      start: null,
    };
  }

  const payload = paramsJson as Record<string, unknown>;
  const readString = (value: unknown): string | null =>
    typeof value === 'string' ? value : null;
  const readNumberish = (value: unknown): string | number | null =>
    typeof value === 'string' || typeof value === 'number' ? value : null;

  return {
    engine: readString(payload.engine),
    q: readString(payload.q),
    location: readString(payload.location),
    gl: readString(payload.gl),
    hl: readString(payload.hl),
    z: readNumberish(payload.z),
    m: readNumberish(payload.m),
    start: readNumberish(payload.start),
  };
}

export interface DiscoveryRunLeadItem {
  id: string;
  firstName: string;
  lastName: string;
  companyName: string | null;
}

export interface CancelDiscoveryRunResult {
  success: boolean;
  outcome: 'cancelled' | 'already_cancelled' | 'already_terminal';
  terminalStatus: 'completed' | 'failed' | 'cancelled' | null;
  cancelledPendingJobsCount: number;
}

export type DiscoveryAdminJobRequestType = 'DISCOVERY_SEED' | 'DISCOVERY_RUN';
export type DiscoveryAdminJobRequestStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELED';

export interface DiscoveryAdminJobRequestRow {
  id: number;
  requestType: DiscoveryAdminJobRequestType;
  status: DiscoveryAdminJobRequestStatus;
  paramsJson: unknown;
  requestedBy: string;
  claimedBy: string | null;
  createdAt: string;
  updatedAt: string;
  claimedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  errorText: string | null;
  jobRunId: string | null;
  idempotencyKey: string | null;
}

export interface DiscoveryAdminListJobRequestsQuery {
  page: number;
  pageSize: number;
  status?: DiscoveryAdminJobRequestStatus | undefined;
  requestType?: DiscoveryAdminJobRequestType | undefined;
}

export interface DiscoveryAdminListJobRequestsResponse {
  items: DiscoveryAdminJobRequestRow[];
  page: number;
  pageSize: number;
  total: number;
}

export type DiscoveryAdminApolloRevealAttemptStatus = 'CLAIMED' | 'COMPLETED' | 'ABANDONED';

export interface DiscoveryAdminApolloRevealAttemptRow {
  id: string;
  leadId: string;
  leadEmail: string | null;
  leadFirstName: string | null;
  leadLastName: string | null;
  businessName: string | null;
  icpProfileId: string;
  scorePredictionId: string;
  discoveryRunId: string | null;
  status: DiscoveryAdminApolloRevealAttemptStatus;
  jobId: string | null;
  claimedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DiscoveryAdminResolveApolloRevealAttemptResult {
  id: string;
  status: DiscoveryAdminApolloRevealAttemptStatus;
  claimedAt: string;
  completedAt: string | null;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  updatedAt: string;
}

export interface DiscoveryAdminListStaleApolloRevealAttemptsQuery {
  page: number;
  pageSize: number;
  olderThanMinutes: number;
}

export interface DiscoveryAdminListStaleApolloRevealAttemptsResponse {
  items: DiscoveryAdminApolloRevealAttemptRow[];
  page: number;
  pageSize: number;
  total: number;
}

export interface DiscoveryAdminStaleMessageSendRow {
  id: string;
  leadId: string;
  leadEmail: string | null;
  leadFirstName: string | null;
  leadLastName: string | null;
  businessName: string | null;
  messageDraftId: string;
  messageVariantId: string;
  channel: 'EMAIL' | 'WHATSAPP';
  provider: 'RESEND' | 'TRENGO';
  status: 'SENDING';
  idempotencyKey: string;
  providerMessageId: string | null;
  providerConversationId: string | null;
  scheduledAt: string | null;
  sentAt: string | null;
  followUpNumber: number;
  createdAt: string;
  updatedAt: string;
  sendingAgeMinutes: number;
}

export interface DiscoveryAdminListStaleMessageSendsQuery {
  page: number;
  pageSize: number;
  olderThanMinutes: number;
}

export interface DiscoveryAdminListStaleMessageSendsResponse {
  items: DiscoveryAdminStaleMessageSendRow[];
  page: number;
  pageSize: number;
  total: number;
}

export interface DiscoveryAdminResolveMessageSendResult {
  id: string;
  status: MessageSendStatus;
  providerMessageId: string | null;
  providerConversationId: string | null;
  sentAt: string | null;
  updatedAt: string;
}

function toIsoString(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toSafeNonnegativeInteger(value: number | bigint, label: string): number {
  if (typeof value === 'bigint') {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError(`${label} must be a safe nonnegative integer`);
    }

    return Number(value);
  }

  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a safe nonnegative integer`);
  }

  return value;
}

export interface DiscoveryAdminRepository {
  listBusinesses(query: AdminListBusinessesQuery): Promise<AdminListBusinessesResponse>;
  getBusinessById(id: string): Promise<AdminBusinessDetailResponse>;
  listLeads(query: AdminListLeadsQuery): Promise<AdminListLeadsResponse>;
  getLeadById(id: string): Promise<AdminLeadDetailResponse>;
  listSearchTasks(query: AdminListSearchTasksQuery): Promise<AdminListSearchTasksResponse>;
  getSearchTaskById(id: string): Promise<AdminSearchTaskDetailResponse>;
  listJobRequests(query: DiscoveryAdminListJobRequestsQuery): Promise<DiscoveryAdminListJobRequestsResponse>;
  listStaleMessageSends(
    query: DiscoveryAdminListStaleMessageSendsQuery,
  ): Promise<DiscoveryAdminListStaleMessageSendsResponse>;
  resolveMessageSend(id: string): Promise<DiscoveryAdminResolveMessageSendResult>;
  listStaleApolloRevealAttempts(
    query: DiscoveryAdminListStaleApolloRevealAttemptsQuery,
  ): Promise<DiscoveryAdminListStaleApolloRevealAttemptsResponse>;
  resolveApolloRevealAttempt(
    id: string,
    resolvedByUserId: string,
  ): Promise<DiscoveryAdminResolveApolloRevealAttemptResult>;
  listJobRuns(query: JobRunListQuery): Promise<ListJobRunsResponse>;
  getJobRunById(id: string): Promise<JobRunDetailResponse>;
  cancelDiscoveryRun(
    id: string,
    requestedByUserId?: string | undefined,
  ): Promise<CancelDiscoveryRunResult>;
  approveContactRecoveryItem(
    id: string,
    approvedByUserId: string,
  ): Promise<{ leadId: string; businessName: string }>;
  getDiscoveryRunDetail(id: string): Promise<{
    run: {
      id: string;
      type: string;
      status: string;
      attempts: number;
      payload: unknown;
      result: unknown;
      error: string | null;
      createdAt: string;
      startedAt: string | null;
      finishedAt: string | null;
      updatedAt: string;
    };
    leads: DiscoveryRunLeadItem[];
  }>;
}

export class PrismaDiscoveryAdminRepository implements DiscoveryAdminRepository {
  async listBusinesses(query: AdminListBusinessesQuery): Promise<AdminListBusinessesResponse> {
    const where = buildBusinessWhere(query);
    const [total, rows] = await Promise.all([
      prisma.business.count({ where }),
      prisma.business.findMany({
        where,
        orderBy: [{ deterministicScore: 'desc' }, { updatedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          name: true,
          countryCode: true,
          country: true,
          city: true,
          category: true,
          rating: true,
          reviewCount: true,
          followerCount: true,
          deterministicScore: true,
          scoreBand: true,
          hasWhatsapp: true,
          hasInstagram: true,
          acceptsOnlinePayments: true,
          recentActivity: true,
          websiteDomain: true,
          phoneE164: true,
          instagramHandle: true,
          preQualified: true,
          disqualificationReason: true,
          apifyWebsiteScrapeJson: true,
          apifyInstagramScrapeJson: true,
          websiteScrapedAt: true,
          instagramScrapedAt: true,
          createdAt: true,
          updatedAt: true,
          contactRecoveryItems: {
            orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
            take: 1,
            select: {
              status: true,
              reason: true,
              updatedAt: true,
            },
          },
          businessConversions: {
            orderBy: [{ convertedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
            take: 1,
            select: {
              leadId: true,
              lead: {
                select: {
                  id: true,
                  enrichmentData: true,
                  scorePredictions: {
                    orderBy: [{ predictedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
                    take: 1,
                    select: { blendedScore: true },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    return {
      items: rows.map((row) => toBusinessRow(row)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async getBusinessById(id: string): Promise<AdminBusinessDetailResponse> {
    const row = await prisma.business.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        countryCode: true,
        country: true,
        city: true,
        category: true,
        rating: true,
        reviewCount: true,
        followerCount: true,
        deterministicScore: true,
        scoreBand: true,
        hasWhatsapp: true,
        hasInstagram: true,
        acceptsOnlinePayments: true,
        recentActivity: true,
        websiteDomain: true,
        phoneE164: true,
        instagramHandle: true,
        preQualified: true,
        disqualificationReason: true,
        apifyWebsiteScrapeJson: true,
        apifyInstagramScrapeJson: true,
        websiteScrapedAt: true,
        instagramScrapedAt: true,
        createdAt: true,
        updatedAt: true,
        contactRecoveryItems: {
          orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: {
            status: true,
            reason: true,
            updatedAt: true,
          },
        },
        businessConversions: {
          orderBy: [{ convertedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: {
            leadId: true,
            lead: {
              select: {
                id: true,
                enrichmentData: true,
                scorePredictions: {
                  orderBy: [{ predictedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
                  take: 1,
                  select: { blendedScore: true },
                },
              },
            },
          },
        },
        contacts: {
          orderBy: [{ positionRank: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }],
          select: {
            id: true,
            name: true,
            title: true,
            email: true,
            phone: true,
            linkedinUrl: true,
            seniority: true,
            positionRank: true,
            source: true,
          },
        },
      },
    });

    if (!row) {
      throw new DiscoveryAdminNotFoundError('Business not found');
    }

    return {
      business: toBusinessRow(row),
      selectedContacts: row.contacts.map((contact) => mapBusinessContact(contact)),
    };
  }

  async listLeads(query: AdminListLeadsQuery): Promise<AdminListLeadsResponse> {
    const where = buildLeadWhere(query);
    const [total, rows] = await Promise.all([
      prisma.business.count({ where }),
      prisma.business.findMany({
        where,
        orderBy: buildLeadOrderBy(query.sortBy),
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      items: rows.map((row) => toLeadRow(row)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async getLeadById(id: string): Promise<AdminLeadDetailResponse> {
    const row = await prisma.business.findUnique({
      where: { id },
      include: {
        evidence: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 200,
          include: {
            searchTask: true,
          },
        },
      },
    });

    if (!row) {
      throw new DiscoveryAdminNotFoundError('Lead not found');
    }

    const scoreBreakdown = computeBusinessScore({
      hasWhatsapp: row.hasWhatsapp,
      hasInstagram: row.hasInstagram,
      acceptsOnlinePayments: row.acceptsOnlinePayments,
      reviewCount: row.reviewCount,
      followerCount: row.followerCount,
      physicalAddressPresent: row.physicalAddressPresent,
      recentActivity: row.recentActivity,
    });

    return {
      lead: toLeadRow(row),
      scoreBreakdown,
      evidenceTimeline: row.evidence.map((evidence) => ({
        id: evidence.id,
        sourceType: evidence.sourceType,
        sourceUrl: evidence.sourceUrl,
        serpapiResultId: evidence.serpapiResultId,
        rawJson: evidence.rawJson,
        createdAt: evidence.createdAt.toISOString(),
        searchTask: evidence.searchTask
          ? {
              id: evidence.searchTask.id,
              taskType: evidence.searchTask.taskType,
              queryText: evidence.searchTask.queryText,
              countryCode: evidence.searchTask.countryCode,
              city: evidence.searchTask.city,
              language: evidence.searchTask.language,
              page: evidence.searchTask.page,
              timeBucket: evidence.searchTask.timeBucket,
              paramsJson: evidence.searchTask.paramsJson,
              updatedAt: evidence.searchTask.updatedAt.toISOString(),
            }
          : null,
      })),
      dedupeKeys: {
        websiteDomain: row.websiteDomain,
        phoneE164: row.phoneE164,
        instagramHandle: row.instagramHandle,
      },
    };
  }

  async listSearchTasks(query: AdminListSearchTasksQuery): Promise<AdminListSearchTasksResponse> {
    const where: Prisma.SearchTaskWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.taskType ? { taskType: query.taskType } : {}),
      ...(query.countryCode ? { countryCode: query.countryCode.toUpperCase() } : {}),
      ...(query.timeBucket ? { timeBucket: { contains: query.timeBucket } } : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.searchTask.count({ where }),
      prisma.searchTask.findMany({
        where,
        orderBy: buildTaskOrderBy(query.sortBy),
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        taskType: row.taskType,
        status: row.status,
        countryCode: row.countryCode,
        city: row.city,
        language: row.language,
        queryText: row.queryText,
        timeBucket: row.timeBucket,
        attempts: row.attempts,
        runAfter: row.runAfter.toISOString(),
        lastResultHash: row.lastResultHash,
        error: row.error,
        updatedAt: row.updatedAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async getSearchTaskById(id: string): Promise<AdminSearchTaskDetailResponse> {
    const task = await prisma.searchTask.findUnique({
      where: { id },
      include: {
        businessEvidence: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 200,
          include: {
            business: true,
          },
        },
      },
    });

    if (!task) {
      throw new DiscoveryAdminNotFoundError('Search task not found');
    }

    return {
      task: {
        id: task.id,
        taskType: task.taskType,
        status: task.status,
        countryCode: task.countryCode,
        city: task.city,
        language: task.language,
        queryText: task.queryText,
        timeBucket: task.timeBucket,
        attempts: task.attempts,
        runAfter: task.runAfter.toISOString(),
        lastResultHash: task.lastResultHash,
        error: task.error,
        updatedAt: task.updatedAt.toISOString(),
        createdAt: task.createdAt.toISOString(),
        paramsJson: task.paramsJson,
        page: task.page,
        derivedParams: readDerivedTaskParams(task.paramsJson),
      },
      linkedLeads: task.businessEvidence.map((evidence) => ({
        businessId: evidence.business.id,
        name: evidence.business.name,
        countryCode: evidence.business.countryCode,
        city: evidence.business.city,
        category: evidence.business.category,
        score: evidence.business.deterministicScore,
        evidenceId: evidence.id,
        evidenceCreatedAt: evidence.createdAt.toISOString(),
      })),
    };
  }

  async listJobRequests(
    query: DiscoveryAdminListJobRequestsQuery,
  ): Promise<DiscoveryAdminListJobRequestsResponse> {
    const filters: string[] = [];
    const params: Array<string | number> = [];

    if (query.status) {
      params.push(query.status);
      filters.push(`status = $${params.length}`);
    }

    if (query.requestType) {
      params.push(query.requestType);
      filters.push(`request_type = $${params.length}`);
    }

    const whereClause = filters.length > 0 ? `where ${filters.join(' and ')}` : '';
    const offset = (query.page - 1) * query.pageSize;

    const countRows = await prisma.$queryRawUnsafe<Array<{ total: number }>>(
      `
        select count(*)::int as total
        from public.job_requests
        ${whereClause}
      `,
      ...params,
    );

    const rows = await prisma.$queryRawUnsafe<
      Array<{
        id: number | bigint;
        request_type: DiscoveryAdminJobRequestType;
        status: DiscoveryAdminJobRequestStatus;
        params_json: unknown;
        requested_by: string;
        claimed_by: string | null;
        created_at: Date | string;
        updated_at: Date | string;
        claimed_at: Date | string | null;
        started_at: Date | string | null;
        finished_at: Date | string | null;
        error_text: string | null;
        job_run_id: string | null;
        idempotency_key: string | null;
      }>
    >(
      `
        select
          id,
          request_type,
          status,
          params_json,
          requested_by,
          claimed_by,
          created_at,
          updated_at,
          claimed_at,
          started_at,
          finished_at,
          error_text,
          job_run_id,
          idempotency_key
        from public.job_requests
        ${whereClause}
        order by created_at desc, id desc
        limit $${params.length + 1}
        offset $${params.length + 2}
      `,
      ...params,
      query.pageSize,
      offset,
    );

    return {
      items: rows.map((row) => ({
        id: toSafeNonnegativeInteger(row.id, 'job_requests.id'),
        requestType: row.request_type,
        status: row.status,
        paramsJson: row.params_json,
        requestedBy: row.requested_by,
        claimedBy: row.claimed_by,
        createdAt: toIsoString(row.created_at)!,
        updatedAt: toIsoString(row.updated_at)!,
        claimedAt: toIsoString(row.claimed_at),
        startedAt: toIsoString(row.started_at),
        finishedAt: toIsoString(row.finished_at),
        errorText: row.error_text,
        jobRunId: row.job_run_id,
        idempotencyKey: row.idempotency_key,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total: countRows[0]?.total ?? 0,
    };
  }

  async listStaleMessageSends(
    query: DiscoveryAdminListStaleMessageSendsQuery,
  ): Promise<DiscoveryAdminListStaleMessageSendsResponse> {
    const cutoff = new Date(Date.now() - query.olderThanMinutes * 60_000);
    const where: Prisma.MessageSendWhereInput = {
      status: 'SENDING',
      updatedAt: { lt: cutoff },
    };

    const [total, rows] = await Promise.all([
      prisma.messageSend.count({ where }),
      prisma.messageSend.findMany({
        where,
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          leadId: true,
          messageDraftId: true,
          messageVariantId: true,
          channel: true,
          provider: true,
          status: true,
          idempotencyKey: true,
          providerMessageId: true,
          providerConversationId: true,
          scheduledAt: true,
          sentAt: true,
          followUpNumber: true,
          createdAt: true,
          updatedAt: true,
          lead: {
            select: {
              email: true,
              firstName: true,
              lastName: true,
              business: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        leadId: row.leadId,
        leadEmail: row.lead.email,
        leadFirstName: row.lead.firstName,
        leadLastName: row.lead.lastName,
        businessName: row.lead.business?.name ?? null,
        messageDraftId: row.messageDraftId,
        messageVariantId: row.messageVariantId,
        channel: row.channel,
        provider: row.provider,
        status: 'SENDING',
        idempotencyKey: row.idempotencyKey,
        providerMessageId: row.providerMessageId,
        providerConversationId: row.providerConversationId,
        scheduledAt: row.scheduledAt?.toISOString() ?? null,
        sentAt: row.sentAt?.toISOString() ?? null,
        followUpNumber: row.followUpNumber,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        sendingAgeMinutes: Math.max(
          0,
          Math.floor((Date.now() - row.updatedAt.getTime()) / 60_000),
        ),
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async resolveMessageSend(id: string): Promise<DiscoveryAdminResolveMessageSendResult> {
    const updateResult = await prisma.messageSend.updateMany({
      where: {
        id,
        status: 'SENDING',
      },
      data: {
        status: 'UNRESOLVED',
      },
    });

    const send = await prisma.messageSend.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        providerMessageId: true,
        providerConversationId: true,
        sentAt: true,
        updatedAt: true,
      },
    });

    if (!send) {
      throw new DiscoveryAdminNotFoundError('Message send not found');
    }

    if (updateResult.count === 0 && send.status !== 'UNRESOLVED') {
      throw new DiscoveryAdminBadRequestError(
        'Message send is no longer in SENDING and cannot be quarantined',
      );
    }

    return {
      id: send.id,
      status: send.status,
      providerMessageId: send.providerMessageId,
      providerConversationId: send.providerConversationId,
      sentAt: send.sentAt?.toISOString() ?? null,
      updatedAt: send.updatedAt.toISOString(),
    };
  }

  async listStaleApolloRevealAttempts(
    query: DiscoveryAdminListStaleApolloRevealAttemptsQuery,
  ): Promise<DiscoveryAdminListStaleApolloRevealAttemptsResponse> {
    const cutoff = new Date(Date.now() - query.olderThanMinutes * 60_000);
    const where: Prisma.ApolloRevealAttemptWhereInput = {
      status: 'CLAIMED',
      claimedAt: { lt: cutoff },
    };

    const [total, rows] = await Promise.all([
      prisma.apolloRevealAttempt.count({ where }),
      prisma.apolloRevealAttempt.findMany({
        where,
        orderBy: [{ claimedAt: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          leadId: true,
          icpProfileId: true,
          scorePredictionId: true,
          discoveryRunId: true,
          status: true,
          jobId: true,
          claimedAt: true,
          completedAt: true,
          createdAt: true,
          updatedAt: true,
          lead: {
            select: {
              email: true,
              firstName: true,
              lastName: true,
              business: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        leadId: row.leadId,
        leadEmail: row.lead.email,
        leadFirstName: row.lead.firstName,
        leadLastName: row.lead.lastName,
        businessName: row.lead.business?.name ?? null,
        icpProfileId: row.icpProfileId,
        scorePredictionId: row.scorePredictionId,
        discoveryRunId: row.discoveryRunId,
        status: row.status,
        jobId: row.jobId,
        claimedAt: row.claimedAt.toISOString(),
        completedAt: row.completedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async resolveApolloRevealAttempt(
    id: string,
    resolvedByUserId: string,
  ): Promise<DiscoveryAdminResolveApolloRevealAttemptResult> {
    const resolvedAt = new Date();
    const updateResult = await prisma.apolloRevealAttempt.updateMany({
      where: {
        id,
        status: 'CLAIMED',
      },
      data: {
        status: 'ABANDONED',
        resolvedAt,
        resolvedByUserId,
      },
    });

    const attempt = await prisma.apolloRevealAttempt.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        claimedAt: true,
        completedAt: true,
        resolvedAt: true,
        resolvedByUserId: true,
        updatedAt: true,
      },
    });

    if (!attempt) {
      throw new DiscoveryAdminNotFoundError('Apollo reveal attempt not found');
    }

    if (updateResult.count === 0 && attempt.status === 'COMPLETED') {
      throw new DiscoveryAdminBadRequestError(
        'Apollo reveal attempt is already completed and cannot be resolved',
      );
    }

    return {
      id: attempt.id,
      status: attempt.status,
      claimedAt: attempt.claimedAt.toISOString(),
      completedAt: attempt.completedAt?.toISOString() ?? null,
      resolvedAt: attempt.resolvedAt?.toISOString() ?? null,
      resolvedByUserId: attempt.resolvedByUserId,
      updatedAt: attempt.updatedAt.toISOString(),
    };
  }

  async listJobRuns(query: JobRunListQuery): Promise<ListJobRunsResponse> {
    const where: Prisma.JobRunWhereInput = {
      ...(query.jobName ? { jobName: query.jobName } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.jobRun.count({ where }),
      prisma.jobRun.findMany({
        where,
        orderBy: [{ startedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        jobName: row.jobName,
        startedAt: row.startedAt.toISOString(),
        finishedAt: row.finishedAt?.toISOString() ?? null,
        durationMs: row.durationMs ?? null,
        status: row.status,
        paramsJson: row.paramsJson,
        countersJson: row.countersJson,
        resourceJson: row.resourceJson,
        errorText: row.errorText,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async getJobRunById(id: string): Promise<JobRunDetailResponse> {
    const row = await prisma.jobRun.findUnique({
      where: { id },
    });
    if (!row) {
      throw new DiscoveryAdminNotFoundError('Job run not found');
    }

    return {
      run: {
        id: row.id,
        jobName: row.jobName,
        startedAt: row.startedAt.toISOString(),
        finishedAt: row.finishedAt?.toISOString() ?? null,
        durationMs: row.durationMs ?? null,
        status: row.status,
        paramsJson: row.paramsJson,
        countersJson: row.countersJson,
        resourceJson: row.resourceJson,
        errorText: row.errorText,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      },
    };
  }

  async cancelDiscoveryRun(
    id: string,
    requestedByUserId?: string | undefined,
  ): Promise<CancelDiscoveryRunResult> {
    const run = await prisma.jobExecution.findFirst({
      where: {
        id,
        ...(requestedByUserId
          ? {
              payload: {
                path: ['requestedByUserId'],
                equals: requestedByUserId,
              },
            }
          : {}),
      },
      select: { status: true, result: true },
    });

    if (!run) {
      throw new DiscoveryAdminNotFoundError('Discovery run not found');
    }

    if (run.status === 'cancelled') {
      return {
        success: true,
        outcome: 'already_cancelled',
        terminalStatus: 'cancelled',
        cancelledPendingJobsCount: 0,
      };
    }

    const terminalStatuses = ['completed', 'failed'] as const;
    if (terminalStatuses.includes(run.status as (typeof terminalStatuses)[number])) {
      return {
        success: false,
        outcome: 'already_terminal',
        terminalStatus: run.status as 'completed' | 'failed',
        cancelledPendingJobsCount: 0,
      };
    }

    const now = new Date();
    const schema = readPgBossSchema();
    let cancelledPendingJobsCount = 0;
    let cancelledSearchTasksCount = 0;
    let queueCleanupError: string | null = null;
    let searchTaskCleanupError: string | null = null;

    try {
      const cleanupRows = await prisma.$queryRawUnsafe<Array<{ deleted_count: number }>>(
        `
          with deleted as (
            delete from ${schema}.job
            where state in ('created', 'retry', 'active')
              and name in (
                'discovery.seed',
                'discovery.run_search_task',
                'business.prequalify',
                'business.convert',
                'features.compute',
                'scoring.compute',
                'apollo.enrich',
                'message.generate',
                'message.send'
              )
              and (
                data ->> 'discoveryRunId' = $1
                or data ->> 'runId' = $2
                or singleton_key like $3
              )
            returning 1
          )
          select count(*)::int as deleted_count from deleted
        `,
        id,
        id,
        `%${id}%`,
      );
      cancelledPendingJobsCount = cleanupRows[0]?.deleted_count ?? 0;
    } catch (error: unknown) {
      queueCleanupError = error instanceof Error ? error.message : 'queue cleanup failed';
    }

    try {
      const searchTaskCleanup = await prisma.searchTask.updateMany({
        where: {
          discoveryRunId: id,
          status: { in: ['PENDING', 'RUNNING'] },
        },
        data: {
          status: 'FAILED',
          error: 'Cancelled: discovery run was cancelled',
        },
      });
      cancelledSearchTasksCount = searchTaskCleanup.count;
    } catch (error: unknown) {
      searchTaskCleanupError = error instanceof Error ? error.message : 'search task cleanup failed';
    }

    const existingResult =
      run.result && typeof run.result === 'object' && !Array.isArray(run.result)
        ? run.result as Record<string, unknown>
        : {};

    try {
      await prisma.jobExecution.update({
        where: { id },
        data: {
          status: 'cancelled',
          finishedAt: now,
          result: {
            ...existingResult,
            cancellation: {
              outcome: 'cancelled',
              cancelledAt: now.toISOString(),
              cancelledPendingJobsCount,
              cancelledSearchTasksCount,
              ...(queueCleanupError ? { queueCleanupError } : {}),
              ...(searchTaskCleanupError ? { searchTaskCleanupError } : {}),
            },
          } as Prisma.InputJsonValue,
        },
      });
    } catch {
      // Race-safe fallback: if another worker finalized the run concurrently,
      // return a deterministic non-500 cancel outcome.
      const latest = await prisma.jobExecution.findFirst({
        where: {
          id,
          ...(requestedByUserId
            ? {
                payload: {
                  path: ['requestedByUserId'],
                  equals: requestedByUserId,
                },
              }
            : {}),
        },
        select: { status: true },
      });
      if (latest?.status === 'cancelled') {
        return {
          success: true,
          outcome: 'already_cancelled',
          terminalStatus: 'cancelled',
          cancelledPendingJobsCount,
        };
      }
      if (latest && terminalStatuses.includes(latest.status as (typeof terminalStatuses)[number])) {
        return {
          success: false,
          outcome: 'already_terminal',
          terminalStatus: latest.status as 'completed' | 'failed',
          cancelledPendingJobsCount,
        };
      }
      throw new DiscoveryAdminBadRequestError('Unable to cancel run due to concurrent state update');
    }

    return {
      success: true,
      outcome: 'cancelled',
      terminalStatus: 'cancelled',
      cancelledPendingJobsCount,
    };
  }

  async getDiscoveryRunDetail(id: string) {
    const run = await prisma.jobExecution.findUnique({
      where: { id },
    });

    if (!run) {
      throw new DiscoveryAdminNotFoundError('Discovery run not found');
    }

    // Join: DiscoveryCostEvent (discoveryRunId, apiCallType='prequalify_check')
    //   → Business (via businessId) → BusinessConversion (via businessId) → Lead (via leadId)
    const costEvents = await prisma.discoveryCostEvent.findMany({
      where: {
        discoveryRunId: id,
        apiCallType: 'prequalify_check',
        businessId: { not: null },
      },
      select: {
        business: {
          select: {
            id: true,
            name: true,
            businessConversions: {
              select: {
                lead: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    status: true,
                    business: {
                      select: { name: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const seen = new Set<string>();
    const leads: DiscoveryRunLeadItem[] = [];

    for (const event of costEvents) {
      if (!event.business) continue;
      for (const conversion of event.business.businessConversions) {
        if (conversion.lead.status === 'rejected') continue;
        if (seen.has(conversion.lead.id)) continue;
        seen.add(conversion.lead.id);
        leads.push({
          id: conversion.lead.id,
          firstName: conversion.lead.firstName,
          lastName: conversion.lead.lastName,
          companyName: conversion.lead.business?.name ?? event.business.name,
        });
      }
    }

    return {
      run: {
        id: run.id,
        type: run.type,
        status: run.status,
        attempts: run.attempts,
        payload: run.payload,
        result: run.result,
        error: run.error,
        createdAt: run.createdAt.toISOString(),
        startedAt: run.startedAt?.toISOString() ?? null,
        finishedAt: run.finishedAt?.toISOString() ?? null,
        updatedAt: run.updatedAt.toISOString(),
      },
      leads,
    };
  }

  async approveContactRecoveryItem(
    id: string,
    approvedByUserId: string,
  ): Promise<{ leadId: string; businessName: string }> {
    // 1. Find the recovery item with its business and best candidate
    const recoveryItem = await prisma.contactRecoveryItem.findUnique({
      where: { id },
      include: {
        business: true,
      },
    });

    if (!recoveryItem) {
      throw new DiscoveryAdminNotFoundError(`Contact recovery item ${id} not found`);
    }

    if (recoveryItem.status !== 'OPEN') {
      throw new DiscoveryAdminBadRequestError(
        `Recovery item is ${recoveryItem.status}, only OPEN items can be approved`,
      );
    }

    // Guard: business may have been deleted since the recovery item was created
    if (!recoveryItem.business) {
      throw new DiscoveryAdminBadRequestError(
        'Business for this recovery item no longer exists',
      );
    }

    const business = recoveryItem.business;

    // 2. Get the snapshot data (contains topCandidates with contact info)
    const snapshot = recoveryItem.recoverySnapshot as Record<string, unknown> | null;
    const topCandidates = (snapshot?.topCandidates ?? []) as Array<{
      name: string;
      email?: string | null;
      phone?: string | null;
      title?: string | null;
      seniority?: string | null;
      linkedinUrl?: string | null;
      isSendable?: boolean;
    }>;

    // Pick the best candidate: prefer one with a sendable email
    const bestCandidate = topCandidates.find((c) => c.isSendable && c.email)
      ?? topCandidates[0]
      ?? null;

    // Extract name parts from candidate
    const candidateName = bestCandidate?.name ?? '';
    const nameParts = candidateName.split(/\s+/);
    const firstName = nameParts[0] ?? 'Unknown';
    const lastName = nameParts.slice(1).join(' ') || null;
    const email = bestCandidate?.email ?? null;
    const phone = bestCandidate?.phone ?? null;

    // Use full UUID to guarantee uniqueness when no real email available
    const leadEmail = email ?? `recovery-${recoveryItem.id}@placeholder.local`;

    // 3. Create the lead in a transaction, mark recovery item as approved
    try {
      const lead = await prisma.$transaction(async (tx) => {
        // Create lead from recovery business + candidate data
        const newLead = await tx.lead.create({
          data: {
            firstName,
            lastName: lastName ?? '',
            email: leadEmail,
            phone: phone ?? null,
            status: 'qualified',
            source: 'RECOVERY_APPROVED',
            businessId: recoveryItem.businessId,
            enrichmentData: JSON.parse(JSON.stringify({
              companyName: business.name,
              title: bestCandidate?.title ?? null,
              seniority: bestCandidate?.seniority ?? null,
              linkedinUrl: bestCandidate?.linkedinUrl ?? null,
              recoveryItemId: recoveryItem.id,
              approvedBy: approvedByUserId,
            })) as Prisma.InputJsonValue,
          },
        });

        // Mark recovery item as approved
        await tx.contactRecoveryItem.update({
          where: { id },
          data: {
            status: 'APPROVED',
          },
        });

        return newLead;
      });

      return {
        leadId: lead.id,
        businessName: business.name,
      };
    } catch (error: unknown) {
      // Log the actual error for debugging — raw 500s from approve are hard to trace
      console.error('[approveContactRecoveryItem] Error approving recovery item %s:', id, error);

      // P2002 = unique constraint violation — candidate's email already exists as a lead
      if (error instanceof PrismaRuntime.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existingLead = await prisma.lead.findFirst({
          where: { email: leadEmail },
          select: { id: true },
        });

        if (existingLead) {
          // Still mark the recovery item as approved so it doesn't stay OPEN
          await prisma.contactRecoveryItem.update({
            where: { id },
            data: {
              status: 'APPROVED',
            },
          });

          return {
            leadId: existingLead.id,
            businessName: business.name,
          };
        }
      }

      // P2003 = FK constraint violation (e.g. businessId no longer valid)
      if (error instanceof PrismaRuntime.PrismaClientKnownRequestError && error.code === 'P2003') {
        const meta = error.meta as Record<string, unknown> | undefined;
        const fieldName = (meta?.field_name as string) ?? 'unknown field';
        throw new DiscoveryAdminBadRequestError(
          `Cannot create lead from recovery item: foreign key constraint failed on ${fieldName}`,
        );
      }

      throw error;
    }
  }
}
