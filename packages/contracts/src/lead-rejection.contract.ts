import { z } from 'zod';

export const LeadRejectionReasonSchema = z.enum([
  'MANUAL',
  'WRONG_INDUSTRY',
  'WRONG_COUNTRY',
  'DUPLICATE_DOMAIN',
  'UNVERIFIED_CONTACT',
]);

export const RejectLeadRequestSchema = z.object({
  reason: LeadRejectionReasonSchema,
  metadata: z.record(z.unknown()).optional(),
});

export const LeadRejectionResponseSchema = z.object({
  id: z.string().min(1),
  leadId: z.string().min(1),
  reason: z.string().min(1),
  rejectedBy: z.string().min(1),
  rejectedAt: z.string().datetime(),
  score: z.number().nullable(),
  metadata: z.record(z.unknown()).nullable(),
});

export const ListRejectedLeadsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    reason: LeadRejectionReasonSchema.optional(),
  })
  .strict();

export type LeadRejectionReason = z.infer<typeof LeadRejectionReasonSchema>;
export type RejectLeadRequest = z.infer<typeof RejectLeadRequestSchema>;
export type LeadRejectionResponse = z.infer<typeof LeadRejectionResponseSchema>;
export type ListRejectedLeadsQuery = z.infer<typeof ListRejectedLeadsQuerySchema>;
