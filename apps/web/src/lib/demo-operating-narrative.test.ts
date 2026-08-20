import { describe, expect, it } from 'vitest';

import { DEMO_ANALYTICS_DASHBOARD_SNAPSHOT } from './demo-dashboard-snapshots.js';
import {
  DEMO_DATABASE_SNAPSHOT,
  DEMO_INBOX_CONVERSATIONS,
  DEMO_INBOX_DRAFTS,
  DEMO_INBOX_LEADS,
  DEMO_LEAD_PORTFOLIO,
  DEMO_LEAD_PORTFOLIO_TOTAL,
  DEMO_DASHBOARD_TREND_BUCKETS,
  DEMO_LEADS,
  DEMO_OPERATING_MONTHS,
  DEMO_OPERATING_TOTALS,
} from './demo-operating-narrative.js';

describe('two-month recruiter operating narrative', () => {
  it('reconciles every monthly acquisition cohort', () => {
    expect(DEMO_OPERATING_MONTHS).toHaveLength(2);
    expect(new Set(DEMO_OPERATING_MONTHS.map((month) => month.month)).size).toBe(2);

    for (const month of DEMO_OPERATING_MONTHS) {
      expect(month.sourceRecords).toBe(month.duplicatesMerged + month.screened);
      expect(month.screened).toBe(month.disqualified + month.scored);
      expect(month.priority).toBeLessThanOrEqual(month.scored);
      expect(month.replies).toBeLessThanOrEqual(month.sent);
      expect(month.meetings).toBeLessThanOrEqual(month.replies);
    }

    expect(DEMO_OPERATING_TOTALS).toMatchObject({
      sourceRecords: 5007,
      duplicatesMerged: 0,
      screened: 5007,
      disqualified: 479,
      scored: 4528,
      priority: 2528,
      drafts: 189,
      sent: 165,
      replies: 23,
      meetings: 6,
      pendingReview: 12,
    });
    expect(DEMO_OPERATING_TOTALS.screened).toBe(DEMO_DATABASE_SNAPSHOT.databaseLeads);
    expect(DEMO_OPERATING_TOTALS.disqualified).toBe(DEMO_DATABASE_SNAPSHOT.rejectedLeads);
    expect(DEMO_OPERATING_TOTALS.scored).toBe(DEMO_DATABASE_SNAPSHOT.scoredLeads);
    expect(DEMO_OPERATING_TOTALS.priority).toBe(DEMO_DATABASE_SNAPSHOT.highPriorityLeads);
    expect(DEMO_OPERATING_TOTALS.drafts).toBe(DEMO_DATABASE_SNAPSHOT.messageDrafts);
    expect(DEMO_OPERATING_TOTALS.scored).toBe(
      DEMO_OPERATING_TOTALS.highFit
      + DEMO_OPERATING_TOTALS.mediumFit
      + DEMO_OPERATING_TOTALS.lowFit,
    );
    expect(DEMO_DASHBOARD_TREND_BUCKETS).toHaveLength(61);
    expect(DEMO_DASHBOARD_TREND_BUCKETS.at(0)?.date).toBe('2026-06-01');
    expect(DEMO_DASHBOARD_TREND_BUCKETS.at(-1)?.date).toBe('2026-07-31');
    expect(DEMO_DASHBOARD_TREND_BUCKETS.reduce((total, bucket) => total + bucket.Activated, 0))
      .toBe(DEMO_OPERATING_TOTALS.screened);
    expect(DEMO_DASHBOARD_TREND_BUCKETS.reduce((total, bucket) => total + bucket.Qualified, 0))
      .toBe(DEMO_OPERATING_TOTALS.scored);
    expect(DEMO_DASHBOARD_TREND_BUCKETS.reduce((total, bucket) => total + bucket.Rejected, 0))
      .toBe(DEMO_OPERATING_TOTALS.disqualified);
    expect(DEMO_DASHBOARD_TREND_BUCKETS.reduce((total, bucket) => total + bucket.Sent, 0))
      .toBe(DEMO_OPERATING_TOTALS.sent);
    expect(DEMO_DASHBOARD_TREND_BUCKETS.reduce((total, bucket) => total + bucket.Replied, 0))
      .toBe(DEMO_OPERATING_TOTALS.replies);

    const qualificationBusinessDays = DEMO_DASHBOARD_TREND_BUCKETS.filter((bucket) => bucket.Activated > 0);
    expect(qualificationBusinessDays.map((bucket) => bucket.Activated)).toEqual([
      35, 157, 63, 136, 49, 174, 44, 118, 153, 53, 93,
      165, 31, 129, 71, 146, 39, 178, 77, 141, 51, 111,
      170, 57, 198, 86, 153, 43, 189, 78, 134, 50, 208,
      99, 156, 41, 178, 69, 201, 92, 143, 54, 187, 82, 125,
    ]);

    expect(DEMO_DASHBOARD_TREND_BUCKETS.every(
      (bucket) => bucket.Qualified + bucket.Rejected === bucket.Activated,
    )).toBe(true);

    const scoredValues = qualificationBusinessDays.map((bucket) => bucket.Qualified);
    const rejectedValues = qualificationBusinessDays.map((bucket) => bucket.Rejected);
    const scoredMean = scoredValues.reduce((total, value) => total + value, 0) / scoredValues.length;
    const rejectedMean = rejectedValues.reduce((total, value) => total + value, 0) / rejectedValues.length;
    const covariance = scoredValues.reduce(
      (total, value, index) => total + (value - scoredMean) * ((rejectedValues[index] ?? 0) - rejectedMean),
      0,
    );
    const scoredDeviation = Math.sqrt(
      scoredValues.reduce((total, value) => total + (value - scoredMean) ** 2, 0),
    );
    const rejectedDeviation = Math.sqrt(
      rejectedValues.reduce((total, value) => total + (value - rejectedMean) ** 2, 0),
    );

    expect(Math.max(...qualificationBusinessDays.map((bucket) => bucket.Activated))
      - Math.min(...qualificationBusinessDays.map((bucket) => bucket.Activated))).toBeGreaterThanOrEqual(160);
    expect(Math.max(...scoredValues) - Math.min(...scoredValues)).toBeGreaterThanOrEqual(180);
    expect(Math.max(...rejectedValues) - Math.min(...rejectedValues)).toBeGreaterThanOrEqual(15);
    expect(covariance / (scoredDeviation * rejectedDeviation)).toBeLessThan(-0.9);

    const sendDays = DEMO_DASHBOARD_TREND_BUCKETS.filter((bucket) => bucket.Sent > 0);
    const replyDays = DEMO_DASHBOARD_TREND_BUCKETS.filter((bucket) => bucket.Replied > 0);
    expect(sendDays).toHaveLength(45);
    expect(sendDays.every((bucket) => bucket.Sent >= 3 && bucket.Sent <= 5)).toBe(true);
    expect(replyDays.length).toBeLessThan(DEMO_OPERATING_TOTALS.replies);
  });

  it('keeps ICP performance on the same scored and priority totals', () => {
    const icps = DEMO_ANALYTICS_DASHBOARD_SNAPSHOT.icpPerformance;
    expect(icps).toHaveLength(4);
    expect(icps.reduce((total, icp) => total + icp.scored, 0)).toBe(DEMO_OPERATING_TOTALS.scored);
    expect(icps.reduce((total, icp) => total + icp.qualified, 0)).toBe(DEMO_OPERATING_TOTALS.priority);

    for (const icp of icps) {
      expect(Math.round((icp.qualified / icp.scored) * 100)).toBe(icp.qualifiedRate);
    }
  });

  it('uses reserved fictional contacts and a varied, chronological conversation sample', () => {
    expect(DEMO_LEADS).toHaveLength(5);
    expect(DEMO_INBOX_LEADS.every((lead) => lead.email.endsWith('.example'))).toBe(true);
    expect(new Set(DEMO_INBOX_LEADS.map((lead) => lead.id)).size).toBe(DEMO_INBOX_LEADS.length);

    const leadIds = new Set(DEMO_INBOX_LEADS.map((lead) => lead.id));
    const eventIds = new Set<string>();
    let sent = 0;
    let replies = 0;
    let followUps = 0;
    let meetings = 0;
    const monthlySent = new Map<string, number>();
    const monthlyReplies = new Map<string, number>();
    const messageBusinessDates = new Set<string>();
    const responseDelaysMs: number[] = [];

    for (const conversation of DEMO_INBOX_CONVERSATIONS) {
      expect(leadIds.has(conversation.leadId)).toBe(true);
      const timestamps = conversation.events.map((event) => Date.parse(event.timestamp));
      expect(timestamps.every(Number.isFinite)).toBe(true);
      expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));

      let latestOutboundAt: number | null = null;
      for (const event of conversation.events) {
        expect(eventIds.has(event.id)).toBe(false);
        eventIds.add(event.id);
        if (event.kind === 'meeting') meetings += 1;
        if (event.kind === 'message') {
          const eventDate = new Date(event.timestamp);
          expect(eventDate.getUTCDay()).toBeGreaterThanOrEqual(1);
          expect(eventDate.getUTCDay()).toBeLessThanOrEqual(5);
          expect(eventDate.getUTCHours()).toBeGreaterThanOrEqual(13);
          expect(eventDate.getUTCHours()).toBeLessThanOrEqual(21);
          messageBusinessDates.add(event.timestamp.slice(0, 10));
        }
        if (event.kind === 'message' && event.direction === 'outbound') {
          sent += 1;
          latestOutboundAt = Date.parse(event.timestamp);
          const month = event.timestamp.slice(0, 7);
          monthlySent.set(month, (monthlySent.get(month) ?? 0) + 1);
          if ((event.followUpNumber ?? 0) > 0) followUps += 1;
        }
        if (event.kind === 'message' && event.direction === 'inbound') {
          replies += 1;
          const month = event.timestamp.slice(0, 7);
          monthlyReplies.set(month, (monthlyReplies.get(month) ?? 0) + 1);
          expect(latestOutboundAt).not.toBeNull();
          const responseDelayMs = Date.parse(event.timestamp) - (latestOutboundAt ?? 0);
          responseDelaysMs.push(responseDelayMs);
          expect(responseDelayMs).toBeGreaterThanOrEqual(30 * 60 * 1000);
          expect(responseDelayMs).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);
        }
      }
    }

    expect(sent).toBe(DEMO_OPERATING_TOTALS.sent);
    expect(replies).toBe(DEMO_OPERATING_TOTALS.replies);
    expect(meetings).toBe(DEMO_OPERATING_TOTALS.meetings);
    expect(monthlySent).toEqual(new Map([['2026-06', 70], ['2026-07', 95]]));
    expect(monthlyReplies).toEqual(new Map([['2026-06', 9], ['2026-07', 14]]));
    expect(messageBusinessDates.size).toBeGreaterThanOrEqual(40);
    expect(new Set(responseDelaysMs).size).toBeGreaterThanOrEqual(9);
    expect(Math.max(...responseDelaysMs)).toBeGreaterThanOrEqual(4 * 24 * 60 * 60 * 1000);
    expect(followUps).toBeGreaterThanOrEqual(2);
    expect(DEMO_INBOX_DRAFTS.length).toBeGreaterThanOrEqual(3);
    expect(DEMO_INBOX_DRAFTS.every((draft) => leadIds.has(draft.leadId))).toBe(true);
  });

  it('materializes the full sanitized lead portfolio for instant pagination', () => {
    expect(DEMO_LEAD_PORTFOLIO).toHaveLength(DEMO_LEAD_PORTFOLIO_TOTAL);
    expect(DEMO_LEAD_PORTFOLIO_TOTAL).toBe(DEMO_DATABASE_SNAPSHOT.scoredLeads);
    expect(new Set(DEMO_LEAD_PORTFOLIO.map((lead) => lead.id)).size).toBe(DEMO_LEAD_PORTFOLIO_TOTAL);
    expect(DEMO_LEAD_PORTFOLIO.every((lead) => lead.email.endsWith('.example'))).toBe(true);
  });

  it('contains no provider-delivery or scheduling fields in the public message fixture', () => {
    const serialized = JSON.stringify({
      conversations: DEMO_INBOX_CONVERSATIONS,
      drafts: DEMO_INBOX_DRAFTS,
    });

    expect(serialized).not.toContain('providerMessageId');
    expect(serialized).not.toContain('idempotencyKey');
    expect(serialized).not.toContain('nextFollowUpAfter');
    expect(serialized).not.toContain('scheduledAt');
  });
});
