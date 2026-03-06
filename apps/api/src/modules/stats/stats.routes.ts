import type { FastifyInstance } from 'fastify';
import { prisma } from '@lead-flood/db';
import { PipelineStatsResponseSchema, ErrorResponseSchema } from '@lead-flood/contracts';

export function registerStatsRoutes(app: FastifyInstance): void {
  app.get('/v1/stats/pipeline', async (request, reply) => {
    try {
      const [statusCounts, pendingApprovals] = await Promise.all([
        prisma.lead.groupBy({
          by: ['status'],
          _count: { id: true },
          where: { deletedAt: null },
        }),
        prisma.messageDraft.count({
          where: { approvalStatus: 'PENDING' },
        }),
      ]);

      const distribution = {
        discovered: 0,
        enriched: 0,
        scored: 0,
        messaged: 0,
      };

      for (const row of statusCounts) {
        const count = row._count.id;
        switch (row.status) {
          case 'new':
          case 'processing':
          case 'stuck':
            distribution.discovered += count;
            break;
          case 'enriched':
          case 'failed':
            distribution.enriched += count;
            break;
          case 'messaged':
            distribution.messaged += count;
            break;
          case 'replied':
          case 'cold':
            distribution.scored += count;
            break;
        }
      }

      return PipelineStatsResponseSchema.parse({
        leadDistribution: distribution,
        pendingApprovals,
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
