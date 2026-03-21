ALTER TYPE "public"."ApolloRevealAttemptStatus" ADD VALUE 'ABANDONED';

ALTER TABLE "public"."ApolloRevealAttempt"
    ADD COLUMN "resolvedAt" timestamp(3) without time zone,
    ADD COLUMN "resolvedByUserId" "text";
