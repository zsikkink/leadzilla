# Session Prompt: Hunter Confidence Gating + Email Verification Gap Closure

## CONTEXT LOADING (do this FIRST):
- Read `CLAUDE.md` at project root
- Read `~/.claude/projects/-Users-os-architect-Desktop-OS-Architect-Projects-lead-flood/memory/MEMORY.md`
- Read `packages/providers/CLAUDE.md`
- Read `apps/worker/CLAUDE.md`

## OBJECTIVE
Close the email verification gaps in the lead creation pipeline. Currently:
- **Hunter/Apollo contacts bypass all email verification** — emails from paid providers go straight into the Lead table with zero SMTP or confidence checks
- **Manual leads (`POST /v1/leads`) have no deliverability check** — only Zod format validation
- Hunter's API returns `confidence` (0-100) and `verification` status per email, but we parse and discard those fields

This is a **zero additional API cost** fix — Hunter already returns this data in the response we pay for.

---

## TASK 1: Add `confidence` and `verification` to `HunterDomainContact`

**File**: `packages/providers/src/enrichment/hunter.adapter.ts`

### 1a. Update the interface (line 32-38):
```typescript
export interface HunterDomainContact {
  email: string;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  type: 'personal' | 'generic' | null;
  confidence: number | null;        // ADD — Hunter's 0-100 score
  verification: string | null;      // ADD — 'valid' | 'invalid' | 'unknown' | etc.
}
```

### 1b. Parse those fields in `searchDomainContacts()` (lines 289-308):
In the `.map()` callback where each email entry is parsed, extract:
```typescript
return {
  email,
  firstName: normalizeString(e.first_name),
  lastName: normalizeString(e.last_name),
  position: normalizeString(e.position),
  type: emailType,
  confidence: typeof e.confidence === 'number' ? e.confidence : null,
  verification: normalizeString(e.verification?.status ?? e.verification) ?? null,
};
```

Note: Hunter's domain-search API returns `confidence` as a number per email entry. The `verification` field structure may vary — handle both `e.verification` as a string and `e.verification.status` as an object with a status property. Check Hunter API docs if unsure, but the defensive parsing above covers both.

---

## TASK 2: Gate Hunter contacts by confidence in `business.convert`

**File**: `apps/worker/src/jobs/business.convert.job.ts`

### 2a. Update the local `HunterContact` interface (lines 56-62):
```typescript
interface HunterContact {
  email: string;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  type: 'personal' | 'generic' | null;
  confidence: number | null;        // ADD
  verification: string | null;      // ADD
}
```

### 2b. Add confidence gating in the Hunter fallback block (lines 636-663):
After `if (isGenericEmail(hc.email)) continue;` (line 642), add:

```typescript
// Skip emails Hunter marks as invalid or low-confidence
if (hc.verification === 'invalid') {
  logger.info(
    { ...logCtx, email: hc.email, hunterVerification: hc.verification },
    'Skipping Hunter contact — marked invalid by Hunter',
  );
  continue;
}
if (hc.confidence !== null && hc.confidence < 50) {
  logger.info(
    { ...logCtx, email: hc.email, hunterConfidence: hc.confidence },
    'Skipping Hunter contact — confidence below 50',
  );
  continue;
}
```

The threshold of 50 is conservative. Hunter's confidence below 50 means the email is likely guessed from a pattern and unverified. Emails with confidence >= 50 are either pattern-matched with some verification or directly found.

### 2c. Also SMTP-verify Hunter contacts (optional but recommended):
After the confidence gate, if `deps.smtpVerifier?.isConfigured`, run SMTP verification on Hunter contacts the same way we do for scraped emails. This catches cases where Hunter says confidence=80 but the mailbox no longer exists:

```typescript
// SMTP verify Hunter email if verifier is available
if (deps.smtpVerifier?.isConfigured) {
  const verification = await deps.smtpVerifier.verify(hc.email);
  if (verification.status !== 'valid' && verification.status !== 'catch_all') {
    logger.info(
      { ...logCtx, email: hc.email, smtpStatus: verification.status, hunterConfidence: hc.confidence },
      'Hunter contact failed SMTP verification',
    );
    continue; // Skip — don't add to allCandidates
  }
}
```

Place this AFTER the confidence gate (no point SMTP-verifying an email Hunter already marked as invalid).

