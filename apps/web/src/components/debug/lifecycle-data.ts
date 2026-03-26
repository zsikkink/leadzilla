'use client';

import type { ApiClient } from '@/lib/api-client.js';

// ══════════════════════════════════════════════════════════════════════════════
//  Types for the enriched pipeline data we fetch from Supabase
// ══════════════════════════════════════════════════════════════════════════════

export interface SearchTaskData {
  queryText: string;
  provider: string;
  city: string | null;
  category: string | null;
  status: string;
}

export interface WebsiteScrapeData {
  pageTitle: string | null;
  description: string | null;
  aboutPageText: string | null;
  socialLinks: Array<{ platform: string; url: string }>;
  techStack: string[];
  emails: string[];
  phones: string[];
}

export interface InstagramScrapeData {
  bio: string | null;
  followerCount: number | null;
  followingCount: number | null;
  engagementRate: number | null;
  category: string | null;
  isVerified: boolean | null;
  isBusinessAccount: boolean | null;
  recentPostsCount: number | null;
  businessCategory: string | null;
}

export interface ApolloContact {
  name: string | null;
  title: string | null;
  email: string | null;
  company: string | null;
  linkedinUrl: string | null;
  phone: string | null;
}

export interface HunterContact {
  email: string;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  confidence: number;
  type: string | null;
}

export interface BraveSearchResult {
  title: string;
  link: string;
  snippet?: string | undefined;
}

export interface ApolloOrgEnrichment {
  name?: string | undefined;
  industry?: string | undefined;
  estimatedEmployees?: number | undefined;
  foundedYear?: number | undefined;
  annualRevenue?: string | undefined;
  city?: string | undefined;
  country?: string | undefined;
  linkedinUrl?: string | undefined;
  primaryPhone?: string | undefined;
  [key: string]: unknown;
}

export interface BusinessConversionData {
  method: string | null;
  businessInsights: string | null;
  apolloContacts: ApolloContact[];
  hunterContacts: HunterContact[];
  contactSource?: string | undefined;
  braveSearchResults: BraveSearchResult[];
  ceoMatch?: { name?: string | undefined; title?: string | undefined; linkedinUrl?: string | undefined; confidence?: number | undefined } | null | undefined;
  foundCsuiteDecisionMaker?: boolean | undefined;
  apolloOrgEnrichment?: ApolloOrgEnrichment | null | undefined;
}

export interface FeatureSnapshotData {
  featuresJson: Record<string, unknown>;
  snapshotVersion: number;
  sourceVersion: string;
  ruleMatchCount: number;
  hardFilterPassed: boolean;
  computedAt: string;
}

export interface RuleEvaluation {
  ruleId: string;
  fieldKey: string;
  operator: string;
  ruleType: string;
  matched: boolean;
  weightApplied: number;
  contribution: number;
  reasonCode: string;
}

export interface CategoryScoreData {
  matched: number;
  total: number;
  rate: number;
}

export interface ScoringData {
  deterministicScore: number;
  logisticScore: number;
  blendedScore: number;
  scoreBand: string;
  reasonsJson: {
    reasonCodes: string[];
    hardFilterPassed: boolean;
    categoryScores: Record<string, CategoryScoreData>;
    qualificationPath: string;
    usedTrainedModel: boolean;
    blendWeights: { deterministic: number; ai: number };
  };
  ruleEvaluation: RuleEvaluation[];
  predictedAt: string;
}

export interface MessageVariantData {
  id: string;
  variantKey: string;
  channel: string;
  subject: string | null;
  bodyText: string;
  qualityScore: number | null;
  isSelected: boolean;
}

export interface MessageDraftData {
  id: string;
  approvalStatus: string;
  promptVersion: string;
  generatedByModel: string;
  followUpNumber: number;
  createdAt: string;
  variants: MessageVariantData[];
}

