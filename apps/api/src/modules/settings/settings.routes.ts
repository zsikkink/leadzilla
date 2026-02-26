import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '@lead-flood/db';

const ErrorResponseSchema = z.object({
  error: z.string(),
  requestId: z.string(),
});

const PipelineSettingResponseSchema = z.object({
  key: z.string(),
  value: z.unknown(),
  updatedAt: z.string(),
});

const PipelineSettingsListResponseSchema = z.object({
  items: z.array(PipelineSettingResponseSchema),
});

const UpdatePipelineSettingBodySchema = z.object({
  value: z.unknown(),
});

export function registerSettingsRoutes(app: FastifyInstance) {
  // GET /v1/settings/pipeline — list all pipeline settings
  app.get('/v1/settings/pipeline', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const settings = await prisma.pipelineSetting.findMany({
        orderBy: { key: 'asc' },
      });

      return PipelineSettingsListResponseSchema.parse({
        items: settings.map((s) => ({
          key: s.key,
          value: s.valueJson,
          updatedAt: s.updatedAt.toISOString(),
        })),
      });
    } catch (error) {
      request.log.error({ error }, 'Failed to list pipeline settings');
      reply.status(500);
      return ErrorResponseSchema.parse({
        error: 'Internal server error',
        requestId: request.id,
      });
    }
  });

  // GET /v1/settings/pipeline/:key — get a single pipeline setting
  app.get('/v1/settings/pipeline/:key', async (request: FastifyRequest, reply: FastifyReply) => {
    const { key } = request.params as { key: string };

    try {
      const setting = await prisma.pipelineSetting.findUnique({
        where: { key },
      });

      if (!setting) {
        reply.status(404);
        return ErrorResponseSchema.parse({
          error: `Setting '${key}' not found`,
          requestId: request.id,
        });
      }

      return PipelineSettingResponseSchema.parse({
        key: setting.key,
        value: setting.valueJson,
        updatedAt: setting.updatedAt.toISOString(),
      });
    } catch (error) {
      request.log.error({ error, key }, 'Failed to get pipeline setting');
      reply.status(500);
      return ErrorResponseSchema.parse({
        error: 'Internal server error',
        requestId: request.id,
      });
    }
  });

  // PUT /v1/settings/pipeline/:key — upsert a pipeline setting
  app.put('/v1/settings/pipeline/:key', async (request: FastifyRequest, reply: FastifyReply) => {
    const { key } = request.params as { key: string };
    const parseResult = UpdatePipelineSettingBodySchema.safeParse(request.body);

    if (!parseResult.success) {
      reply.status(400);
      return ErrorResponseSchema.parse({
        error: `Invalid request body: ${parseResult.error.issues.map((i) => i.message).join(', ')}`,
        requestId: request.id,
      });
    }

    try {
      const setting = await prisma.pipelineSetting.upsert({
        where: { key },
        create: {
          key,
          valueJson: parseResult.data.value as never,
        },
        update: {
          valueJson: parseResult.data.value as never,
        },
      });

      return PipelineSettingResponseSchema.parse({
        key: setting.key,
        value: setting.valueJson,
        updatedAt: setting.updatedAt.toISOString(),
      });
    } catch (error) {
      request.log.error({ error, key }, 'Failed to update pipeline setting');
      reply.status(500);
      return ErrorResponseSchema.parse({
        error: 'Internal server error',
        requestId: request.id,
      });
    }
  });
}
