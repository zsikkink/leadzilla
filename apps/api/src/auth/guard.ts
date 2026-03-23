import type { FastifyReply, FastifyRequest } from 'fastify';
import { ErrorResponseSchema } from '@lead-flood/contracts';
import { query } from '@lead-flood/db';

export interface AuthUser {
  sub: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

export type VerifyAccessToken = (token: string) => Promise<AuthUser | null>;
export type AppAdminGuard = (request: FastifyRequest, reply: FastifyReply) => Promise<boolean>;

export interface AuthGuardOptions {
  /** Optional callback to verify user is still active/approved. Return false to reject. */
  checkUserActive?: ((userId: string) => Promise<boolean>) | undefined;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function buildAuthGuard(
  verifyAccessToken: VerifyAccessToken,
  options?: AuthGuardOptions,
) {
  return async function authGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      reply.status(401).send({ error: 'Missing or invalid Authorization header' });
      return;
    }

    const token = authHeader.slice(7);
    const user = await verifyAccessToken(token);
    if (!user) {
      reply.status(401).send({ error: 'Invalid token' });
      return;
    }

    if (options?.checkUserActive) {
      const isActive = await options.checkUserActive(user.sub);
      if (!isActive) {
        reply.status(401).send({ error: 'Account is deactivated or pending approval' });
        return;
      }
    }

    request.user = user;
  };
}

export async function isAppAdminUser(userId: string): Promise<boolean> {
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

export const requireAppAdminAccess: AppAdminGuard = async (
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> => {
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

  const isAdmin = await isAppAdminUser(userId);
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
};