export interface MessageSendData {
  id: string;
  channel: string;
  status: string;
  sentAt: string | null;
  deliveredAt: string | null;
  repliedAt: string | null;
  followUpNumber: number;
  failureCode: string | null;
  failureReason: string | null;
}

export interface FeedbackEventData {
  id: string;
  eventType: string;
  source: string;
  replyText: string | null;
  replyClassification: string | null;
  occurredAt: string;
}

export interface LeadLifecycleData {
  searchTask: SearchTaskData | null;
  websiteScrape: WebsiteScrapeData | null;
  instagramScrape: InstagramScrapeData | null;
  businessConversion: BusinessConversionData | null;
  featureSnapshot: FeatureSnapshotData | null;
  scoring: ScoringData | null;
  messageDrafts: MessageDraftData[];
  messageSends: MessageSendData[];
  feedbackEvents: FeedbackEventData[];
}

type LifecycleApiClient = Pick<
  ApiClient,
  | 'getLatestLeadDeterministicScore'
  | 'getLatestLeadFeatureSnapshot'
  | 'getLatestLeadScore'
  | 'listDrafts'
  | 'listFeedbackEvents'
  | 'listSends'
>;

// ══════════════════════════════════════════════════════════════════════════════
//  Supabase data fetching
// ══════════════════════════════════════════════════════════════════════════════

function _parseWebsiteScrape(json: unknown): WebsiteScrapeData | null {
  if (!json || typeof json !== 'object') return null;
  const data = json as Record<string, unknown>;
  return {
    pageTitle: (data.pageTitle as string) ?? (data.title as string) ?? null,
    description: (data.description as string) ?? (data.metaDescription as string) ?? null,
    aboutPageText: typeof data.aboutPageText === 'string' && data.aboutPageText.length > 0 ? data.aboutPageText.slice(0, 500) : null,
    socialLinks: Array.isArray(data.socialLinks) ? (data.socialLinks as Array<{ platform: string; url: string }>) : [],
    techStack: Array.isArray(data.techStack) ? (data.techStack as string[]) : [],
    emails: Array.isArray(data.emails) ? (data.emails as string[]) : [],
    phones: Array.isArray(data.phones) ? (data.phones as string[]) : [],
  };
}

function _parseInstagramScrape(json: unknown): InstagramScrapeData | null {
  if (!json || typeof json !== 'object') return null;
  const data = json as Record<string, unknown>;
  return {
    bio: (data.bio as string) ?? (data.biography as string) ?? null,
    followerCount: typeof data.followerCount === 'number' ? data.followerCount : typeof data.followersCount === 'number' ? data.followersCount : null,
    followingCount: typeof data.followingCount === 'number' ? data.followingCount : null,
    engagementRate: typeof data.engagementRate === 'number' ? data.engagementRate : null,
    category: (data.category as string) ?? (data.businessCategory as string) ?? null,
    isVerified: typeof data.isVerified === 'boolean' ? data.isVerified : null,
    isBusinessAccount: typeof data.isBusinessAccount === 'boolean' ? data.isBusinessAccount : typeof data.isBusiness === 'boolean' ? data.isBusiness : null,
    recentPostsCount: typeof data.postsCount === 'number' ? data.postsCount : typeof data.recentPostsCount === 'number' ? data.recentPostsCount : null,
    businessCategory: (data.businessCategory as string) ?? null,
  };
}

function _parseApolloContacts(json: unknown): ApolloContact[] {
  if (!json || typeof json !== 'object') return [];
  // apolloContactJson can be { contacts: [...] } or an array or a single contact
  const data = json as Record<string, unknown>;
  let contacts: unknown[] = [];
  if (Array.isArray(data)) {
    contacts = data;
  } else if (Array.isArray(data.contacts)) {
    contacts = data.contacts;
  } else if (Array.isArray(data.people)) {
    contacts = data.people;
  } else if (data.name || data.email || data.title) {
    contacts = [data];
  }
  return contacts.map((c) => {
    const contact = c as Record<string, unknown>;
    return {
      name: ((contact.first_name as string) ?? '') + (contact.last_name ? ` ${contact.last_name}` : '') || (contact.name as string) || null,
      title: (contact.title as string) ?? null,
      email: (contact.email as string) ?? null,
      company: (contact.organization_name as string) ?? (contact.company as string) ?? null,
      linkedinUrl: (contact.linkedin_url as string) ?? (contact.linkedinUrl as string) ?? null,
      phone: (contact.phone_number as string) ?? (contact.phone as string) ?? null,
    };
  }).filter((c) => c.name || c.email);
}

