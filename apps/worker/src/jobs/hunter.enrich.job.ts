import { prisma, toInputJson } from '@lead-flood/db';
import type { HunterDomainContact, HunterDomainSearchResult } from '@lead-flood/providers';
import type { Job, SendOptions } from 'pg-boss';

import { isProviderWithinBudget } from '../utils/pipeline-settings.js';

export const HUNTER_ENRICH_JOB_NAME = 'hunter.enrich';

export const HUNTER_ENRICH_RETRY_OPTIONS: Pick<
  SendOptions,
  'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'
> = {
  retryLimit: 2,
  retryDelay: 60,
  retryBackoff: true,
  deadLetter: 'hunter.enrich.dead_letter',
};

export interface HunterEnrichJobPayload {
  leadId: string;
  runId: string;
  requestedByUserId: string;
  correlationId?: string | undefined;
}

export interface HunterEnrichJobDependencies {
  hunterAdapter: {
    searchDomainContacts(domain: string): Promise<HunterDomainSearchResult>;
    isConfigured: boolean;
  };
}

export interface HunterEnrichLogger {
  info: (object: Record<string, unknown>, message: string) => void;
  warn: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
}

type BusinessContactCandidate = {
  email: string;
  firstName: string;
  lastName: string;
  name: string;
  title: string | null;
  seniority: 'executive' | 'director' | 'manager' | 'other';
  positionRank: number;
};

const EXECUTIVE_KEYWORDS = ['owner', 'founder', 'ceo', 'chief', 'president', 'managing director'] as const;
const DIRECTOR_KEYWORDS = ['director', 'head', 'vp', 'vice president', 'principal', 'partner'] as const;
const MANAGER_KEYWORDS = ['manager', 'lead', 'supervisor'] as const;
const GENERIC_EMAIL_LOCAL_PARTS = new Set([
  'admin',
  'contact',
  'hello',
  'hi',
  'info',
  'mail',
  'office',
  'sales',
  'support',
  'team',
]);

function normalizeDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    return parsed.hostname.replace(/^www\./, '') || null;
  } catch {
    return trimmed
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      ?.trim()
      || null;
  }
}

function inferSeniority(title: string | null): BusinessContactCandidate['seniority'] {
  if (!title) return 'other';
  const lower = title.toLowerCase();
  if (EXECUTIVE_KEYWORDS.some((keyword) => lower.includes(keyword))) return 'executive';
  if (DIRECTOR_KEYWORDS.some((keyword) => lower.includes(keyword))) return 'director';
  if (MANAGER_KEYWORDS.some((keyword) => lower.includes(keyword))) return 'manager';
  return 'other';
}