### 2d. Do the same for Apollo contacts (lines 665-693):
Apollo doesn't return confidence scores, but we should still SMTP-verify Apollo emails. After `if (isGenericEmail(ac.email)) continue;` (line 671), add:

```typescript
if (deps.smtpVerifier?.isConfigured) {
  const verification = await deps.smtpVerifier.verify(ac.email);
  if (verification.status !== 'valid' && verification.status !== 'catch_all') {
    logger.info(
      { ...logCtx, email: ac.email, smtpStatus: verification.status },
      'Apollo contact failed SMTP verification',
    );
    continue;
  }
}
```

---

## TASK 3: Add SMTP verification to manual lead creation

**File**: `apps/api/src/index.ts`

Find the `createLeadAndEnqueue` handler (or the inline `POST /v1/leads` route handler). Currently it only does `z.string().email()` format validation.

### 3a. Import and instantiate the SMTP verifier:
The API cannot import from `@lead-flood/providers` (see API CLAUDE.md). The `SmtpVerifier` lives in `packages/providers/src/enrichment/smtp-verifier.ts`.

**Option A (preferred)**: Move `SmtpVerifier` to a shared package that the API CAN import, OR
**Option B**: The SMTP verifier uses only Node builtins (`dns`, `net`) — copy the `SmtpVerifier` class into the API package, OR
**Option C (simplest — do this one)**: Add `@lead-flood/providers` as a dependency of the API package for this one import. Check if this is already a dependency. If not, add it to `apps/api/package.json`:
```json
"@lead-flood/providers": "workspace:*"
```

Wait — re-read `apps/api/CLAUDE.md`: **"API can NOT import from @lead-flood/providers — not in package.json"**. This is a documented constraint. Do NOT add it.

**Do Option B instead**: Inline a minimal email deliverability check in the API. We don't need the full SMTP verifier — just MX record lookup + disposable domain check:

```typescript
import { promises as dns } from 'node:dns';

const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'yopmail.com', 'tempmail.com',
  'throwaway.email', 'guerrillamail.de', 'dispostable.com', 'temp-mail.org',
  'fakeinbox.com', 'sharklasers.com', 'guerrillamailblock.com',
  'grr.la', 'mailnesia.com', 'trashmail.com', 'maildrop.cc',
  // Add the 30 most common — this is a gate, not an exhaustive block
]);

async function isEmailDeliverable(email: string): Promise<{ ok: boolean; reason?: string }> {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return { ok: false, reason: 'INVALID_FORMAT' };

  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { ok: false, reason: 'DISPOSABLE_DOMAIN' };
  }

  try {
    const mx = await dns.resolveMx(domain);
    if (!mx || mx.length === 0) {
      return { ok: false, reason: 'NO_MX_RECORDS' };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'DNS_LOOKUP_FAILED' };
  }
}
```

### 3b. Call it in the route handler:
Before creating the lead, call `isEmailDeliverable()`. If `!ok`, return 422 with the reason:

```typescript
const deliverability = await isEmailDeliverable(body.email);
if (!deliverability.ok) {
  return reply.status(422).send({
    error: 'UNDELIVERABLE_EMAIL',
    reason: deliverability.reason,
    requestId: request.id,
  });
}
```

---

## TASK 4: Update tests

### 4a. Hunter adapter test:
Add a test verifying that `searchDomainContacts` returns `confidence` and `verification` fields from the raw API response.

### 4b. business.convert test:
Add test cases for:
- Hunter contact with `verification: 'invalid'` → skipped
- Hunter contact with `confidence: 30` → skipped
- Hunter contact with `confidence: 80, verification: 'valid'` → accepted
- Apollo contact failing SMTP verification → skipped

### 4c. API manual lead test:
Add test for `POST /v1/leads` with a disposable domain email → 422 response.

---

## VERIFY
```bash
export PATH="/Users/os_architect/.nvm/versions/node/v22.22.0/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Fix all errors before committing.

## COMMIT
```
feat: gate lead emails by Hunter confidence + SMTP verification

- Read Hunter confidence/verification fields (already in API response, zero cost)
- Skip Hunter contacts with confidence < 50 or verification=invalid
- SMTP-verify Hunter and Apollo contacts before lead creation
- Add MX + disposable check for manual leads (POST /v1/leads)
```