function _parseHunterContacts(json: unknown): HunterContact[] {
  if (!json || typeof json !== 'object') return [];
  const data = json as Record<string, unknown>;
  let emails: unknown[] = [];
  if (Array.isArray(data)) {
    emails = data;
  } else if (Array.isArray(data.emails)) {
    emails = data.emails;
  } else if (data.data && typeof data.data === 'object') {
    const inner = data.data as Record<string, unknown>;
    if (Array.isArray(inner.emails)) {
      emails = inner.emails;
    }
  }
  return emails.map((e) => {
    const entry = e as Record<string, unknown>;
    return {
      email: (entry.value as string) ?? (entry.email as string) ?? '',
      firstName: (entry.first_name as string) ?? (entry.firstName as string) ?? null,
      lastName: (entry.last_name as string) ?? (entry.lastName as string) ?? null,
      position: (entry.position as string) ?? (entry.title as string) ?? null,
      confidence: typeof entry.confidence === 'number' ? entry.confidence : 0,
      type: (entry.type as string) ?? null,
    };
  }).filter((e) => e.email);
}

async function collectAllPages<TItem>(
  loadPage: (page: number, pageSize: number) => Promise<{
    items: TItem[];
    page: number;
    pageSize: number;
    total: number;
  }>,
): Promise<TItem[]> {
  const pageSize = 100;
  const items: TItem[] = [];
  let page = 1;
  let total = 0;

  do {
    const response = await loadPage(page, pageSize);
    items.push(...response.items);
    total = response.total;

    if (response.items.length < response.pageSize) {
      break;
    }

    page += 1;
  } while (items.length < total);

  return items;
}

