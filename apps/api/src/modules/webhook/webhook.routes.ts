import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  ErrorResponseSchema,
  ResendWebhookPayloadSchema,
  ResendWebhookResponseSchema,
  TrengoWebhookPayloadSchema,
  TrengoWebhookResponseSchema,
} from '@lead-flood/contracts';

import {
  processResendWebhook,
  processTrengoWebhook,
  type WebhookServiceDependencies,
} from './webhook.service.js';

export interface WebhookRouteDependencies {
  trengoWebhookSecret?: string | undefined;
  resendWebhookSecret?: string | undefined;
  enqueueReplyClassify?: WebhookServiceDependencies['enqueueReplyClassify'];
  fetchResendReceivedEmail?: WebhookServiceDependencies['fetchResendReceivedEmail'];
}

function verifyTrengoSignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  if (!signature || !secret) {
    return false;
  }

  const expected = createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  try {
    return timingSafeEqual(
      Buffer.from(signature, 'utf8'),
      Buffer.from(expected, 'utf8'),
    );
  } catch {
    return false;
  }
}

/**
 * Verify Resend webhook signature (Svix format).
 *
 * Resend uses Svix for webhook delivery. Signature is computed as:
 *   HMAC-SHA256(base64decode(secret), "${svix_id}.${svix_timestamp}.${rawBody}")
 *
 * The `svix-signature` header contains one or more signatures prefixed with `v1,`.
 */
function verifyResendSignature(
  rawBody: string,
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
  secret: string,
): boolean {
  if (!svixId || !svixTimestamp || !svixSignature || !secret) {
    return false;
  }

  // Reject timestamps older than 5 minutes to prevent replay attacks
  const timestampSeconds = Number(svixTimestamp);
  if (Number.isNaN(timestampSeconds)) {
    return false;
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > 300) {
    return false;
  }

  // Svix secret is prefixed with "whsec_" and base64-encoded
  const secretBytes = Buffer.from(
    secret.startsWith('whsec_') ? secret.slice(6) : secret,
    'base64',
  );

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = createHmac('sha256', secretBytes)
    .update(signedContent)
    .digest('base64');

  // svix-signature may contain multiple signatures separated by spaces: "v1,<sig1> v1,<sig2>"
  const signatures = svixSignature.split(' ');

  for (const sig of signatures) {
    const parts = sig.split(',');
    if (parts[0] !== 'v1' || !parts[1]) continue;

    try {
      const sigBytes = Buffer.from(parts[1], 'base64');
      const expectedBytes = Buffer.from(expected, 'base64');
      if (sigBytes.length === expectedBytes.length && timingSafeEqual(sigBytes, expectedBytes)) {
        return true;
      }
    } catch {
      // Length mismatch or decode failure — try next signature
    }
  }

  return false;
}

function getRawBody(request: FastifyRequest): string {
  return (request as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(request.body);
}

export function registerWebhookRoutes(
  app: FastifyInstance,
  deps: WebhookRouteDependencies,
): void {
  // Capture raw body for HMAC verification — scoped to this plugin only
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    try {
      const raw = (body as Buffer).toString();
      (req as unknown as { rawBody: string }).rawBody = raw;
      const json = JSON.parse(raw) as unknown;
      done(null, json);
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // --- Trengo webhook ---
  if (deps.trengoWebhookSecret) {
    app.post('/v1/webhooks/trengo', { config: { rateLimit: { max: 200, timeWindow: '1 minute' } } }, async (request, reply) => {
      // Verify HMAC signature using the original raw body bytes
      const signature = request.headers['x-trengo-signature'] as string | undefined;
      const rawBody = getRawBody(request);

      if (!signature || !verifyTrengoSignature(rawBody, signature, deps.trengoWebhookSecret!)) {
        reply.status(401);
        return ErrorResponseSchema.parse({
          error: 'Invalid webhook signature',
          requestId: request.id,
        });
      }

      const parsed = TrengoWebhookPayloadSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400);
        return ErrorResponseSchema.parse({
          error: 'Invalid webhook payload',
          requestId: request.id,
        });
      }

      try {
        const result = await processTrengoWebhook(parsed.data, {
          enqueueReplyClassify: deps.enqueueReplyClassify,
        });

        request.log.info(
          {
            feedbackEventId: result.feedbackEventId,
            dedupeKey: result.dedupeKey,
            skipped: result.skipped,
            reason: result.reason,
          },
          'Processed Trengo webhook',
        );

        return TrengoWebhookResponseSchema.parse({ ok: true });
      } catch (error: unknown) {
        request.log.error({ error }, 'Trengo webhook processing failed');
        reply.status(500);
        return ErrorResponseSchema.parse({
          error: 'Webhook processing failed',
          requestId: request.id,
        });
      }
    });
  }

  // --- Resend webhook ---
  if (deps.resendWebhookSecret) {
    app.post('/v1/webhooks/resend', { config: { rateLimit: { max: 200, timeWindow: '1 minute' } } }, async (request, reply) => {
      const svixId = request.headers['svix-id'] as string | undefined;
      const svixTimestamp = request.headers['svix-timestamp'] as string | undefined;
      const svixSignature = request.headers['svix-signature'] as string | undefined;
      const rawBody = getRawBody(request);

      if (
        !svixId ||
        !svixTimestamp ||
        !svixSignature ||
        !verifyResendSignature(rawBody, svixId, svixTimestamp, svixSignature, deps.resendWebhookSecret!)
      ) {
        reply.status(401);
        return ErrorResponseSchema.parse({
          error: 'Invalid webhook signature',
          requestId: request.id,
        });
      }

      const parsed = ResendWebhookPayloadSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400);
        return ErrorResponseSchema.parse({
          error: 'Invalid webhook payload',
          requestId: request.id,
        });
      }

      try {
        const result = await processResendWebhook(parsed.data, {
          enqueueReplyClassify: deps.enqueueReplyClassify,
          fetchResendReceivedEmail: deps.fetchResendReceivedEmail,
        });

        request.log.info(
          {
            feedbackEventId: result.feedbackEventId,
            dedupeKey: result.dedupeKey,
            skipped: result.skipped,
            reason: result.reason,
            eventType: parsed.data.type,
          },
          'Processed Resend webhook',
        );

        return ResendWebhookResponseSchema.parse({ ok: true });
      } catch (error: unknown) {
        request.log.error({ error }, 'Resend webhook processing failed');
        reply.status(500);
        return ErrorResponseSchema.parse({
          error: 'Webhook processing failed',
          requestId: request.id,
        });
      }
    });
  }
}
