# LeadFlow Feature Extraction — Design Doc

**Date**: 2026-02-19
**Source**: maddiepriebe/leadflow (Express+BullMQ stack)
**Approach**: Reimplementing 3 features in our architecture (Fastify, pg-boss, repository pattern)

---

## Feature 1: Message Validation

**Problem**: message.generate.job.ts sends whatever OpenAI returns with zero checks. Known bug: if OpenAI fails, "Message generation pending" stub text gets persisted as a MessageVariant.

**Integration point**: `apps/worker/src/jobs/message.generate.job.ts` — after OpenAI generates variants, before persisting MessageVariant rows.

### Validation Rules

| Check | Type | Action |
|-------|------|--------|
| Placeholder patterns: `{name}`, `{{company}}`, `[NAME]`, `${var}`, `<Name>` | Hard reject | Retry once with stricter prompt → fallback template |
| Spam trigger words: FREE, ACT NOW, LIMITED TIME, GUARANTEED, WINNER, etc. | Hard reject | Retry once with stricter prompt → fallback template |
| Body equals "Message generation pending" | Hard reject | Skip retry, use fallback template immediately |
| Length exceeds limit (WhatsApp: 300 chars, Email: 500 chars) | Soft | Truncate at last sentence boundary within limit |
| Length below minimum (WhatsApp: 50 chars, Email: 100 chars) | Hard reject | Retry → fallback |
| Emoji count exceeds limit (WhatsApp: 3, Email: 1) | Soft | Strip excess emojis |

### Retry Flow

1. OpenAI generates `variant_a` and `variant_b`
2. Validate both variants
3. If any hard rejection: retry OpenAI once with appended instruction: "Do not use placeholders, spam words, or excessive emojis. Stay within N characters."
4. Validate retry results
5. If still failing: use fallback template for that channel
6. Persist only validated/cleaned variants

### Fallback Templates

New file: `apps/worker/src/messaging/fallback-templates.ts`

```typescript
// One template per channel. Simple professional messages with lead name + company interpolation.
// No placeholders — values are interpolated at generation time.
function getWhatsAppFallback(leadName: string, companyName: string): string
function getEmailFallback(leadName: string, companyName: string): { subject: string; body: string }
```

### Files to Create/Modify

| File | Action |
|------|--------|
| `apps/worker/src/messaging/validate-message.ts` | **Create** — validateMessageVariant() function |
| `apps/worker/src/messaging/fallback-templates.ts` | **Create** — per-channel fallback templates |
| `apps/worker/src/jobs/message.generate.job.ts` | **Modify** — add validation + retry + fallback between OpenAI call and MessageVariant persistence |

---

## Feature 2: Scoring Lift Analysis

**Problem**: Deterministic scoring uses fixed QualificationRule weights. No mechanism to auto-adjust weights based on what actually predicts conversions.

**Integration point**: `apps/worker/src/jobs/model.train.job.ts` — after logistic regression training, before enqueuing model.evaluate.

### Core Functions

New file: `apps/worker/src/scoring/lift-analysis.ts`

```typescript
interface FactorLift {
  factor: string;
  convertedFreq: number;
  nonConvertedFreq: number;
  lift: number; // (convertedFreq - nonConvertedFreq) / nonConvertedFreq
  sampleSize: number;
}

function computeFactorLift(
  convertedSnapshots: FeatureSnapshot[],
  nonConvertedSnapshots: FeatureSnapshot[]
): FactorLift[]

function adjustDeterministicWeights(
  currentWeights: Record<string, number>,
  liftResults: FactorLift[],
  options?: { maxChangePercent?: number; minWeight?: number; maxWeight?: number }
): Record<string, number>
// Defaults: maxChangePercent=0.3, minWeight=1, maxWeight=30
```

### Weight Adjustment Logic

- lift > 0.5 (strong positive): `adjustment = lift * 0.2` (capped at 0.3)
- lift > 0.1 (moderate positive): `adjustment = lift * 0.1` (capped at 0.15)
- lift < -0.3 (strong negative): `adjustment = lift * 0.2` (capped at -0.3)
- lift < -0.1 (moderate negative): `adjustment = lift * 0.1` (capped at -0.15)
- Otherwise: no change
- Final weight = currentWeight * (1 + adjustment), clamped to [minWeight, maxWeight]

### Integration into model.train.job.ts

After logistic regression training succeeds:
1. Split dataset into converted (label=1) and non-converted (label=0)
2. Extract feature snapshots for each group
3. Call `computeFactorLift(converted, nonConverted)`
4. Load current deterministic weights from latest active ModelVersion (or defaults)
5. Call `adjustDeterministicWeights(currentWeights, liftResults)`
6. Store adjusted weights in `deterministicWeightsJson` on the new ModelVersion

### Schema Check

`ModelVersion.deterministicWeightsJson` already exists as `Json` type — no migration needed.

### Files to Create/Modify

| File | Action |
|------|--------|
| `apps/worker/src/scoring/lift-analysis.ts` | **Create** — computeFactorLift + adjustDeterministicWeights |
| `apps/worker/src/jobs/model.train.job.ts` | **Modify** — call lift analysis after logistic regression, store weights |

