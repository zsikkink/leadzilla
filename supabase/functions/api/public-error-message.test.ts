import {
  isPublicPipelineSettingKey,
  sanitizePublicOperationalJson,
  toPublicDeliveryFailureCode,
  toPublicOperationalError,
  type PublicOperationalErrorContext,
} from './public-error-message.ts';

Deno.test('operational errors never expose stored backend details', () => {
  const contexts: PublicOperationalErrorContext[] = [
    'delivery',
    'discovery_record',
    'discovery_run',
    'job',
    'lead',
    'search_task',
  ];
  const rawErrors = [
    'duplicate key value violates unique constraint "businesses_phone_e164_unique_not_null_idx" Key (phone_e164)=(+971500000000) already exists. Code: 23505',
    'SerpAPI quota exceeded for account customer@example.com',
    '<html><body>upstream gateway failure</body></html>',
    'Database query failed; Database query failed; relation businesses does not exist',
  ];

  for (const context of contexts) {
    for (const rawError of rawErrors) {
      const message = toPublicOperationalError(rawError, context);
      if (!message) {
        throw new Error(`Expected a public message for ${context}`);
      }
      if (
        message.includes('+971') ||
        message.includes('SerpAPI') ||
        message.includes('businesses_phone') ||
        message.includes('<html>')
      ) {
        throw new Error(`Raw backend details were exposed for ${context}`);
      }
    }
  }
});

Deno.test('missing operational errors stay absent', () => {
  if (toPublicOperationalError(null, 'job') !== null) {
    throw new Error('Expected null to remain null');
  }
  if (toPublicOperationalError('', 'job') !== null) {
    throw new Error('Expected an empty message to remain null');
  }
});

Deno.test('delivery failure codes expose only public-safe values', () => {
  if (toPublicDeliveryFailureCode('OUTBOUND_DISABLED') !== 'OUTBOUND_DISABLED') {
    throw new Error('Expected the demo safety code to remain explicit');
  }
  if (toPublicDeliveryFailureCode('SUPPRESSED') !== 'SUPPRESSED') {
    throw new Error('Expected the suppression safety code to remain explicit');
  }
  if (toPublicDeliveryFailureCode('400') !== 'DELIVERY_NOT_COMPLETED') {
    throw new Error('Expected provider status codes to be replaced');
  }
  if (
    toPublicDeliveryFailureCode('postgres duplicate key customer@example.com') !==
      'DELIVERY_NOT_COMPLETED'
  ) {
    throw new Error('Expected arbitrary failure codes to be replaced');
  }
});

Deno.test('operational JSON is sanitized without masking public business data', () => {
  const sanitized = sanitizePublicOperationalJson({
    business: {
      name: 'Sabuni',
      phone: '+971500000000',
      email: 'hello@sabuni.example',
      website: 'https://sabuni.example',
      instagram: '@sabuni',
    },
    provider: {
      error: 'duplicate key violates businesses_phone_idx',
      message: 'Postgres relation businesses does not exist',
      code: '23505',
      api_key: 'secret-provider-key',
    },
  }) as Record<string, Record<string, unknown>>;

  if (sanitized.business.phone !== '+971500000000') {
    throw new Error('Public business phone data was masked');
  }
  if (sanitized.business.email !== 'hello@sabuni.example') {
    throw new Error('Public business email data was masked');
  }
  if (sanitized.provider.error !== 'Operational details are unavailable.') {
    throw new Error('Expected provider error details to be replaced');
  }
  if (sanitized.provider.message !== 'Operational details are unavailable.') {
    throw new Error('Expected provider message details to be replaced');
  }
  if (sanitized.provider.api_key !== '[redacted]') {
    throw new Error('Expected provider credentials to be redacted');
  }
});

Deno.test('empty operational fields do not manufacture warning text', () => {
  const sanitized = sanitizePublicOperationalJson({
    error: '',
    errors: [],
    exception: {},
    failureCode: 0,
    failureReason: false,
  }) as Record<string, unknown>;

  if (
    sanitized.error !== ''
    || !Array.isArray(sanitized.errors)
    || sanitized.errors.length !== 0
    || Object.keys(sanitized.exception as Record<string, unknown>).length !== 0
    || sanitized.failureCode !== 0
    || sanitized.failureReason !== false
  ) {
    throw new Error('Expected empty operational values to remain empty');
  }
});

Deno.test('provider provenance remains visible while common secret keys are redacted', () => {
  const sanitized = sanitizePublicOperationalJson({
    source: 'supabase-edge-serpapi',
    access_token: 'access',
    refreshToken: 'refresh',
    client_secret: 'client',
    service_role_key: 'role',
    'x-api-key': 'api',
  }) as Record<string, unknown>;

  if (sanitized.source !== 'supabase-edge-serpapi') {
    throw new Error('Expected benign provider provenance to remain visible');
  }
  for (const key of ['access_token', 'refreshToken', 'client_secret', 'service_role_key', 'x-api-key']) {
    if (sanitized[key] !== '[redacted]') {
      throw new Error(`Expected ${key} to be redacted`);
    }
  }
});

Deno.test('only recruiter-safe pipeline settings are exposed', () => {
  if (!isPublicPipelineSettingKey('scoreQualificationThreshold')) {
    throw new Error('Expected a public demo setting to remain available');
  }
  if (isPublicPipelineSettingKey('OPENAI_API_KEY') || isPublicPipelineSettingKey('access_token')) {
    throw new Error('Expected sensitive setting keys to remain private');
  }
});

Deno.test('alternate operational keys and nested diagnostic arrays are sanitized', () => {
  const sanitized = sanitizePublicOperationalJson({
    'error-message': 'provider account customer@example.com failed',
    error_description: 'relation workspace_secrets does not exist',
    diagnostics: [{
      error: 'request failed',
      attempts: [{
        message: 'authorization: bearer private-token',
        details: 'stack trace at provider.ts:42',
      }],
    }],
  }) as Record<string, unknown>;

  if (
    sanitized['error-message'] !== 'Operational details are unavailable.'
    || sanitized.error_description !== 'Operational details are unavailable.'
  ) {
    throw new Error('Expected alternate operational error keys to be sanitized');
  }
  const diagnostics = sanitized.diagnostics as Array<Record<string, unknown>>;
  const attempts = diagnostics[0]?.attempts as Array<Record<string, unknown>>;
  if (
    attempts[0]?.message !== 'Operational details are unavailable.'
    || attempts[0]?.details !== 'Operational details are unavailable.'
  ) {
    throw new Error('Expected nested diagnostic arrays to inherit operational context');
  }
});
