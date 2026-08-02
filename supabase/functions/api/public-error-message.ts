export type PublicOperationalErrorContext =
  | 'delivery'
  | 'discovery_record'
  | 'discovery_run'
  | 'job'
  | 'lead'
  | 'search_task';

const PUBLIC_OPERATIONAL_ERROR_MESSAGES: Record<PublicOperationalErrorContext, string> = {
  delivery: 'Delivery was not completed.',
  discovery_record: 'Some discovery details are not available for this record.',
  discovery_run: 'Some run details are unavailable.',
  job: 'This task did not complete.',
  lead: 'Some enrichment details are not available for this lead.',
  search_task: 'This search task could not be completed.',
};

const PUBLIC_DELIVERY_FAILURE_CODES = new Set([
  'OUTBOUND_DISABLED',
  'SUPPRESSED',
]);

const OPERATIONAL_KEY_PATTERN =
  /^(?:error|errors|errorcode|errordescription|errormessage|errortext|exception|failurecode|failurereason|stack|stacktrace)$/i;
const OPERATIONAL_DETAIL_KEY_PATTERN = /^(?:code|details|hint|message)$/i;
const SENSITIVE_KEY_PATTERN =
  /(?:apikey|authorization|credentials?|password|secret|token|servicerolekey)$/i;
const INTERNAL_VALUE_PATTERN =
  /database query failed|duplicate key|unique constraint|violates foreign key|(?:postgres(?:ql)?|postgrest|prisma|serpapi|supabase).{0,80}(?:error|failed|failure|exception)|stack trace|failed to fetch|load failed|relation .+ does not exist|<html|authorization:\s*bearer/i;

const PUBLIC_OPERATIONAL_JSON_NOTICE = 'Operational details are unavailable.';

const PUBLIC_PIPELINE_SETTING_KEYS = new Set([
  'auto_approve_enabled',
  'auto_approve_score_max',
  'auto_approve_score_min',
  'countryCities',
  'deterministicAiBlend',
  'emailDailyLimit',
  'email_warmup_start_date',
  'enrichmentThreshold',
  'followUpMaxCount',
  'messagingBehaviorPrompt',
  'messagingInstructions',
  'messagingModel',
  'messagingRole',
  'messagingSystemPrompt',
  'messaging_manual_approval_only',
  'min_review_count',
  'modelActivationAuc',
  'providerBudgetCeiling',
  'scoreQualificationThreshold',
  'scoreTierBands',
  'scoringModel',
  'scoringSystemPrompt',
  'whatsappDailyLimit',
]);

export function isPublicPipelineSettingKey(value: unknown): value is string {
  return typeof value === 'string' && PUBLIC_PIPELINE_SETTING_KEYS.has(value);
}

function isEmptyOperationalValue(value: unknown): boolean {
  return (
    value === null
    || value === undefined
    || value === false
    || value === 0
    || (typeof value === 'string' && value.trim().length === 0)
    || (Array.isArray(value) && value.length === 0)
    || (
      typeof value === 'object'
      && !Array.isArray(value)
      && Object.keys(value as Record<string, unknown>).length === 0
    )
  );
}

export function toPublicOperationalError(
  value: unknown,
  context: PublicOperationalErrorContext,
): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  return PUBLIC_OPERATIONAL_ERROR_MESSAGES[context];
}

export function toPublicDeliveryFailureCode(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  return PUBLIC_DELIVERY_FAILURE_CODES.has(normalized)
    ? normalized
    : 'DELIVERY_NOT_COMPLETED';
}

export function sanitizePublicOperationalJson(
  value: unknown,
  parentContainsOperationalField = false,
): unknown {
  if (typeof value === 'string') {
    return INTERNAL_VALUE_PATTERN.test(value)
      ? PUBLIC_OPERATIONAL_JSON_NOTICE
      : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      sanitizePublicOperationalJson(item, parentContainsOperationalField)
    );
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const record = value as Record<string, unknown>;
  const containsOperationalField = Object.keys(record).some((key) =>
    OPERATIONAL_KEY_PATTERN.test(key.replace(/[^a-z0-9]/gi, ''))
  );

  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => {
      const normalizedKey = key.replace(/[^a-z0-9]/gi, '');
      const securityKey = key.replace(/[^a-z0-9]/gi, '');
      if (SENSITIVE_KEY_PATTERN.test(securityKey)) {
        return [key, item === null || item === undefined ? item : '[redacted]'];
      }
      if (OPERATIONAL_KEY_PATTERN.test(normalizedKey)) {
        return [
          key,
          isEmptyOperationalValue(item)
            ? item
            : PUBLIC_OPERATIONAL_JSON_NOTICE,
        ];
      }
      if (
        (parentContainsOperationalField || containsOperationalField) &&
        OPERATIONAL_DETAIL_KEY_PATTERN.test(normalizedKey)
      ) {
        return [
          key,
          item === null || item === undefined
            ? item
            : PUBLIC_OPERATIONAL_JSON_NOTICE,
        ];
      }
      return [
        key,
        sanitizePublicOperationalJson(
          item,
          parentContainsOperationalField || containsOperationalField,
        ),
      ];
    }),
  );
}
