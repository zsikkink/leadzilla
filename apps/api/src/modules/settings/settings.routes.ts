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

    // Auto-approve settings validation
    const { value } = parseResult.data;

    if (key === 'auto_approve_enabled') {
      if (typeof value !== 'boolean') {
        reply.status(400);
        return ErrorResponseSchema.parse({
          error: 'auto_approve_enabled must be a boolean',
          requestId: request.id,
        });
      }
    }

    if (key === 'auto_approve_score_min' || key === 'auto_approve_score_max') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        reply.status(400);
        return ErrorResponseSchema.parse({
          error: `${key} must be a number`,
          requestId: request.id,
        });
      }
      if (value > 1 || value < 0) {
        reply.status(400);
        return ErrorResponseSchema.parse({
          error: `${key} must be between 0 and 1 (inclusive)`,
          requestId: request.id,
        });
      }
    }

    // Cross-validate min <= max when setting either
    if (key === 'auto_approve_score_min' || key === 'auto_approve_score_max') {
      const numValue = value as number;
      const otherKey = key === 'auto_approve_score_min' ? 'auto_approve_score_max' : 'auto_approve_score_min';
      const otherSetting = await prisma.pipelineSetting.findUnique({ where: { key: otherKey } });
      const otherValue = otherSetting ? (otherSetting.valueJson as number) : null;

      if (otherValue !== null && typeof otherValue === 'number') {
        const min = key === 'auto_approve_score_min' ? numValue : otherValue;
        const max = key === 'auto_approve_score_max' ? numValue : otherValue;
        if (min > max) {
          reply.status(400);
          return ErrorResponseSchema.parse({
            error:
              key === 'auto_approve_score_min'
                ? 'auto_approve_score_min cannot be greater than auto_approve_score_max'
                : 'auto_approve_score_max cannot be less than auto_approve_score_min',
            requestId: request.id,
          });
        }
      }
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
