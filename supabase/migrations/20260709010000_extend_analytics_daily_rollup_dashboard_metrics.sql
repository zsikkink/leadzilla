ALTER TABLE "public"."AnalyticsDailyRollup"
  ADD COLUMN IF NOT EXISTS "qualifiedCount" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "messagesGeneratedCount" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "meetingsCount" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "dealsWonCount" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "dealLostCount" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "notInterestedCount" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "rejectedCount" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "lowScoreCount" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "mediumScoreCount" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "highScoreCount" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "scoreBucket0Count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "scoreBucket1Count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "scoreBucket2Count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "scoreBucket3Count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "scoreBucket4Count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "scoreBucket5Count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "scoreBucket6Count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "scoreBucket7Count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "scoreBucket8Count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "scoreBucket9Count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "scoreSum" double precision DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "totalCostCents" integer DEFAULT 0 NOT NULL;

WITH score_buckets AS (
  SELECT
    rollup."id",
    count(latest_scores."blendedScore")::integer AS score_count,
    coalesce(sum(latest_scores."blendedScore"), 0)::double precision AS score_sum,
    count(*) FILTER (WHERE latest_scores.bucket_index = 0)::integer AS bucket_0,
    count(*) FILTER (WHERE latest_scores.bucket_index = 1)::integer AS bucket_1,
    count(*) FILTER (WHERE latest_scores.bucket_index = 2)::integer AS bucket_2,
    count(*) FILTER (WHERE latest_scores.bucket_index = 3)::integer AS bucket_3,
    count(*) FILTER (WHERE latest_scores.bucket_index = 4)::integer AS bucket_4,
    count(*) FILTER (WHERE latest_scores.bucket_index = 5)::integer AS bucket_5,
    count(*) FILTER (WHERE latest_scores.bucket_index = 6)::integer AS bucket_6,
    count(*) FILTER (WHERE latest_scores.bucket_index = 7)::integer AS bucket_7,
    count(*) FILTER (WHERE latest_scores.bucket_index = 8)::integer AS bucket_8,
    count(*) FILTER (WHERE latest_scores.bucket_index = 9)::integer AS bucket_9
  FROM "public"."AnalyticsDailyRollup" rollup
  LEFT JOIN LATERAL (
    SELECT DISTINCT ON (score."leadId")
      score."blendedScore",
      least(floor(score."blendedScore" * 10)::integer, 9) AS bucket_index
    FROM "public"."LeadScorePrediction" score
    WHERE score."icpProfileId" = rollup."icpProfileId"
      AND score."predictedAt" >= rollup."day"
      AND score."predictedAt" < rollup."day" + interval '1 day'
      AND score."blendedScore" IS NOT NULL
    ORDER BY score."leadId", score."predictedAt" DESC, score."createdAt" DESC
  ) latest_scores ON true
  GROUP BY rollup."id"
)
UPDATE "public"."AnalyticsDailyRollup" rollup
SET
  "qualifiedCount" = (
    SELECT count(*)::integer
    FROM (
      SELECT DISTINCT discovery."leadId"
      FROM "public"."LeadDiscoveryRecord" discovery
      JOIN "public"."Lead" lead ON lead."id" = discovery."leadId"
      WHERE discovery."icpProfileId" = rollup."icpProfileId"
        AND discovery."discoveredAt" >= rollup."day"
        AND discovery."discoveredAt" < rollup."day" + interval '1 day'
        AND lead."deletedAt" IS NULL
        AND lead."status" IN ('qualified', 'drafted', 'messaged', 'replied', 'cold')
    ) qualified
  ),
  "messagesGeneratedCount" = (
    SELECT count(*)::integer
    FROM "public"."MessageDraft" draft
    WHERE draft."icpProfileId" = rollup."icpProfileId"
      AND draft."createdAt" >= rollup."day"
      AND draft."createdAt" < rollup."day" + interval '1 day'
  ),
  "sentCount" = (
    SELECT count(*)::integer
    FROM "public"."MessageSend" send
    JOIN "public"."MessageDraft" draft ON draft."id" = send."messageDraftId"
    WHERE draft."icpProfileId" = rollup."icpProfileId"
      AND send."status" IN ('SENT', 'DELIVERED', 'REPLIED')
      AND send."sentAt" >= rollup."day"
      AND send."sentAt" < rollup."day" + interval '1 day'
  ),
  "failedCount" = (
    SELECT count(*)::integer
    FROM "public"."MessageSend" send
    JOIN "public"."MessageDraft" draft ON draft."id" = send."messageDraftId"
    WHERE draft."icpProfileId" = rollup."icpProfileId"
      AND send."status" = 'FAILED'
      AND send."createdAt" >= rollup."day"
      AND send."createdAt" < rollup."day" + interval '1 day'
  ),
  "repliedCount" = (
    SELECT count(*)::integer
    FROM "public"."FeedbackEvent" feedback
    WHERE feedback."eventType" = 'REPLIED'
      AND feedback."occurredAt" >= rollup."day"
      AND feedback."occurredAt" < rollup."day" + interval '1 day'
      AND EXISTS (
        SELECT 1
        FROM "public"."LeadDiscoveryRecord" discovery
        WHERE discovery."leadId" = feedback."leadId"
          AND discovery."icpProfileId" = rollup."icpProfileId"
      )
  ),
  "meetingsCount" = (
    SELECT count(*)::integer
    FROM "public"."FeedbackEvent" feedback
    WHERE feedback."eventType" = 'MEETING_BOOKED'
      AND feedback."occurredAt" >= rollup."day"
      AND feedback."occurredAt" < rollup."day" + interval '1 day'
      AND EXISTS (
        SELECT 1
        FROM "public"."LeadDiscoveryRecord" discovery
        WHERE discovery."leadId" = feedback."leadId"
          AND discovery."icpProfileId" = rollup."icpProfileId"
      )
  ),
  "dealsWonCount" = (
    SELECT count(*)::integer
    FROM "public"."FeedbackEvent" feedback
    WHERE feedback."eventType" = 'DEAL_WON'
      AND feedback."occurredAt" >= rollup."day"
      AND feedback."occurredAt" < rollup."day" + interval '1 day'
      AND EXISTS (
        SELECT 1
        FROM "public"."LeadDiscoveryRecord" discovery
        WHERE discovery."leadId" = feedback."leadId"
          AND discovery."icpProfileId" = rollup."icpProfileId"
      )
  ),
  "dealLostCount" = (
    SELECT count(*)::integer
    FROM "public"."FeedbackEvent" feedback
    WHERE feedback."eventType" = 'DEAL_LOST'
      AND feedback."occurredAt" >= rollup."day"
      AND feedback."occurredAt" < rollup."day" + interval '1 day'
      AND EXISTS (
        SELECT 1
        FROM "public"."LeadDiscoveryRecord" discovery
        WHERE discovery."leadId" = feedback."leadId"
          AND discovery."icpProfileId" = rollup."icpProfileId"
      )
  ),
  "bouncedCount" = (
    SELECT count(*)::integer
    FROM "public"."FeedbackEvent" feedback
    WHERE feedback."eventType" = 'BOUNCED'
      AND feedback."occurredAt" >= rollup."day"
      AND feedback."occurredAt" < rollup."day" + interval '1 day'
      AND EXISTS (
        SELECT 1
        FROM "public"."LeadDiscoveryRecord" discovery
        WHERE discovery."leadId" = feedback."leadId"
          AND discovery."icpProfileId" = rollup."icpProfileId"
      )
  ),
  "notInterestedCount" = (
    SELECT count(*)::integer
    FROM "public"."FeedbackEvent" feedback
    WHERE feedback."eventType" IN ('NOT_INTERESTED', 'UNSUBSCRIBED')
      AND feedback."occurredAt" >= rollup."day"
      AND feedback."occurredAt" < rollup."day" + interval '1 day'
      AND EXISTS (
        SELECT 1
        FROM "public"."LeadDiscoveryRecord" discovery
        WHERE discovery."leadId" = feedback."leadId"
          AND discovery."icpProfileId" = rollup."icpProfileId"
      )
  ),
  "rejectedCount" = (
    SELECT count(*)::integer
    FROM "public"."lead_rejections" rejection
    WHERE rejection."icpProfileId" = rollup."icpProfileId"
      AND rejection."rejectedAt" >= rollup."day"
      AND rejection."rejectedAt" < rollup."day" + interval '1 day'
  ),
  "lowScoreCount" = (
    SELECT count(*)::integer
    FROM (
      SELECT DISTINCT ON (score."leadId") score."scoreBand"
      FROM "public"."LeadScorePrediction" score
      WHERE score."icpProfileId" = rollup."icpProfileId"
        AND score."predictedAt" >= rollup."day"
        AND score."predictedAt" < rollup."day" + interval '1 day'
      ORDER BY score."leadId", score."predictedAt" DESC, score."createdAt" DESC
    ) latest_scores
    WHERE latest_scores."scoreBand" = 'LOW'
  ),
  "mediumScoreCount" = (
    SELECT count(*)::integer
    FROM (
      SELECT DISTINCT ON (score."leadId") score."scoreBand"
      FROM "public"."LeadScorePrediction" score
      WHERE score."icpProfileId" = rollup."icpProfileId"
        AND score."predictedAt" >= rollup."day"
        AND score."predictedAt" < rollup."day" + interval '1 day'
      ORDER BY score."leadId", score."predictedAt" DESC, score."createdAt" DESC
    ) latest_scores
    WHERE latest_scores."scoreBand" = 'MEDIUM'
  ),
  "highScoreCount" = (
    SELECT count(*)::integer
    FROM (
      SELECT DISTINCT ON (score."leadId") score."scoreBand"
      FROM "public"."LeadScorePrediction" score
      WHERE score."icpProfileId" = rollup."icpProfileId"
        AND score."predictedAt" >= rollup."day"
        AND score."predictedAt" < rollup."day" + interval '1 day'
      ORDER BY score."leadId", score."predictedAt" DESC, score."createdAt" DESC
    ) latest_scores
    WHERE latest_scores."scoreBand" = 'HIGH'
  ),
  "scoreBucket0Count" = coalesce(score_buckets.bucket_0, 0),
  "scoreBucket1Count" = coalesce(score_buckets.bucket_1, 0),
  "scoreBucket2Count" = coalesce(score_buckets.bucket_2, 0),
  "scoreBucket3Count" = coalesce(score_buckets.bucket_3, 0),
  "scoreBucket4Count" = coalesce(score_buckets.bucket_4, 0),
  "scoreBucket5Count" = coalesce(score_buckets.bucket_5, 0),
  "scoreBucket6Count" = coalesce(score_buckets.bucket_6, 0),
  "scoreBucket7Count" = coalesce(score_buckets.bucket_7, 0),
  "scoreBucket8Count" = coalesce(score_buckets.bucket_8, 0),
  "scoreBucket9Count" = coalesce(score_buckets.bucket_9, 0),
  "scoreSum" = coalesce(score_buckets.score_sum, 0),
  "scoredCount" = coalesce(score_buckets.score_count, 0),
  "totalCostCents" = (
    SELECT coalesce(sum(lead."costCents"), 0)::integer
    FROM (
      SELECT DISTINCT discovery."leadId"
      FROM "public"."LeadDiscoveryRecord" discovery
      WHERE discovery."icpProfileId" = rollup."icpProfileId"
        AND discovery."discoveredAt" >= rollup."day"
        AND discovery."discoveredAt" < rollup."day" + interval '1 day'
    ) discovery_leads
    JOIN "public"."Lead" lead ON lead."id" = discovery_leads."leadId"
  )
FROM score_buckets
WHERE score_buckets."id" = rollup."id";