---

## Feature 3: Conversation / Reply Viewing

**Problem**: After messages are sent, there's no way to see: (a) the actual message body, (b) reply text from leads, (c) a conversation thread. Reply text is in FeedbackEvent.replyText but not exposed via API or UI.

### 3a. Backend — Contract Updates

**feedback.contract.ts**: Add to FeedbackEventResponseSchema:
- `replyText` (string | null)
- `replyClassification` (string | null)

**messaging.contract.ts**: Add to MessageSendResponseSchema:
- `followUpNumber` (number | null)
- `nextFollowUpAfter` (string datetime | null)
- `providerConversationId` (string | null)

Update mappers in feedback.service.ts and messaging.service.ts.

### 3b. Backend — Conversations Endpoint

New endpoint: `GET /v1/messaging/conversations/:leadId`

Response: chronological array of:
```typescript
{
  type: 'sent' | 'reply';
  timestamp: string; // ISO datetime
  channel: 'EMAIL' | 'WHATSAPP';
  bodyText: string; // sent: from selected MessageVariant; reply: from FeedbackEvent.replyText
  subject?: string; // email only
  replyClassification?: string; // reply only
  status?: string; // sent only (QUEUED/SENT/DELIVERED/etc.)
  followUpNumber?: number; // sent only
}
```

Implementation: JOIN MessageSend (with MessageVariant where isSelected=true) + FeedbackEvent (where eventType=REPLIED), ORDER BY timestamp ASC.

### 3c. Frontend — Inbox Page

New page: `apps/web/app/dashboard/inbox/page.tsx`

**Left panel**: Conversation list grouped by lead
- Each row: lead name, last message preview (truncated), timestamp, channel badge (EMAIL/WHATSAPP)
- Reply count badge (count of REPLIED FeedbackEvents for that lead)
- Search bar (filter by lead name/email)
- Channel filter dropdown

**Right panel**: When lead selected, show chronological thread
- Sent messages: right-aligned blue bubbles
- Replies: left-aligned grey bubbles
- Each bubble: channel badge, timestamp
- Reply classification badge: INTERESTED=green, NOT_INTERESTED=red, OUT_OF_OFFICE=yellow, UNSUBSCRIBE=red

### 3d. Frontend — Lead Detail Improvements

Update `apps/web/app/dashboard/leads/[id]/page.tsx`:
- Show sent message body text in Activity Timeline (from selected MessageVariant)
- Show reply text instead of just "Reply Received"

### 3e. Frontend — Draft Card Improvements

Update `apps/web/src/components/message-draft-card.tsx`:
- Add lead name/email display

### 3f. Sidebar

Add "Inbox" link to `apps/web/src/components/sidebar.tsx` between Messages and ICP Profiles.

### Files to Create/Modify

| File | Action |
|------|--------|
| `packages/contracts/src/feedback.contract.ts` | **Modify** — add replyText, replyClassification to response schema |
| `packages/contracts/src/messaging.contract.ts` | **Modify** — add followUpNumber, nextFollowUpAfter, providerConversationId to response schema; add ConversationEntrySchema + endpoint schemas |
| `packages/contracts/src/index.ts` | **Modify** — export new schemas |
| `apps/api/src/modules/feedback/feedback.service.ts` | **Modify** — include new fields in mapper |
| `apps/api/src/modules/messaging/messaging.service.ts` | **Modify** — include new fields in mapper + add getConversation method |
| `apps/api/src/modules/messaging/messaging.routes.ts` | **Modify** — add GET /v1/messaging/conversations/:leadId |
| `apps/web/app/dashboard/inbox/page.tsx` | **Create** — inbox page |
| `apps/web/src/components/sidebar.tsx` | **Modify** — add Inbox nav item |
| `apps/web/app/dashboard/leads/[id]/page.tsx` | **Modify** — show message body + reply text |
| `apps/web/src/components/message-draft-card.tsx` | **Modify** — add lead name/email |
| `apps/web/src/lib/api-client.ts` | **Modify** — add getConversation method |

---

## Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Sequences | **Dropped** | Sticking to one platform per lead; existing follow-up system sufficient |
| Length limits | Soft truncate | Truncate at sentence boundary rather than reject — avoids excessive fallback usage |
| Placeholder/spam | Hard reject + retry | These indicate broken generation; retry with stricter prompt, then fallback |
| Emoji limits | Soft strip | Remove excess emojis rather than reject |
| "Message generation pending" | Hard reject → immediate fallback | Known bug — no retry since OpenAI already failed |
| Lift analysis weights | Auto-apply | Stored on new ModelVersion; takes effect when model.evaluate activates it |
| Read status tracking | Reply count badge | Simple badge showing REPLIED event count per lead — no new DB fields |
| Follow-up overlap | Skip enrolled leads | followup.check skips leads in active sequences (N/A now — sequences dropped) |
| Execution order | 1→3→2 (validation→lift→inbox) | Batch backend-only wins first, frontend-heavy feature last |
