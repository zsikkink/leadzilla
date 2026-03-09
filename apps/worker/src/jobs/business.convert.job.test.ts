import { describe, expect, it } from 'vitest';

import {
  calculateRecoveryEvidenceStrength,
  hasMaterialRecoveryEvidenceImprovement,
  isJunkPersonalEmail,
  isValidPersonName,
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
});
