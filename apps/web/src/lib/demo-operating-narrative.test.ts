import { describe, expect, it } from 'vitest';

import { DEMO_ANALYTICS_DASHBOARD_SNAPSHOT } from './demo-dashboard-snapshots.js';
import {
  DEMO_DATABASE_SNAPSHOT,
  DEMO_INBOX_CONVERSATIONS,
  DEMO_INBOX_DRAFTS,
  DEMO_INBOX_LEADS,
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
      sourceRecords: 4907,
      duplicatesMerged: 0,
      screened: 4907,
      disqualified: 479,
      scored: 4428,
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
    expect(DEMO_DASHBOARD_TREND_BUCKETS).toHaveLength(2);
    expect(DEMO_DASHBOARD_TREND_BUCKETS.at(-1)).toMatchObject({
      Sent: DEMO_OPERATING_TOTALS.sent,
      Replied: DEMO_OPERATING_TOTALS.replies,
    });
  });

  it('keeps ICP performance on the same scored and priority totals', () => {
    const icps = DEMO_ANALYTICS_DASHBOARD_SNAPSHOT.icpPerformance;
    expect(icps).toHaveLength(10);
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
