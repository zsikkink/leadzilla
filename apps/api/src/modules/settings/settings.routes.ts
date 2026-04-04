import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  getPipelineSetting,
  listPipelineSettings,
  upsertPipelineSetting,
} from '@lead-flood/db';
import { normalizeCountryCitiesMap } from '@lead-flood/contracts';

import { requireAppAdminAccess } from '../../auth/guard.js';

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

function normalizePipelineSettingValue(key: string, value: unknown): unknown {
  if (key === 'countryCities') {
    return normalizeCountryCitiesMap(value);
  }

  return value;
}

export function registerSettingsRoutes(app: FastifyInstance) {
  const requireAppAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAppAdminAccess(request, reply))) {
      return reply;
    }
  };

  // GET /v1/settings/pipeline — list all pipeline settings
  app.get('/v1/settings/pipeline', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const settings = await listPipelineSettings();

      return PipelineSettingsListResponseSchema.parse({
        items: settings.map((s: { key: string; valueJson: unknown; updatedAt: Date }) => ({
          key: s.key,
          value: normalizePipelineSettingValue(s.key, s.valueJson),
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
      const setting = await getPipelineSetting(key);

      if (!setting) {
        reply.status(404);
        return ErrorResponseSchema.parse({
          error: `Setting '${key}' not found`,
          requestId: request.id,
        });
      }

      return PipelineSettingResponseSchema.parse({
        key: setting.key,
        value: normalizePipelineSettingValue(setting.key, setting.valueJson),
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
  app.put('/v1/settings/pipeline/:key', { preHandler: requireAppAdmin }, async (request: FastifyRequest, reply: FastifyReply) => {
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
      const otherSetting = await getPipelineSetting(otherKey);
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
      const normalizedValue = normalizePipelineSettingValue(key, parseResult.data.value);
      const setting = await upsertPipelineSetting(key, normalizedValue);

      return PipelineSettingResponseSchema.parse({
        key: setting.key,
        value: normalizePipelineSettingValue(setting.key, setting.valueJson),
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