export async function fetchLeadLifecycleData(
  apiClient: LifecycleApiClient,
  leadId: string,
): Promise<LeadLifecycleData> {
  const result: LeadLifecycleData = {
    searchTask: null,
    websiteScrape: null,
    instagramScrape: null,
    businessConversion: null,
    featureSnapshot: null,
    scoring: null,
    messageDrafts: [],
    messageSends: [],
    feedbackEvents: [],
  };

  const [
    featureSnapshotResult,
    latestScoreResult,
    deterministicScoreResult,
    draftsResult,
    sendsResult,
    feedbackEventsResult,
  ] = await Promise.allSettled([
    apiClient.getLatestLeadFeatureSnapshot(leadId),
    apiClient.getLatestLeadScore(leadId),
    apiClient.getLatestLeadDeterministicScore(leadId),
    collectAllPages((page, pageSize) => apiClient.listDrafts({ leadId, page, pageSize })),
    collectAllPages((page, pageSize) => apiClient.listSends({ leadId, page, pageSize })),
    collectAllPages((page, pageSize) => apiClient.listFeedbackEvents({ leadId, page, pageSize })),
  ]);

  // Step 4: Feature snapshot (latest)
  if (featureSnapshotResult.status === 'fulfilled' && featureSnapshotResult.value.snapshot) {
    const snap = featureSnapshotResult.value.snapshot;
    result.featureSnapshot = {
      featuresJson: (typeof snap.featuresJson === 'object' && snap.featuresJson !== null
        ? snap.featuresJson
        : {}) as Record<string, unknown>,
      snapshotVersion: snap.snapshotVersion ?? 0,
      sourceVersion: snap.sourceVersion ?? '',
      ruleMatchCount: snap.ruleMatchCount ?? 0,
      hardFilterPassed: snap.hardFilterPassed ?? false,
      computedAt: snap.computedAt ?? '',
    };
  }

  // Step 5: Score prediction (latest)
  if (latestScoreResult.status === 'fulfilled' && latestScoreResult.value.prediction) {
    const pred = latestScoreResult.value.prediction;
    const reasons = (typeof pred.reasonsJson === 'object' && pred.reasonsJson !== null ? pred.reasonsJson : {}) as Record<string, unknown>;
    const blendWeightsRaw = reasons.blendWeights as Record<string, unknown> | undefined;
    result.scoring = {
      deterministicScore: pred.deterministicScore ?? 0,
      logisticScore: pred.logisticScore ?? 0,
      blendedScore: pred.blendedScore ?? 0,
      scoreBand: pred.scoreBand ?? 'LOW',
      reasonsJson: {
        reasonCodes: Array.isArray(reasons.reasonCodes) ? (reasons.reasonCodes as string[]) : [],
        hardFilterPassed: (reasons.hardFilterPassed as boolean) ?? false,
        categoryScores: (typeof reasons.categoryScores === 'object' && reasons.categoryScores !== null ? reasons.categoryScores : {}) as Record<string, CategoryScoreData>,
        qualificationPath: (reasons.qualificationPath as string) ?? 'UNKNOWN',
        usedTrainedModel: (reasons.usedTrainedModel as boolean) ?? false,
        blendWeights: {
          deterministic: (blendWeightsRaw?.deterministic as number) ?? 1,
          ai: (blendWeightsRaw?.ai as number) ?? 0,
        },
      },
      ruleEvaluation:
        deterministicScoreResult.status === 'fulfilled' && Array.isArray(deterministicScoreResult.value.ruleEvaluation)
          ? (deterministicScoreResult.value.ruleEvaluation as RuleEvaluation[])
          : [],
      predictedAt: pred.predictedAt ?? '',
    };
  }

  // Step 6: Message drafts with variants
  if (draftsResult.status === 'fulfilled') {
    result.messageDrafts = draftsResult.value.map((draft) => ({
      id: draft.id,
      approvalStatus: draft.approvalStatus ?? 'PENDING',
      promptVersion: draft.promptVersion ?? '',
      generatedByModel: draft.generatedByModel ?? '',
      followUpNumber: draft.followUpNumber ?? 0,
      createdAt: draft.createdAt ?? '',
      variants: draft.variants
        .slice()
        .sort((left, right) => Number(right.isSelected) - Number(left.isSelected))
        .map((variant) => ({
          id: variant.id,
          variantKey: variant.variantKey ?? '',
          channel: variant.channel ?? 'EMAIL',
          subject: variant.subject ?? null,
          bodyText: variant.bodyText ?? '',
          qualityScore: variant.qualityScore ?? null,
          isSelected: variant.isSelected ?? false,
        })),
    }));
  }

  // Step 7: Message sends
  if (sendsResult.status === 'fulfilled') {
    result.messageSends = sendsResult.value.map((send) => ({
      id: send.id,
      channel: send.channel ?? 'EMAIL',
      status: send.status ?? 'QUEUED',
      sentAt: send.sentAt ?? null,
      deliveredAt: send.deliveredAt ?? null,
      repliedAt: send.repliedAt ?? null,
      followUpNumber: send.followUpNumber ?? 0,
      failureCode: send.failureCode ?? null,
      failureReason: send.failureReason ?? null,
    }));
  }

  // Step 8: Feedback events
  if (feedbackEventsResult.status === 'fulfilled') {
    result.feedbackEvents = feedbackEventsResult.value.map((event) => ({
      id: event.id,
      eventType: event.eventType ?? 'UNKNOWN',
      source: event.source ?? 'UNKNOWN',
      replyText: event.replyText ?? null,
      replyClassification: event.replyClassification ?? null,
      occurredAt: event.occurredAt ?? '',
    }));
  }

  return result;
}
