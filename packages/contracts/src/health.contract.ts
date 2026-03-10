import { z } from 'zod';

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
});

export const ReadySchemaHealthSchema = z.object({
  status: z.union([z.literal('ok'), z.literal('fail')]),
  missingTables: z.array(z.string()),
  missingEnumValues: z.array(z.string()),
});

export const ReadyResponseSchema = z.object({
  status: z.union([z.literal('ready'), z.literal('not_ready')]),
  db: z.union([z.literal('ok'), z.literal('fail')]),
  schema: ReadySchemaHealthSchema,
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type ReadySchemaHealth = z.infer<typeof ReadySchemaHealthSchema>;
export type ReadyResponse = z.infer<typeof ReadyResponseSchema>;