function positionRank(title: string | null): number {
  const seniority = inferSeniority(title);
  if (seniority === 'executive') return 0;
  if (seniority === 'director') return 1;
  if (seniority === 'manager') return 2;
  return 99;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function localPart(email: string): string {
  return normalizeEmail(email).split('@')[0] ?? '';
}

function isGenericEmail(email: string | null | undefined): boolean {
  if (!email || !email.includes('@')) return true;
  const local = localPart(email);
  return (
    email.endsWith('@lead-flood.invalid')
    || local.startsWith('no-email')
    || local.startsWith('unknown')
    || GENERIC_EMAIL_LOCAL_PARTS.has(local)
  );
}

function shouldReplaceLeadContact(lead: {
  firstName: string;
  lastName: string;
  email: string;
  decisionMakerTitle: string | null;
}): boolean {
  const name = `${lead.firstName} ${lead.lastName}`.trim().toLowerCase();
  return (
    isGenericEmail(lead.email)
    || name === ''
    || name === 'unknown contact'
    || name === 'generic contact'
  );
}

function toCandidate(contact: HunterDomainContact): BusinessContactCandidate | null {
  if (!contact.email || contact.type === 'generic') return null;
  const firstName = contact.firstName?.trim() ?? '';
  const lastName = contact.lastName?.trim() ?? '';
  const name = `${firstName} ${lastName}`.trim();
  if (!firstName || !lastName || !name) return null;

  return {
    email: normalizeEmail(contact.email),
    firstName,
    lastName,
    name,
    title: contact.position,
    seniority: inferSeniority(contact.position),
    positionRank: positionRank(contact.position),
  };
}

async function markRun(
  runId: string,
  data: {
    status: 'running' | 'completed' | 'failed';
    result?: unknown;
    error?: string | null;
  },
): Promise<void> {
  await prisma.jobExecution.updateMany({
    where: { id: runId },
    data: {
      status: data.status,
      ...(data.status === 'running' ? { startedAt: new Date() } : { finishedAt: new Date() }),
      ...(data.result !== undefined ? { result: toInputJson(data.result) } : {}),
      ...(data.error !== undefined ? { error: data.error } : {}),
    },
  });
}

export async function handleHunterEnrichJob(
  logger: HunterEnrichLogger,
  job: Job<HunterEnrichJobPayload>,
  deps?: HunterEnrichJobDependencies,
): Promise<void> {
  const { leadId, runId, requestedByUserId, correlationId } = job.data;
  const effectiveCorrelationId = correlationId ?? job.id;
  const logCtx = {
    jobId: job.id,
    queue: job.name,
    leadId,
    runId,
    correlationId: effectiveCorrelationId,
  };

  logger.info(logCtx, 'Started hunter.enrich job');
  await markRun(runId, { status: 'running', error: null });

  const lead = await prisma.lead.findFirst({
    where: { id: leadId, deletedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      decisionMakerTitle: true,
      businessId: true,
      business: {
        select: {
          id: true,
          name: true,
          websiteDomain: true,
        },
      },
    },
  });

  if (!lead || !lead.businessId || !lead.business) {
    logger.warn(logCtx, 'Lead or business missing — skipping hunter.enrich');
    await markRun(runId, {
      status: 'failed',
      error: 'Lead or business missing',
    });
    return;
  }

  const businessId = lead.businessId;
  const domain = normalizeDomain(lead.business.websiteDomain);
  if (!domain) {
    logger.warn(logCtx, 'Business has no domain — skipping hunter.enrich');
    await markRun(runId, {
      status: 'failed',
      error: 'Business has no domain',
    });
    return;
  }

  if (!deps?.hunterAdapter.isConfigured) {
    logger.warn(logCtx, 'Hunter adapter not configured — skipping hunter.enrich');
    await markRun(runId, {
      status: 'failed',
      error: 'Hunter adapter is not configured',
    });
    return;
  }

  const hunterWithinBudget = await isProviderWithinBudget('HUNTER');
  if (!hunterWithinBudget) {
    logger.warn(logCtx, 'Hunter daily budget ceiling exceeded — skipping hunter.enrich');
    await markRun(runId, {
      status: 'failed',
      error: 'Hunter daily budget ceiling exceeded',
    });
    return;
  }

  const hunterResult = await deps.hunterAdapter.searchDomainContacts(domain);
  if (hunterResult.status === 'retryable_error') {
    await markRun(runId, {
      status: 'failed',
      error: hunterResult.failure.message,
    });
    throw new Error(hunterResult.failure.message);
  }

  const requestKey = `hunter:manual:${leadId}:${runId}`;
  if (hunterResult.status === 'terminal_error') {
    await prisma.leadEnrichmentRecord.upsert({
      where: { requestKey },
      create: {
        leadId,
        provider: 'HUNTER',
        status: 'FAILED',
        requestKey,
        errorCode: hunterResult.failure.statusCode?.toString() ?? null,
        errorMessage: hunterResult.failure.message,
        rawPayload: toInputJson(hunterResult.failure.raw),
      },
      update: {
        status: 'FAILED',
        errorCode: hunterResult.failure.statusCode?.toString() ?? null,
        errorMessage: hunterResult.failure.message,
        rawPayload: toInputJson(hunterResult.failure.raw),
      },
    });
    await markRun(runId, {
      status: 'failed',
      error: hunterResult.failure.message,
    });
    return;
  }

  const contacts = hunterResult.contacts;
  const candidates = contacts
    .map(toCandidate)
    .filter((candidate): candidate is BusinessContactCandidate => candidate !== null);
  const candidateEmails = [...new Set(candidates.map((candidate) => candidate.email))];
  const existingContacts = candidateEmails.length > 0
    ? await prisma.businessContact.findMany({
        where: {
          businessId,
          email: { in: candidateEmails },
        },
        select: { email: true },
      })
    : [];
  const existingContactEmails = new Set(
    existingContacts
      .map((contact) => contact.email)
      .filter((email): email is string => Boolean(email))
      .map(normalizeEmail),
  );
  const newCandidates = candidates.filter((candidate) => !existingContactEmails.has(candidate.email));

  const topCandidate = candidates[0] ?? null;
  let leadUpdated = false;
  await prisma.$transaction(async (tx) => {
    await tx.discoveryCostEvent.create({
      data: {
        discoveryRunId: runId,
        provider: 'HUNTER',
        costCents: 3,
        apiCallType: 'manual_domain_search',
        businessId,
        leadId,
      },
    });

    await tx.leadEnrichmentRecord.upsert({
      where: { requestKey },
      create: {
        leadId,
        provider: 'HUNTER',
        status: 'COMPLETED',
        requestKey,
        normalizedPayload: toInputJson({
          contacts,
          source: 'manual_lead_enrich',
          domain,
          requestedByUserId,
        }),
        rawPayload: toInputJson(contacts),
        enrichedAt: new Date(),
      },
      update: {
        status: 'COMPLETED',
        normalizedPayload: toInputJson({
          contacts,
          source: 'manual_lead_enrich',
          domain,
          requestedByUserId,
        }),
        rawPayload: toInputJson(contacts),
        enrichedAt: new Date(),
      },
    });

    if (newCandidates.length > 0) {
      await tx.businessContact.createMany({
        data: newCandidates.map((candidate) => ({
          businessId,
          name: candidate.name,
          title: candidate.title,
          email: candidate.email,
          phone: null,
          linkedinUrl: null,
          seniority: candidate.seniority,
          positionRank: candidate.positionRank,
          source: 'hunter',
        })),
      });
    }

    await tx.businessConversion.updateMany({
      where: {
        businessId,
        leadId,
      },
      data: {
        hunterContactJson: toInputJson(contacts),
      },
    });

    if (topCandidate && shouldReplaceLeadContact(lead)) {
      const existingLeadWithEmail = await tx.lead.findFirst({
        where: {
          email: topCandidate.email,
          NOT: { id: leadId },
        },
        select: { id: true },
      });

      const updateResult = await tx.lead.updateMany({
        where: { id: leadId, deletedAt: null },
        data: {
          firstName: topCandidate.firstName,
          lastName: topCandidate.lastName,
          ...(existingLeadWithEmail ? {} : { email: topCandidate.email }),
          decisionMakerTitle: topCandidate.title,
        },
      });
      leadUpdated = updateResult.count > 0;
    }
  });

  await markRun(runId, {
    status: 'completed',
    result: {
      status: 'success',
      domain,
      contactsFound: contacts.length,
      contactsInserted: newCandidates.length,
      leadUpdated,
    },
    error: null,
  });

  logger.info(
    {
      ...logCtx,
      domain,
      contactsFound: contacts.length,
      contactsInserted: newCandidates.length,
      leadUpdated,
    },
    'Completed hunter.enrich job',
  );
}
