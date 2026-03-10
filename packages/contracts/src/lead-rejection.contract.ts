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

export const RejectedLeadListItemSchema = z
  .object({
    id: z.string().min(1),
    leadId: z.string().min(1),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    email: z.string(),
    companyName: z.string().nullable(),
    businessName: z.string().nullable(),
    websiteDomain: z.string().nullable(),
    category: z.string().nullable(),
    city: z.string().nullable(),
    country: z.string().nullable(),
    icpProfileId: z.string().nullable(),
    icpProfileName: z.string().nullable(),
    reason: z.string().min(1),
    reasonDetails: z.array(z.string()),
    score: z.number().nullable(),
    rejectedAt: z.string().datetime(),
  })
  .strict();

export const ListRejectedLeadsResponseSchema = z
  .object({
    items: z.array(RejectedLeadListItemSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().min(0),
  })
  .strict();

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
export type RejectedLeadListItem = z.infer<typeof RejectedLeadListItemSchema>;
export type ListRejectedLeadsResponse = z.infer<typeof ListRejectedLeadsResponseSchema>;
