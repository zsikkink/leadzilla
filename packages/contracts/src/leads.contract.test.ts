import { describe, expect, it } from 'vitest';

import {
  CreateLeadRequestSchema,
  CreateLeadResponseSchema,
  GetJobStatusResponseSchema,
  GetLeadResponseSchema,
} from './leads.contract.js';

describe('CreateLeadRequestSchema', () => {
  it('accepts valid input', () => {
    const parsed = CreateLeadRequestSchema.parse({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      source: 'manual',
    });

    expect(parsed.email).toBe('ada@example.com');
  });

  it('rejects invalid email', () => {
    expect(() =>
      CreateLeadRequestSchema.parse({
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'invalid',
        source: 'manual',
      }),
    ).toThrowError();
  });
});

describe('CreateLeadResponseSchema', () => {
  it('accepts response payload', () => {
    const parsed = CreateLeadResponseSchema.parse({
      leadId: 'lead_1',
      jobId: 'job_1',
    });

    expect(parsed.leadId).toBe('lead_1');
  });
});

describe('GetLeadResponseSchema', () => {
  it('accepts lead status payload', () => {
    const parsed = GetLeadResponseSchema.parse({
      id: 'lead_1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      source: 'manual',
      status: 'new',
      enrichmentData: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    expect(parsed.status).toBe('new');
  });

  it('accepts contact discovery metadata on lead detail payloads', () => {
    const parsed = GetLeadResponseSchema.parse({
      id: 'lead_1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      source: 'manual',
      status: 'qualified',
      enrichmentData: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      latestIcpProfileId: 'icp_1',
      phoneSource: 'APOLLO',
      businessEmail: 'hello@analytical-engines.example',
      contactDiscovery: {
        cseVerifyAttempted: true,
        cseVerifySucceeded: true,
        cseDiscoverAttempted: true,
        cseDiscoverSucceeded: false,
        cseRawResults: 7,
        cseValidProfiles: 3,
        cseCandidatesAdded: 2,
        cseCandidatesValidated: 2,
        cseEmailsInferred: 1,
        verificationVerdict: 'verified',
        supportingUrls: ['https://linkedin.com/in/ada-lovelace'],
        diagnostics: [
          {
            stage: 'DISCOVER',
            sourceFamily: 'linkedin',
            queryFamily: 'DISCOVER_ROLES',
            rawResultCount: 3,
            promotedCount: 1,
            verdict: 'verified',
          },
        ],
        topQueryFamily: 'DISCOVER_ROLES',
        topSourceFamily: 'linkedin',
        finalOutcome: 'lead_created',
        topCandidates: [
          {
            name: 'Ada Lovelace',
            title: 'Founder',
            sourceStage: 'V2',
            linkedinUrl: 'https://linkedin.com/in/ada-lovelace',
            email: 'ada@example.com',
            confidence: 0.94,
            matchedSignals: ['linkedin_profile', 'name_match'],
            verificationVerdict: 'verified',
            supportingUrls: ['https://linkedin.com/in/ada-lovelace'],
          },
        ],
      },
    });

    expect(parsed.contactDiscovery?.topCandidates).toHaveLength(1);
    expect(parsed.latestIcpProfileId).toBe('icp_1');
    expect(parsed.phoneSource).toBe('APOLLO');
    expect(parsed.businessEmail).toBe('hello@analytical-engines.example');
  });
});

describe('GetJobStatusResponseSchema', () => {
  it('accepts job status payload', () => {
    const now = new Date().toISOString();
    const parsed = GetJobStatusResponseSchema.parse({
      id: 'job_1',
      type: 'lead.enrich.stub',
      status: 'queued',
      attempts: 0,
      leadId: 'lead_1',
      result: null,
      error: null,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      updatedAt: now,
    });

    expect(parsed.type).toBe('lead.enrich.stub');
  });
});
