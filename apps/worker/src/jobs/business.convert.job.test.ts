import { describe, expect, it } from 'vitest';

import {
  classifySeniorityLocal,
  getDecisionMakerTier,
  calculateRecoveryEvidenceStrength,
  hasMaterialRecoveryEvidenceImprovement,
  isJunkPersonalEmail,
  isValidPersonName,
  resolveRecoveryReasonWhenNoPersonalEmail,
} from './business.convert.job.js';

describe('contact recovery evidence helpers', () => {
  it('counts linkedin and sendable candidates correctly', () => {
    const strength = calculateRecoveryEvidenceStrength({
      evidenceScore: 0.71,
      topCandidates: [
        { name: 'Jane Doe', linkedinUrl: 'https://linkedin.com/in/jane', email: 'jane@example.com' },
        { name: 'John Doe', linkedinUrl: null, email: null },
      ],
    });

    expect(strength).toEqual({
      evidenceScore: 0.71,
      candidateCount: 2,
      linkedinCandidateCount: 1,
      sendableCandidateCount: 1,
      namedCandidateCount: 2,
    });
  });

  it('reopens recovery when evidence meaningfully improves', () => {
    const previous = {
      evidenceScore: 0.52,
      candidateCount: 1,
      linkedinCandidateCount: 0,
      sendableCandidateCount: 0,
      namedCandidateCount: 1,
    };

    const next = {
      evidenceScore: 0.6,
      candidateCount: 2,
      linkedinCandidateCount: 1,
      sendableCandidateCount: 0,
      namedCandidateCount: 2,
    };

    expect(hasMaterialRecoveryEvidenceImprovement(previous, next)).toBe(true);
  });

  it('keeps rejected recovery closed when evidence is effectively unchanged', () => {
    const previous = {
      evidenceScore: 0.6,
      candidateCount: 2,
      linkedinCandidateCount: 1,
      sendableCandidateCount: 0,
      namedCandidateCount: 2,
    };

    const next = {
      evidenceScore: 0.62,
      candidateCount: 2,
      linkedinCandidateCount: 1,
      sendableCandidateCount: 0,
      namedCandidateCount: 2,
    };

    expect(hasMaterialRecoveryEvidenceImprovement(previous, next)).toBe(false);
  });

  it('rejects obvious placeholder people extracted from websites', () => {
    expect(isValidPersonName('John Doe', 'Atlas Clinic')).toBe(false);
    expect(isValidPersonName('Contact Us', 'Atlas Clinic')).toBe(false);
    expect(isValidPersonName('Meet Sarah Malik', 'Atlas Clinic')).toBe(true);
  });

  it('rejects junk personal emails that should never become leads', () => {
    expect(isJunkPersonalEmail('john@doe.com')).toBe(true);
    expect(isJunkPersonalEmail('example@mysite.com')).toBe(true);
    expect(isJunkPersonalEmail('kate@atlasclinic.example')).toBe(false);
  });

  it('classifies executive titles with an explicit hierarchy', () => {
    expect(getDecisionMakerTier('Chief Executive Officer')).toBe(0);
    expect(getDecisionMakerTier('Founder')).toBe(0);
    expect(getDecisionMakerTier('Chief Information Officer')).toBe(1);
    expect(getDecisionMakerTier('Chief Financial Officer')).toBe(1);
    expect(getDecisionMakerTier('VP Revenue')).toBe(2);
    expect(getDecisionMakerTier('Head of Operations')).toBe(2);
    expect(getDecisionMakerTier('Legal Director')).toBe(3);
    expect(getDecisionMakerTier('Marketing Manager')).toBe(4);
    expect(getDecisionMakerTier('Marketing Coordinator')).toBe(5);
  });

  it('maps explicit hierarchy tiers into seniority buckets', () => {
    expect(classifySeniorityLocal('Chief Executive Officer')).toBe('executive');
    expect(classifySeniorityLocal('Chief Information Officer')).toBe('executive');
    expect(classifySeniorityLocal('Legal Director')).toBe('director');
    expect(classifySeniorityLocal('Marketing Manager')).toBe('manager');
    expect(classifySeniorityLocal('Marketing Coordinator')).toBe('other');
  });

  it('sets DECISION_MAKER_IDENTIFIED when top candidate is c-suite without email', () => {
    expect(
      resolveRecoveryReasonWhenNoPersonalEmail({
        resolvedContact: { positionRank: 1 },
      }),
    ).toBe('DECISION_MAKER_IDENTIFIED');
  });

  it('keeps NO_EMAIL for non-c-suite contacts without email', () => {
    expect(
      resolveRecoveryReasonWhenNoPersonalEmail({
        resolvedContact: { positionRank: 3 },
      }),
    ).toBe('NO_EMAIL');
  });

  it('uses NO_CONTACTS_FOUND when no contact is resolved', () => {
    expect(
      resolveRecoveryReasonWhenNoPersonalEmail({
        resolvedContact: null,
      }),
    ).toBe('NO_CONTACTS_FOUND');
  });
});
