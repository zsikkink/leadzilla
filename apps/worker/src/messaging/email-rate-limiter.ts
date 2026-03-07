import type { prisma as prismaInstance } from '@lead-flood/db';

import type { RateLimitResult } from './rate-limiter.js';

type PrismaInstance = typeof prismaInstance;

export interface EmailRateLimiterConfig {
  /** Base emails/day in week 1 (default: 5) */
  baseDaily?: number | undefined;
  /** Increment per week (default: 5, so week 2 = 10, week 3 = 15, etc.) */
  weeklyIncrement?: number | undefined;
  /** Maximum daily cap regardless of warmup week (default: 100) */
  maxDaily?: number | undefined;
  /** Bounce rate threshold (0-1) — halve limit if exceeded (default: 0.02 = 2%) */
  bounceRateThreshold?: number | undefined;
}

const DEFAULT_BASE_DAILY = 5;
const DEFAULT_WEEKLY_INCREMENT = 5;
const DEFAULT_MAX_DAILY = 100;
const DEFAULT_BOUNCE_RATE_THRESHOLD = 0.02;

function getStartOfDayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function getStartOfNextDayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

function get24hAgo(): Date {
  return new Date(Date.now() - 24 * 60 * 60 * 1000);
}

/**
 * Compute which warmup week we're in (1-indexed).
 * Week 1 = days 0-6, Week 2 = days 7-13, etc.
 */
function computeWarmupWeek(warmupStart: Date, now: Date = new Date()): number {
  const daysSinceStart = Math.max(0, Math.floor((now.getTime() - warmupStart.getTime()) / (24 * 60 * 60 * 1000)));
  return Math.floor(daysSinceStart / 7) + 1;
}

export class EmailRateLimiter {
  private readonly prisma: PrismaInstance;
  private readonly baseDaily: number;
  private readonly weeklyIncrement: number;
  private readonly maxDaily: number;
  private readonly bounceRateThreshold: number;

  constructor(prisma: PrismaInstance, config?: EmailRateLimiterConfig) {
    this.prisma = prisma;
    this.baseDaily = config?.baseDaily ?? DEFAULT_BASE_DAILY;
    this.weeklyIncrement = config?.weeklyIncrement ?? DEFAULT_WEEKLY_INCREMENT;
    this.maxDaily = config?.maxDaily ?? DEFAULT_MAX_DAILY;
    this.bounceRateThreshold = config?.bounceRateThreshold ?? DEFAULT_BOUNCE_RATE_THRESHOLD;
  }

  /**
   * Compute the current daily send limit based on warmup week and bounce rate.
   * Reloads warmup start date from DB on every call so changes take effect immediately.
   */
  async computeDailyLimit(overrideMaxDaily?: number | undefined): Promise<{ limit: number; week: number; throttled: boolean }> {
    const effectiveMax = overrideMaxDaily ?? this.maxDaily;
    const warmupStartDate = await EmailRateLimiter.loadWarmupStartDate(this.prisma);
    const week = computeWarmupWeek(warmupStartDate);
    // Progressive ramp: week 1 = base, week 2 = base + increment, etc.
    let limit = Math.min(
      this.baseDaily + (week - 1) * this.weeklyIncrement,
      effectiveMax,
    );

    // Auto-throttle: if bounce rate in last 24h exceeds threshold, halve the limit
    let throttled = false;
    const since24h = get24hAgo();
    const [sentCount, bounceCount] = await Promise.all([
      this.prisma.messageSend.count({
        where: {
          channel: 'EMAIL',
          status: { in: ['SENT', 'DELIVERED', 'REPLIED', 'BOUNCED'] },
          createdAt: { gte: since24h },
        },
      }),
      this.prisma.feedbackEvent.count({
        where: {
          eventType: 'BOUNCED',
          occurredAt: { gte: since24h },
        },
      }),
    ]);

    if (sentCount > 0) {
      const bounceRate = bounceCount / sentCount;
      if (bounceRate > this.bounceRateThreshold) {
        limit = Math.max(1, Math.floor(limit / 2));
        throttled = true;
      }
    }

    return { limit, week, throttled };
  }

  async canSend(overrideMaxDaily?: number | undefined): Promise<RateLimitResult> {
    const { limit, week, throttled } = await this.computeDailyLimit(overrideMaxDaily);

    // Count today's email sends (UTC day boundary, all terminal statuses)
    const dayStartUtc = getStartOfDayUtc();
    const todayCount = await this.prisma.messageSend.count({
      where: {
        channel: 'EMAIL',
        status: { in: ['SENT', 'DELIVERED', 'REPLIED', 'BOUNCED'] },
        createdAt: { gte: dayStartUtc },
      },
    });

    if (todayCount >= limit) {
      return {
        allowed: false,
        nextWindowAt: getStartOfNextDayUtc(),
        reason: throttled
          ? `WARMUP_THROTTLED_BOUNCE_RATE (week ${week}, limit ${limit})`
          : `WARMUP_DAILY_LIMIT (week ${week}, limit ${limit})`,
      };
    }

    return { allowed: true };
  }

  /**
   * Read warmup start date from PipelineSetting table.
   * Falls back to current date if not set (starts warmup from today).
   */
  static async loadWarmupStartDate(prisma: PrismaInstance): Promise<Date> {
    try {
      const setting = await prisma.pipelineSetting.findUnique({
        where: { key: 'email_warmup_start_date' },
        select: { valueJson: true },
      });
      if (setting?.valueJson && typeof setting.valueJson === 'string') {
        const parsed = new Date(setting.valueJson);
        if (!isNaN(parsed.getTime())) return parsed;
      }
    } catch {
      // DB failure — fall back to now
    }
    return new Date();
  }
}
