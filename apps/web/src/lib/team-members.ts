export interface TeamMemberLike {
  id: string;
  fullName: string;
  jobTitle: string | null;
  email: string | null;
  phone?: string | null | undefined;
  linkedinUrl: string | null;
  seniority?: string | null | undefined;
  source?: string | null | undefined;
}

function normalizeEmail(email: string | null | undefined): string | null {
  return email ? email.trim().toLowerCase() : null;
}

export function getDecisionMakerTier(title: string | null | undefined): number {
  if (!title) return 5;

  const lower = title.toLowerCase();

  if (/\b(ceo|chief executive officer|founder|co-founder|cofounder|owner|president|chair(?:man|woman|person)?|chair\b)/i.test(lower)) {
    return 0;
  }
  if (/\b(cfo|chief financial officer|coo|chief operating officer|cto|chief technology officer|cio|chief information officer|cmo|chief marketing officer|cpo|chief product officer|chief people officer|managing director|general manager)\b/i.test(lower)) {
    return 1;
  }
  if (/\b(vp|vice\s*president|head\s+of|head\b|svp|evp)\b/i.test(lower)) {
    return 2;
  }
  if (/\bdirector\b/i.test(lower)) {
    return 3;
  }
  if (/\b(manager|lead|supervisor)\b/i.test(lower)) {
    return 4;
  }
  return 5;
}

export function sortTeamMembers<T extends TeamMemberLike>(
  teamMembers: T[],
  selectedLeadEmail?: string | null | undefined,
): { ordered: T[]; primaryEmail: string | null } {
  const normalizedLeadEmail = normalizeEmail(selectedLeadEmail);

  const ordered = [...teamMembers].sort((a, b) => {
    const tierDiff = getDecisionMakerTier(a.jobTitle) - getDecisionMakerTier(b.jobTitle);
    if (tierDiff !== 0) return tierDiff;

    const leadMatchDiff =
      Number(normalizeEmail(b.email) === normalizedLeadEmail) -
      Number(normalizeEmail(a.email) === normalizedLeadEmail);
    if (leadMatchDiff !== 0) return leadMatchDiff;

    const emailDiff = Number(Boolean(b.email)) - Number(Boolean(a.email));
    if (emailDiff !== 0) return emailDiff;

    return a.fullName.localeCompare(b.fullName);
  });

  const primary = ordered[0] ?? null;
  return {
    ordered,
    primaryEmail: primary?.email ?? null,
  };
}
