import { query, type prisma as prismaInstance } from '@lead-flood/db';

type PrismaInstance = typeof prismaInstance;

interface CountRow {
  count: number | string;
}

function parseCount(value: number | string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

async function countWhatsAppSendsSince(since: Date): Promise<number> {
  const result = await query<CountRow>(
    `
      select count(*)::integer as count
      from public."MessageSend"
      where "channel" = 'WHATSAPP'
        and "status" = 'SENT'
        and "createdAt" >= $1
    `,
    [since],
  );

  return parseCount(result.rows[0]?.count ?? 0);
}

export interface WhatsAppRateLimiterConfig {
  dailySendLimit: number;
  /** UAE timezone offset in hours (UTC+4) */
  timezoneOffsetHours?: number | undefined;
  /** Business hours start (0-23, GST) */
  businessHoursStart?: number | undefined;
  /** Business hours end (0-23, GST) */
  businessHoursEnd?: number | undefined;
}

export interface RateLimitResult {
  allowed: boolean;
  nextWindowAt?: Date | undefined;
  reason?: string | undefined;
}

const UAE_OFFSET_HOURS = 4;
const DEFAULT_BIZ_START = 9;
const DEFAULT_BIZ_END = 18;

function getUaeNow(offsetHours: number): Date {
  const now = new Date();
  return new Date(now.getTime() + offsetHours * 60 * 60 * 1000);
}

function getStartOfDayUtc(uaeNow: Date, offsetHours: number): Date {
  const uaeYear = uaeNow.getUTCFullYear();
  const uaeMonth = uaeNow.getUTCMonth();
  const uaeDate = uaeNow.getUTCDate();
  // Start of UAE day in UTC
  return new Date(Date.UTC(uaeYear, uaeMonth, uaeDate) - offsetHours * 60 * 60 * 1000);
}

function getNextWindowUtc(
  uaeNow: Date,
  offsetHours: number,
  bizStartHour: number,
): Date {
  const uaeHour = uaeNow.getUTCHours();
  const uaeYear = uaeNow.getUTCFullYear();
  const uaeMonth = uaeNow.getUTCMonth();
  const uaeDate = uaeNow.getUTCDate();

  if (uaeHour >= bizStartHour) {
    // Next day's business start
    const nextDay = new Date(Date.UTC(uaeYear, uaeMonth, uaeDate + 1, bizStartHour));
    return new Date(nextDay.getTime() - offsetHours * 60 * 60 * 1000);
  }

  // Today's business start
  const today = new Date(Date.UTC(uaeYear, uaeMonth, uaeDate, bizStartHour));
  return new Date(today.getTime() - offsetHours * 60 * 60 * 1000);
}

export class WhatsAppRateLimiter {
  private readonly dailySendLimit: number;
  private readonly offsetHours: number;
  private readonly bizStart: number;
  private readonly bizEnd: number;

  constructor(prisma: PrismaInstance, config: WhatsAppRateLimiterConfig) {
    void prisma;
    this.dailySendLimit = config.dailySendLimit;
    this.offsetHours = config.timezoneOffsetHours ?? UAE_OFFSET_HOURS;
    this.bizStart = config.businessHoursStart ?? DEFAULT_BIZ_START;
    this.bizEnd = config.businessHoursEnd ?? DEFAULT_BIZ_END;
  }

  async canSend(overrideDailyLimit?: number | undefined): Promise<RateLimitResult> {
    const effectiveLimit = overrideDailyLimit ?? this.dailySendLimit;
    const uaeNow = getUaeNow(this.offsetHours);
    const uaeHour = uaeNow.getUTCHours();

    // Outside business hours?
    if (uaeHour < this.bizStart || uaeHour >= this.bizEnd) {
      return {
        allowed: false,
        nextWindowAt: getNextWindowUtc(uaeNow, this.offsetHours, this.bizStart),
        reason: 'OUTSIDE_BUSINESS_HOURS',
      };
    }

    // Count today's WhatsApp sends
    const dayStartUtc = getStartOfDayUtc(uaeNow, this.offsetHours);
    const count = await countWhatsAppSendsSince(dayStartUtc);

    if (count >= effectiveLimit) {
      return {
        allowed: false,
        nextWindowAt: getNextWindowUtc(uaeNow, this.offsetHours, this.bizStart),
        reason: 'DAILY_LIMIT_REACHED',
      };
    }

    return { allowed: true };
  }
}
