'use client';

import type { SupabaseClient } from '@supabase/supabase-js';

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

export interface BusinessConversionData {
  method: string | null;
  businessInsights: string | null;
  apolloContacts: ApolloContact[];
  hunterContacts: HunterContact[];
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

// ══════════════════════════════════════════════════════════════════════════════
//  Supabase data fetching
// ══════════════════════════════════════════════════════════════════════════════

function parseWebsiteScrape(json: unknown): WebsiteScrapeData | null {
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

function parseInstagramScrape(json: unknown): InstagramScrapeData | null {
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

function parseApolloContacts(json: unknown): ApolloContact[] {
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

function parseHunterContacts(json: unknown): HunterContact[] {
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

export async function fetchLeadLifecycleData(
  supabase: SupabaseClient,
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

  // Step 1: Find business conversion for this lead
  const { data: conversions } = await supabase
    .from('business_conversions')
    .select('businessId, businessInsights, apolloContactJson, hunterContactJson')
    .eq('leadId', leadId)
    .limit(1);

  const conversion = conversions?.[0] ?? null;

  if (conversion) {
    result.businessConversion = {
      method: null,
      businessInsights: typeof conversion.businessInsights === 'string' ? conversion.businessInsights : null,
      apolloContacts: parseApolloContacts(conversion.apolloContactJson),
      hunterContacts: parseHunterContacts(conversion.hunterContactJson),
    };

    const bizId = conversion.businessId;

    if (bizId) {
      // Step 2: Get business record for scrape data
      const { data: business } = await supabase
        .from('businesses')
        .select('apify_website_scrape_json, apify_instagram_scrape_json')
        .eq('id', bizId)
        .single();

      if (business) {
        result.websiteScrape = parseWebsiteScrape(business.apify_website_scrape_json);
        result.instagramScrape = parseInstagramScrape(business.apify_instagram_scrape_json);

        // Step 3: Get search task via business_evidence (search_task_id lives there, not on businesses)
        const { data: evidence } = await supabase
          .from('business_evidence')
          .select('search_task_id')
          .eq('business_id', bizId)
          .not('search_task_id', 'is', null)
          .limit(1);

        const searchTaskId = evidence?.[0]?.search_task_id;
        if (searchTaskId) {
          const { data: searchTask } = await supabase
            .from('search_tasks')
            .select('query_text, city, status')
            .eq('id', searchTaskId)
            .single();

          if (searchTask) {
            result.searchTask = {
              queryText: searchTask.query_text ?? '',
              provider: 'UNKNOWN',
              city: searchTask.city ?? null,
              category: null,
              status: searchTask.status ?? 'UNKNOWN',
            };
          }
        }
      }
    }
  }

  // Step 4: Feature snapshot (latest)
  const { data: snapshots } = await supabase
    .from('LeadFeatureSnapshot')
    .select('featuresJson, snapshotVersion, sourceVersion, ruleMatchCount, hardFilterPassed, computedAt')
    .eq('leadId', leadId)
    .order('computedAt', { ascending: false })
    .limit(1);

  if (snapshots?.[0]) {
    const snap = snapshots[0];
    result.featureSnapshot = {
      featuresJson: (typeof snap.featuresJson === 'object' && snap.featuresJson !== null ? snap.featuresJson : {}) as Record<string, unknown>,
      snapshotVersion: snap.snapshotVersion ?? 0,
      sourceVersion: snap.sourceVersion ?? '',
      ruleMatchCount: snap.ruleMatchCount ?? 0,
      hardFilterPassed: snap.hardFilterPassed ?? false,
      computedAt: snap.computedAt ?? '',
    };
  }

  // Step 5: Score prediction (latest)
  const { data: predictions } = await supabase
    .from('LeadScorePrediction')
    .select('deterministicScore, logisticScore, blendedScore, scoreBand, reasonsJson, ruleEvaluationJson, predictedAt')
    .eq('leadId', leadId)
    .order('predictedAt', { ascending: false })
    .limit(1);

  if (predictions?.[0]) {
    const pred = predictions[0];
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
      ruleEvaluation: Array.isArray(pred.ruleEvaluationJson) ? (pred.ruleEvaluationJson as RuleEvaluation[]) : [],
      predictedAt: pred.predictedAt ?? '',
    };
  }

  // Step 6: Message drafts with variants
  const { data: drafts } = await supabase
    .from('MessageDraft')
    .select('id, approvalStatus, promptVersion, generatedByModel, followUpNumber, createdAt')
    .eq('leadId', leadId)
    .order('createdAt', { ascending: false });

  if (drafts && drafts.length > 0) {
    for (const draft of drafts) {
      const { data: variants } = await supabase
        .from('MessageVariant')
        .select('id, variantKey, channel, subject, bodyText, qualityScore, isSelected')
        .eq('messageDraftId', draft.id)
        .order('isSelected', { ascending: false });

      result.messageDrafts.push({
        id: draft.id,
        approvalStatus: draft.approvalStatus ?? 'PENDING',
        promptVersion: draft.promptVersion ?? '',
        generatedByModel: draft.generatedByModel ?? '',
        followUpNumber: draft.followUpNumber ?? 0,
        createdAt: draft.createdAt ?? '',
        variants: (variants ?? []).map((v) => ({
          id: v.id,
          variantKey: v.variantKey ?? '',
          channel: v.channel ?? 'EMAIL',
          subject: v.subject ?? null,
          bodyText: v.bodyText ?? '',
          qualityScore: v.qualityScore ?? null,
          isSelected: v.isSelected ?? false,
        })),
      });
    }
  }

  // Step 7: Message sends
  const { data: sends } = await supabase
    .from('MessageSend')
    .select('id, channel, status, sentAt, deliveredAt, repliedAt, followUpNumber, failureCode, failureReason')
    .eq('leadId', leadId)
    .order('createdAt', { ascending: false });

  if (sends) {
    result.messageSends = sends.map((s) => ({
      id: s.id,
      channel: s.channel ?? 'EMAIL',
      status: s.status ?? 'QUEUED',
      sentAt: s.sentAt ?? null,
      deliveredAt: s.deliveredAt ?? null,
      repliedAt: s.repliedAt ?? null,
      followUpNumber: s.followUpNumber ?? 0,
      failureCode: s.failureCode ?? null,
      failureReason: s.failureReason ?? null,
    }));
  }

  // Step 8: Feedback events
  const { data: events } = await supabase
    .from('FeedbackEvent')
    .select('id, eventType, source, replyText, replyClassification, occurredAt')
    .eq('leadId', leadId)
    .order('occurredAt', { ascending: false });

  if (events) {
    result.feedbackEvents = events.map((e) => ({
      id: e.id,
      eventType: e.eventType ?? 'UNKNOWN',
      source: e.source ?? 'UNKNOWN',
      replyText: e.replyText ?? null,
      replyClassification: e.replyClassification ?? null,
      occurredAt: e.occurredAt ?? '',
    }));
  }

  return result;
}
