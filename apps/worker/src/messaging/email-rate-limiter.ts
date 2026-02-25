import type { prisma as prismaInstance } from '@lead-flood/db';

import type { RateLimitResult } from './rate-limiter.js';

type PrismaInstance = typeof prismaInstance;

export interface EmailRateLimiterConfig {
  /** Maximum emails per day (default: 10 for warm-up) */
  dailySendLimit?: number | undefined;
}

const DEFAULT_DAILY_LIMIT = 10;

function getStartOfDayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function getStartOfNextDayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

export class EmailRateLimiter {
  private readonly dailySendLimit: number;
  private readonly prisma: PrismaInstance;

  constructor(prisma: PrismaInstance, config?: EmailRateLimiterConfig) {
    this.prisma = prisma;
    this.dailySendLimit = config?.dailySendLimit ?? DEFAULT_DAILY_LIMIT;
  }

  async canSend(): Promise<RateLimitResult> {
    // Count today's email sends (UTC day boundary)
    const dayStartUtc = getStartOfDayUtc();
    const count = await this.prisma.messageSend.count({
      where: {
        channel: 'EMAIL',
        status: { in: ['SENT', 'QUEUED'] },
        createdAt: { gte: dayStartUtc },
      },
    });

    if (count >= this.dailySendLimit) {
      return {
        allowed: false,
        nextWindowAt: getStartOfNextDayUtc(),
        reason: 'DAILY_EMAIL_LIMIT_REACHED',
      };
    }

    return { allowed: true };
  }
}
