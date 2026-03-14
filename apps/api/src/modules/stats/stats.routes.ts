import type { FastifyInstance } from 'fastify';
import { getPipelineStatsSnapshot } from '@lead-flood/db';
import { PipelineStatsResponseSchema, ErrorResponseSchema } from '@lead-flood/contracts';

export function registerStatsRoutes(app: FastifyInstance): void {
  app.get('/v1/stats/pipeline', async (request, reply) => {
    try {
      const stats = await getPipelineStatsSnapshot();

      return PipelineStatsResponseSchema.parse({
        leadDistribution: stats.leadDistribution,
        pendingApprovals: stats.pendingApprovals,
      });
    } catch (error: unknown) {
      request.log.error({ error }, 'Failed to fetch pipeline stats');
      reply.status(500);
      return ErrorResponseSchema.parse({
        error: 'Failed to fetch pipeline stats',
        requestId: request.id,
      });
    }
  });
}
