import { type Prisma, prisma } from '@lead-flood/db';

/**
 * Record a pipeline stage transition for a lead.
 * Best-effort — never throws. Pipeline tracing is observability,
 * not business logic, so failures are swallowed.
 */
export async function recordPipelineEvent(params: {
  leadId: string;
  stage: string;
  status: string;
  jobId?: string | null | undefined;
  durationMs?: number | null | undefined;
  metadata?: Record<string, unknown> | null | undefined;
}): Promise<void> {
  try {
    const metadataField = params.metadata
      ? { metadata: JSON.parse(JSON.stringify(params.metadata)) as Prisma.InputJsonValue }
      : {};

    await prisma.leadPipelineEvent.create({
      data: {
        leadId: params.leadId,
        stage: params.stage,
        status: params.status,
        jobId: params.jobId ?? null,
        durationMs: params.durationMs ?? null,
        ...metadataField,
      },
    });
  } catch {
    // Swallow — pipeline events are best-effort observability
  }
}
