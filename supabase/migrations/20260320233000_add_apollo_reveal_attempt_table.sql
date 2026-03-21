CREATE TYPE "public"."ApolloRevealAttemptStatus" AS ENUM (
    'CLAIMED',
    'COMPLETED'
);

CREATE TABLE "public"."ApolloRevealAttempt" (
    "id" "text" NOT NULL,
    "leadId" "text" NOT NULL,
    "icpProfileId" "text" NOT NULL,
    "scorePredictionId" "text" NOT NULL,
    "discoveryRunId" "text",
    "status" "public"."ApolloRevealAttemptStatus" NOT NULL DEFAULT 'CLAIMED',
    "jobId" "text",
    "claimedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp(3) without time zone NOT NULL,

    CONSTRAINT "ApolloRevealAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApolloRevealAttempt_leadId_icpProfileId_scorePredictionId_key"
    ON "public"."ApolloRevealAttempt"("leadId", "icpProfileId", "scorePredictionId");

CREATE INDEX "ApolloRevealAttempt_status_idx"
    ON "public"."ApolloRevealAttempt"("status");

ALTER TABLE "public"."ApolloRevealAttempt"
    ADD CONSTRAINT "ApolloRevealAttempt_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "public"."Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."ApolloRevealAttempt"
    ADD CONSTRAINT "ApolloRevealAttempt_icpProfileId_fkey"
    FOREIGN KEY ("icpProfileId") REFERENCES "public"."IcpProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."ApolloRevealAttempt"
    ADD CONSTRAINT "ApolloRevealAttempt_scorePredictionId_fkey"
    FOREIGN KEY ("scorePredictionId") REFERENCES "public"."LeadScorePrediction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
