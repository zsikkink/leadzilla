import type { FastifyReply, FastifyRequest } from 'fastify';

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

export interface AuthGuardOptions {
  /** Optional callback to verify user is still active/approved. Return false to reject. */
  checkUserActive?: ((userId: string) => Promise<boolean>) | undefined;
}

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
