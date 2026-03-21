import { timingSafeEqual } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';
import { ErrorResponseSchema } from '@lead-flood/contracts';
import { query } from '@lead-flood/db';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireAdminKey(
  request: FastifyRequest,
  reply: FastifyReply,
  adminApiKey: string | undefined,
): boolean {
  if (!adminApiKey) {
    reply.status(503).send(
      ErrorResponseSchema.parse({
        error: 'Admin API key not configured',
        requestId: request.id,
      }),
    );
    return false;
  }

  const provided = request.headers['x-admin-key'];
  const candidate = Array.isArray(provided) ? (provided[0] ?? '') : (provided ?? '');

  if (
    candidate.length === adminApiKey.length &&
    timingSafeEqual(Buffer.from(candidate, 'utf8'), Buffer.from(adminApiKey, 'utf8'))
  ) {
    return true;
  }

  reply.status(401).send(
    ErrorResponseSchema.parse({
      error: 'Unauthorized',
      requestId: request.id,
    }),
  );
  return false;
}

export async function isDiscoveryAdminUser(userId: string): Promise<boolean> {
  if (!UUID_RE.test(userId)) {
    return false;
  }

  const result = await query<{ isAdmin: boolean }>(
    `
      select exists (
        select 1
        from public.app_admins
        where user_id = $1::uuid
      ) as "isAdmin"
    `,
    [userId],
  );

  return result.rows[0]?.isAdmin === true;
}

export async function requireDiscoveryAdminAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  adminApiKey: string | undefined,
): Promise<boolean> {
  if (!requireAdminKey(request, reply, adminApiKey)) {
    return false;
  }

  const userId = request.user?.sub;
  if (!userId) {
    reply.status(401).send(
      ErrorResponseSchema.parse({
        error: 'Authentication required',
        requestId: request.id,
      }),
    );
    return false;
  }

  const isAdmin = await isDiscoveryAdminUser(userId);
  if (isAdmin) {
    return true;
  }

  reply.status(403).send(
    ErrorResponseSchema.parse({
      error: 'Forbidden',
      requestId: request.id,
    }),
  );
  return false;
}
