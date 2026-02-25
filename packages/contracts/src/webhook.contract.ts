import { z } from 'zod';

export const TrengoWebhookContactSchema = z.object({
  phone: z.string().optional(),
}).passthrough();

export const TrengoWebhookMessageSchema = z.object({
  body: z.string().optional(),
}).passthrough();

export const TrengoWebhookDataSchema = z.object({
  id: z.number(),
  contact: TrengoWebhookContactSchema.optional(),
  message: TrengoWebhookMessageSchema.optional(),
  channel_id: z.number().optional(),
  conversation_id: z.number().optional(),
}).passthrough();

export const TrengoWebhookPayloadSchema = z.object({
  event: z.string(),
  data: TrengoWebhookDataSchema,
}).passthrough();

export const TrengoWebhookResponseSchema = z.object({
  ok: z.boolean(),
}).strict();

export type TrengoWebhookContact = z.infer<typeof TrengoWebhookContactSchema>;
export type TrengoWebhookMessage = z.infer<typeof TrengoWebhookMessageSchema>;
export type TrengoWebhookData = z.infer<typeof TrengoWebhookDataSchema>;
export type TrengoWebhookPayload = z.infer<typeof TrengoWebhookPayloadSchema>;
export type TrengoWebhookResponse = z.infer<typeof TrengoWebhookResponseSchema>;

// --- Resend webhook schemas ---

export const ResendWebhookBounceSchema = z.object({
  message: z.string().optional(),
  action: z.string().optional(),
}).passthrough();

export const ResendWebhookDataSchema = z.object({
  /** Resend message ID */
  email_id: z.string().optional(),
  /** Sender address */
  from: z.string().optional(),
  /** Recipient address(es) */
  to: z.array(z.string()).optional(),
  subject: z.string().optional(),
  created_at: z.string().optional(),
  bounce: ResendWebhookBounceSchema.optional(),
}).passthrough();

export const ResendWebhookPayloadSchema = z.object({
  type: z.string(),
  created_at: z.string().optional(),
  data: ResendWebhookDataSchema,
}).passthrough();

export const ResendWebhookResponseSchema = z.object({
  ok: z.boolean(),
}).strict();

export type ResendWebhookBounce = z.infer<typeof ResendWebhookBounceSchema>;
export type ResendWebhookData = z.infer<typeof ResendWebhookDataSchema>;
export type ResendWebhookPayload = z.infer<typeof ResendWebhookPayloadSchema>;
export type ResendWebhookResponse = z.infer<typeof ResendWebhookResponseSchema>;
