drop extension if exists "pg_net";

create schema if not exists "pgboss";

create type "pgboss"."job_state" as enum ('created', 'retry', 'active', 'completed', 'cancelled', 'failed');

create type "public"."ContactRecoveryReason" as enum ('NO_CONTACTS_FOUND', 'NO_EMAIL');

create type "public"."ContactRecoveryStatus" as enum ('OPEN', 'REJECTED');

create type "public"."CostEventProvider" as enum ('SERPAPI', 'APOLLO', 'APIFY_WEBSITE', 'APIFY_INSTAGRAM', 'HUNTER', 'GOOGLE_PLACES', 'GOOGLE_CUSTOM_SEARCH');

alter table "public"."businesses" drop constraint "businesses_country_code_allowed_chk";

alter table "public"."search_tasks" drop constraint "search_tasks_country_code_allowed_chk";

drop index if exists "public"."search_tasks_task_type_query_hash_key";

alter table "public"."JobExecution" alter column "status" drop default;

alter table "public"."Lead" alter column "status" drop default;

alter type "public"."DiscoveryProvider" rename to "DiscoveryProvider__old_version_to_be_dropped";

create type "public"."DiscoveryProvider" as enum ('GOOGLE_SEARCH', 'LINKEDIN_SCRAPE', 'COMPANY_SEARCH_FREE', 'APOLLO', 'BRAVE_SEARCH', 'GOOGLE_PLACES', 'SERPAPI');

alter type "public"."JobStatus" rename to "JobStatus__old_version_to_be_dropped";

create type "public"."JobStatus" as enum ('queued', 'running', 'completed', 'failed', 'cancelled');

alter type "public"."LeadStatus" rename to "LeadStatus__old_version_to_be_dropped";

create type "public"."LeadStatus" as enum ('new', 'processing', 'stuck', 'enriched', 'scored', 'qualified', 'drafted', 'rejected', 'failed', 'messaged', 'replied', 'cold');


  create table "pgboss"."archive" (
    "id" uuid not null,
    "name" text not null,
    "priority" integer not null,
    "data" jsonb,
    "state" pgboss.job_state not null,
    "retry_limit" integer not null,
    "retry_count" integer not null,
    "retry_delay" integer not null,
    "retry_backoff" boolean not null,
    "start_after" timestamp with time zone not null,
    "started_on" timestamp with time zone,
    "singleton_key" text,
    "singleton_on" timestamp without time zone,
    "expire_in" interval not null,
    "created_on" timestamp with time zone not null,
    "completed_on" timestamp with time zone,
    "keep_until" timestamp with time zone not null,
    "output" jsonb,
    "dead_letter" text,
    "policy" text,
    "archived_on" timestamp with time zone not null default now()
      );



  create table "pgboss"."j08a4caf376c33f608770f8c03c86a5683a4f201d5bdadcb2d49ab8f4" partition of "pgboss"."job" FOR VALUES IN ('business.prequalify');



  create table "pgboss"."j09d3b4cd0d2bd8982d6b8411f73f35d272a215d9af29e4fd8f096f78" partition of "pgboss"."job" FOR VALUES IN ('model.drift');



  create table "pgboss"."j1013e69c81070069a20618f73308d64a467085da733b465e6c7482e6" partition of "pgboss"."job" FOR VALUES IN ('discovery.seed.dead_letter');



  create table "pgboss"."j2cbce0e86cd2027d91b7f89322d0fa39967ca43558cf1e58ccb4efc7" partition of "pgboss"."job" FOR VALUES IN ('labels.generate.dead_letter');



  create table "pgboss"."j2ec38ec84ae710c0cc61646cf3ab0d97cadfc576b0a2a2223c9bbd0d" partition of "pgboss"."job" FOR VALUES IN ('reply.classify.dead_letter');



  create table "pgboss"."j2fda5fa249afd61d94d450bea30fcdc69fe12d72b19dbe46de6e01dc" partition of "pgboss"."job" FOR VALUES IN ('manager.analyze');



  create table "pgboss"."j3439a9c67b3fe6f938233905da5e9950dfa0c86b4b049434aa69985b" partition of "pgboss"."job" FOR VALUES IN ('features.compute.dead_letter');



  create table "pgboss"."j38c6f13b70081b52318ffca32760d310a2e988af0f26a6296b2202f9" partition of "pgboss"."job" FOR VALUES IN ('notify.sales.dead_letter');



  create table "pgboss"."j3bf5bc2325ebfa3abdcf0624bd070a1bd682f30889cd752114cd540f" partition of "pgboss"."job" FOR VALUES IN ('outbox.cleanup.dead_letter');



  create table "pgboss"."j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3" partition of "pgboss"."job" FOR VALUES IN ('__pgboss__send-it');



  create table "pgboss"."j4530b6b83fe2f947dc0b10ef8f9886938e1ce3b48de4e00962173c05" partition of "pgboss"."job" FOR VALUES IN ('model.drift.dead_letter');



  create table "pgboss"."j458f32dd7e19364c858d5a141e6768800f16f6729c9d6aee39ce892c" partition of "pgboss"."job" FOR VALUES IN ('scoring.batch.dead_letter');



  create table "pgboss"."j48ea4d455d918dbbd82be88c3c7e00f2124ccc3f530044064048d960" partition of "pgboss"."job" FOR VALUES IN ('discovery.seed');



  create table "pgboss"."j4e3f0bc26b70ce765c0d6597fbc835e92160729e8ee256af24b3ae30" partition of "pgboss"."job" FOR VALUES IN ('model.train');



  create table "pgboss"."j5328867a2176c7dd1ec6ff89bd0aa38f37a5e2658d131d6ff2e8de95" partition of "pgboss"."job" FOR VALUES IN ('data.retention.dead_letter');



  create table "pgboss"."j5a4c315c1a92f8e46d354763f338288cc06242e9b9cd23e58703b6a4" partition of "pgboss"."job" FOR VALUES IN ('message.send');



  create table "pgboss"."j5da920745b4c9f268ebabda749957c0887d7e5b9d77a6d61a9b4cc50" partition of "pgboss"."job" FOR VALUES IN ('labels.generate');



  create table "pgboss"."j5f12ff84a5d223de9f2603765cdaeb15303e6824e2d1b5cefc5126b3" partition of "pgboss"."job" FOR VALUES IN ('business.convert');



  create table "pgboss"."j60ba924ab6b9fcce1644d2da9decf1d7356a9c093e8014f11a2ddf9f" partition of "pgboss"."job" FOR VALUES IN ('search-task.recovery');



  create table "pgboss"."j62362595b2c644435af6b6d4e7f46ec15b6873418278eee93b30c295" partition of "pgboss"."job" FOR VALUES IN ('discovery.run.dead_letter');



  create table "pgboss"."j65e3e7ae1d8ab50c48bc2c5f22786b64661e3588c75e80237c42a207" partition of "pgboss"."job" FOR VALUES IN ('scoring.compute.dead_letter');



  create table "pgboss"."j7366837bee1de6bbd09b1187cec3a088873cf79db57a5139d56c9eaf" partition of "pgboss"."job" FOR VALUES IN ('pipeline.health.dead_letter');



  create table "pgboss"."j74eaf89cd1079d79baee7731c939029aeb2c484aa8983416bb6c3687" partition of "pgboss"."job" FOR VALUES IN ('manager.analyze.dead_letter');



  create table "pgboss"."j7a857c868c95a7707b7aa3215014d045670840b3351777d961aadfb1" partition of "pgboss"."job" FOR VALUES IN ('outbox.cleanup');



  create table "pgboss"."j7f0c2500b29c6260adf041dec7b6ad7b71bb2896f61123293118291d" partition of "pgboss"."job" FOR VALUES IN ('model.evaluate');



  create table "pgboss"."j7f46e583d0abc66aceffd655d84cd99a72edd712ec92cfdd579e34fc" partition of "pgboss"."job" FOR VALUES IN ('model.train.dead_letter');



  create table "pgboss"."j81444f35593fb2ba7c6be51a1cc9206be2ab5e16fe361d6ee2b3a7c6" partition of "pgboss"."job" FOR VALUES IN ('notify.sales');



  create table "pgboss"."j856d54ad98b9316ca35cd0586f7cfe819b15b6891dc30cb5111cf1d8" partition of "pgboss"."job" FOR VALUES IN ('message.generate');



  create table "pgboss"."j85c7356970884dc50d1715045004824f4f5c61eac9b140ec7dadbaac" partition of "pgboss"."job" FOR VALUES IN ('lead.recovery');



  create table "pgboss"."j8c119d8a760829826696fdefd2ec870aeeb47fe899f7fcd9eb2b1772" partition of "pgboss"."job" FOR VALUES IN ('reply.classify');



  create table "pgboss"."j93e89fa439fd38f2c7e454c34bc55898b673a56f50611fa8c99107b4" partition of "pgboss"."job" FOR VALUES IN ('lead.recovery.dead_letter');



  create table "pgboss"."j9563d8821f1397994f758aa8627af5363cf5d1d0b3d2edae93fc9ae6" partition of "pgboss"."job" FOR VALUES IN ('scoring.batch');



  create table "pgboss"."j96fbc7bc51cc9013c362eac101db8c30a03b27ffa24c9772cd339a96" partition of "pgboss"."job" FOR VALUES IN ('analytics.rollup');



  create table "pgboss"."j9a99bedc70b475d0bc99e8c36247fe3e7d636e080d30bd918a58e274" partition of "pgboss"."job" FOR VALUES IN ('message.generate.dead_letter');



  create table "pgboss"."j9bafadb7093981a69acefcde622f6bfe9f1d9fea5111a2c54af906c2" partition of "pgboss"."job" FOR VALUES IN ('enrichment.run');



  create table "pgboss"."j9e24d92cadfe1a5de1369fd66f5f84ed436c9ff10eafe22adc2ec71d" partition of "pgboss"."job" FOR VALUES IN ('data.retention');



  create table "pgboss"."ja140fe9874ff015f3efbe309d045e74ca25bbf51fc7e64a4a54c09a0" partition of "pgboss"."job" FOR VALUES IN ('apollo.enrich');



  create table "pgboss"."ja8a8843bd2b2f92ae407887b6256dd7e2430273a221d31f1a15ff54d" partition of "pgboss"."job" FOR VALUES IN ('business.prequalify.dead_letter');



  create table "pgboss"."jb6bb3b5824c8ea430e84e2940db9359408667b227c68d545bfa81495" partition of "pgboss"."job" FOR VALUES IN ('followup.check');



  create table "pgboss"."jbfe6be70bfd5dd32770953210aafd2d07b2b2968fb9e266983f2e567" partition of "pgboss"."job" FOR VALUES IN ('features.compute');



  create table "pgboss"."jc3b284f1f3f3e0584ba2554b54d9633d9151c0202075344e862e0be6" partition of "pgboss"."job" FOR VALUES IN ('scoring.compute');



  create table "pgboss"."jc4f43e4fc67c6cfde9f0e84c9314ec634c11b1b4ce04d7b85ddc8221" partition of "pgboss"."job" FOR VALUES IN ('apollo.enrich.dead_letter');



  create table "pgboss"."jd19fbd02b617cc48cad5e04dde519cb8c55385c141d61a582718f30b" partition of "pgboss"."job" FOR VALUES IN ('system.heartbeat');



  create table "pgboss"."jd31543c12dafcf0388873088540ad425cf51e04178195a8057629023" partition of "pgboss"."job" FOR VALUES IN ('business.convert.dead_letter');



  create table "pgboss"."jd442d23c0525fe5305a418bd1d96d790241806b056c3dac97a07a25a" partition of "pgboss"."job" FOR VALUES IN ('model.evaluate.dead_letter');



  create table "pgboss"."jd4de1d3c2a088ea0767c30d7974c9579436fa347c61208d5e6f998ca" partition of "pgboss"."job" FOR VALUES IN ('enrichment.run.dead_letter');



  create table "pgboss"."jd6a5c00363ad8705d1bf6988594c2729c9365c9941ca95152f0e84f5" partition of "pgboss"."job" FOR VALUES IN ('dlq.process.dead_letter');



  create table "pgboss"."jdb8d5f8033c0fce6fe7291be33c409aa854ee1a51557132f4ece404b" partition of "pgboss"."job" FOR VALUES IN ('discovery.run');



  create table "pgboss"."je194883db8168f5b3faa57d619cfc0f47b5d57ee2e049c6704887b0d" partition of "pgboss"."job" FOR VALUES IN ('followup.check.dead_letter');



  create table "pgboss"."je40a4837a72589e8afb5db6ce4066cc5a2c1ade743b34dc386395baf" partition of "pgboss"."job" FOR VALUES IN ('analytics.rollup.dead_letter');



  create table "pgboss"."je48c64b5dcac7f77221d4a73f8de49465b53a9b7708b4a3145eb2e16" partition of "pgboss"."job" FOR VALUES IN ('message.send.dead_letter');



  create table "pgboss"."je9a42f250cee0d3976f4512cfd2cbc9b0a9a4fa4208c77496f73b961" partition of "pgboss"."job" FOR VALUES IN ('discovery.run_search_task.dead_letter');



  create table "pgboss"."jea85060b5607bdc3ef2b58f758995b9124f659d470d6cec22b204b71" partition of "pgboss"."job" FOR VALUES IN ('system.heartbeat.dead_letter');



  create table "pgboss"."jee5a4ed8b83cd79110f0de65b1132a50575d50670f0277c417c9749b" partition of "pgboss"."job" FOR VALUES IN ('pipeline.health');



  create table "pgboss"."jf02cd78c21f22c64f831f3364dfa0d4baba406a92cbd29d75795829a" partition of "pgboss"."job" FOR VALUES IN ('search-task.recovery.dead_letter');



  create table "pgboss"."jf6105e34c1cb87b2990e484aaa66dccbbd06e004c2c6efd6e2ac7afe" partition of "pgboss"."job" FOR VALUES IN ('dlq.process');



  create table "pgboss"."jfff85c8ab363e80c03564838251fc3256e3497fc8b72d65af3ae28b5" partition of "pgboss"."job" FOR VALUES IN ('discovery.run_search_task');



  create table "pgboss"."job" (
    "id" uuid not null default gen_random_uuid(),
    "name" text not null,
    "priority" integer not null default 0,
    "data" jsonb,
    "state" pgboss.job_state not null default 'created'::pgboss.job_state,
    "retry_limit" integer not null default 2,
    "retry_count" integer not null default 0,
    "retry_delay" integer not null default 0,
    "retry_backoff" boolean not null default false,
    "start_after" timestamp with time zone not null default now(),
    "started_on" timestamp with time zone,
    "singleton_key" text,
    "singleton_on" timestamp without time zone,
    "expire_in" interval not null default '00:15:00'::interval,
    "created_on" timestamp with time zone not null default now(),
    "completed_on" timestamp with time zone,
    "keep_until" timestamp with time zone not null default (now() + '14 days'::interval),
    "output" jsonb,
    "dead_letter" text,
    "policy" text
      ) partition by LIST (name);



  create table "pgboss"."queue" (
    "name" text not null,
    "policy" text,
    "retry_limit" integer,
    "retry_delay" integer,
    "retry_backoff" boolean,
    "expire_seconds" integer,
    "retention_minutes" integer,
    "dead_letter" text,
    "partition_name" text,
    "created_on" timestamp with time zone not null default now(),
    "updated_on" timestamp with time zone not null default now()
      );



  create table "pgboss"."schedule" (
    "name" text not null,
    "cron" text not null,
    "timezone" text,
    "data" jsonb,
    "options" jsonb,
    "created_on" timestamp with time zone not null default now(),
    "updated_on" timestamp with time zone not null default now()
      );



  create table "pgboss"."subscription" (
    "event" text not null,
    "name" text not null,
    "created_on" timestamp with time zone not null default now(),
    "updated_on" timestamp with time zone not null default now()
      );



  create table "pgboss"."version" (
    "version" integer not null,
    "maintained_on" timestamp with time zone,
    "cron_on" timestamp with time zone,
    "monitored_on" timestamp with time zone
      );



  create table "public"."ManagerAnalysis" (
    "id" text not null,
    "runId" text not null,
    "weekStart" timestamp(3) without time zone not null,
    "weekEnd" timestamp(3) without time zone not null,
    "totalSends" integer not null default 0,
    "totalReplies" integer not null default 0,
    "totalPositive" integer not null default 0,
    "totalBounced" integer not null default 0,
    "overallReplyRate" double precision not null default 0,
    "overallPositiveRate" double precision not null default 0,
    "overallBounceRate" double precision not null default 0,
    "icpBreakdownJson" jsonb not null,
    "variantBreakdownJson" jsonb not null,
    "scoreBandBreakdownJson" jsonb not null,
    "trendJson" jsonb not null,
    "recommendationsJson" jsonb not null,
    "abInsightsPerIcpJson" jsonb,
    "recommendationCount" integer not null default 0,
    "createdAt" timestamp(3) without time zone not null default CURRENT_TIMESTAMP
      );


alter table "public"."ManagerAnalysis" enable row level security;


  create table "public"."business_contacts" (
    "id" text not null,
    "businessId" text not null,
    "name" text not null,
    "title" text,
    "email" text,
    "phone" text,
    "linkedinUrl" text,
    "seniority" text not null default 'other'::text,
    "positionRank" integer not null default 99,
    "source" text not null default 'website_scrape'::text,
    "createdAt" timestamp(3) without time zone not null default CURRENT_TIMESTAMP,
    "updatedAt" timestamp(3) without time zone not null
      );


alter table "public"."business_contacts" enable row level security;


  create table "public"."business_conversions" (
    "id" text not null,
    "businessId" text not null,
    "leadId" text not null,
    "apolloContactJson" jsonb,
    "hunterContactJson" jsonb,
    "convertedAt" timestamp(3) without time zone not null default CURRENT_TIMESTAMP,
    "createdAt" timestamp(3) without time zone not null default CURRENT_TIMESTAMP,
    "icpProfileId" text,
    "metadata" jsonb,
    "businessInsights" text,
    "apollo_has_direct_phone" boolean,
    "apollo_has_email" boolean
      );


alter table "public"."business_conversions" enable row level security;


  create table "public"."contact_recovery_items" (
    "id" text not null,
    "business_id" text not null,
    "icp_profile_id" text not null,
    "discovery_run_id" text not null,
    "status" public."ContactRecoveryStatus" not null default 'OPEN'::public."ContactRecoveryStatus",
    "reason" public."ContactRecoveryReason" not null,
    "evidence_score" double precision not null default 0,
    "candidate_count" integer not null default 0,
    "recovery_snapshot" jsonb not null,
    "rejected_by" text,
    "rejected_at" timestamp(3) without time zone,
    "created_at" timestamp(3) without time zone not null default CURRENT_TIMESTAMP,
    "updated_at" timestamp(3) without time zone not null
      );


alter table "public"."contact_recovery_items" enable row level security;


  create table "public"."discovery_cost_events" (
    "id" text not null,
    "discoveryRunId" text not null,
    "provider" public."CostEventProvider" not null,
    "costCents" integer not null,
    "apiCallType" text not null,
    "businessId" text,
    "leadId" text,
    "recordedAt" timestamp(3) without time zone not null default CURRENT_TIMESTAMP,
    "createdAt" timestamp(3) without time zone not null default CURRENT_TIMESTAMP
      );


alter table "public"."discovery_cost_events" enable row level security;


  create table "public"."lead_pipeline_events" (
    "id" text not null,
    "lead_id" text not null,
    "stage" text not null,
    "status" text not null,
    "job_id" text,
    "duration_ms" integer,
    "metadata" jsonb,
    "occurred_at" timestamp(3) without time zone not null default CURRENT_TIMESTAMP,
    "created_at" timestamp(3) without time zone not null default CURRENT_TIMESTAMP
      );


alter table "public"."lead_pipeline_events" enable row level security;


  create table "public"."lead_rejections" (
    "id" text not null,
    "leadId" text not null,
    "businessId" text,
    "domain" text,
    "icpProfileId" text,
    "score" double precision,
    "reason" text not null,
    "rejectedBy" text not null,
    "rejectedAt" timestamp(3) without time zone not null default CURRENT_TIMESTAMP,
    "metadata" jsonb,
    "createdAt" timestamp(3) without time zone not null default CURRENT_TIMESTAMP
      );


alter table "public"."lead_rejections" enable row level security;


  create table "public"."manager_recommendation_records" (
    "id" text not null,
    "type" text not null,
    "title" text not null,
    "description" text not null,
    "icpProfileId" text,
    "icpName" text,
    "field" text,
    "currentValue" double precision,
    "recommendedValue" double precision,
    "confidence" double precision not null default 0,
    "priority" integer not null default 5,
    "status" text not null default 'active'::text,
    "analysisRunId" text,
    "createdAt" timestamp(3) without time zone not null default CURRENT_TIMESTAMP,
    "updatedAt" timestamp(3) without time zone not null
      );


alter table "public"."manager_recommendation_records" enable row level security;


  create table "public"."pipeline_settings" (
    "id" text not null,
    "key" text not null,
    "valueJson" jsonb not null,
    "updatedAt" timestamp(3) without time zone not null,
    "createdAt" timestamp(3) without time zone not null default CURRENT_TIMESTAMP
      );


alter table "public"."pipeline_settings" enable row level security;

alter table "public"."JobExecution" alter column status type "public"."JobStatus" using status::text::"public"."JobStatus";

alter table "public"."Lead" alter column status type "public"."LeadStatus" using status::text::"public"."LeadStatus";

alter table "public"."LeadDiscoveryRecord" alter column provider type "public"."DiscoveryProvider" using provider::text::"public"."DiscoveryProvider";

alter table "public"."JobExecution" alter column "status" set default 'queued'::public."JobStatus";

alter table "public"."Lead" alter column "status" set default 'new'::public."LeadStatus";

drop type "public"."DiscoveryProvider__old_version_to_be_dropped";

drop type "public"."JobStatus__old_version_to_be_dropped";

drop type "public"."LeadStatus__old_version_to_be_dropped";

alter table "public"."AnalyticsDailyRollup" add column "bouncedCount" integer not null default 0;

alter table "public"."AnalyticsDailyRollup" add column "failedCount" integer not null default 0;

alter table "public"."AnalyticsDailyRollup" add column "repliedCount" integer not null default 0;

alter table "public"."AnalyticsDailyRollup" add column "sentCount" integer not null default 0;

alter table "public"."Lead" add column "businessEmail" text;

alter table "public"."Lead" add column "businessId" text;

alter table "public"."Lead" add column "costCents" integer not null default 0;

alter table "public"."Lead" add column "decisionMakerPhone" text;

alter table "public"."Lead" add column "decisionMakerTitle" text;

alter table "public"."Lead" add column "deletedAt" timestamp(3) without time zone;

alter table "public"."Lead" add column "phoneSource" text;

alter table "public"."businesses" add column "apify_instagram_scrape_json" jsonb;

alter table "public"."businesses" add column "apify_website_scrape_json" jsonb;

alter table "public"."businesses" add column "country" text;

alter table "public"."businesses" add column "discovery_run_id" text;

alter table "public"."businesses" add column "disqualification_reason" text;

alter table "public"."businesses" add column "instagram_scraped_at" timestamp(3) without time zone;

alter table "public"."businesses" add column "pre_qualified" boolean;

alter table "public"."businesses" add column "website_scraped_at" timestamp(3) without time zone;

alter table "public"."search_tasks" add column "discovery_run_id" text;

CREATE INDEX archive_i1 ON pgboss.archive USING btree (archived_on);

CREATE UNIQUE INDEX archive_pkey ON pgboss.archive USING btree (name, id);

CREATE UNIQUE INDEX j08a4caf376c33f608770f8c03c86a5683a4f201d5bdadcb2d49ab8f4_i1 ON pgboss.j08a4caf376c33f608770f8c03c86a5683a4f201d5bdadcb2d49ab8f4 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j08a4caf376c33f608770f8c03c86a5683a4f201d5bdadcb2d49ab8f4_i2 ON pgboss.j08a4caf376c33f608770f8c03c86a5683a4f201d5bdadcb2d49ab8f4 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j08a4caf376c33f608770f8c03c86a5683a4f201d5bdadcb2d49ab8f4_i3 ON pgboss.j08a4caf376c33f608770f8c03c86a5683a4f201d5bdadcb2d49ab8f4 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j08a4caf376c33f608770f8c03c86a5683a4f201d5bdadcb2d49ab8f4_i4 ON pgboss.j08a4caf376c33f608770f8c03c86a5683a4f201d5bdadcb2d49ab8f4 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j08a4caf376c33f608770f8c03c86a5683a4f201d5bdadcb2d49ab8f4_i5 ON pgboss.j08a4caf376c33f608770f8c03c86a5683a4f201d5bdadcb2d49ab8f4 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX j08a4caf376c33f608770f8c03c86a5683a4f201d5bdadcb2d49ab8f4_pkey ON pgboss.j08a4caf376c33f608770f8c03c86a5683a4f201d5bdadcb2d49ab8f4 USING btree (name, id);

CREATE UNIQUE INDEX j09d3b4cd0d2bd8982d6b8411f73f35d272a215d9af29e4fd8f096f78_i1 ON pgboss.j09d3b4cd0d2bd8982d6b8411f73f35d272a215d9af29e4fd8f096f78 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j09d3b4cd0d2bd8982d6b8411f73f35d272a215d9af29e4fd8f096f78_i2 ON pgboss.j09d3b4cd0d2bd8982d6b8411f73f35d272a215d9af29e4fd8f096f78 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j09d3b4cd0d2bd8982d6b8411f73f35d272a215d9af29e4fd8f096f78_i3 ON pgboss.j09d3b4cd0d2bd8982d6b8411f73f35d272a215d9af29e4fd8f096f78 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j09d3b4cd0d2bd8982d6b8411f73f35d272a215d9af29e4fd8f096f78_i4 ON pgboss.j09d3b4cd0d2bd8982d6b8411f73f35d272a215d9af29e4fd8f096f78 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j09d3b4cd0d2bd8982d6b8411f73f35d272a215d9af29e4fd8f096f78_i5 ON pgboss.j09d3b4cd0d2bd8982d6b8411f73f35d272a215d9af29e4fd8f096f78 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX j09d3b4cd0d2bd8982d6b8411f73f35d272a215d9af29e4fd8f096f78_pkey ON pgboss.j09d3b4cd0d2bd8982d6b8411f73f35d272a215d9af29e4fd8f096f78 USING btree (name, id);

CREATE UNIQUE INDEX j1013e69c81070069a20618f73308d64a467085da733b465e6c7482e6_i1 ON pgboss.j1013e69c81070069a20618f73308d64a467085da733b465e6c7482e6 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j1013e69c81070069a20618f73308d64a467085da733b465e6c7482e6_i2 ON pgboss.j1013e69c81070069a20618f73308d64a467085da733b465e6c7482e6 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j1013e69c81070069a20618f73308d64a467085da733b465e6c7482e6_i3 ON pgboss.j1013e69c81070069a20618f73308d64a467085da733b465e6c7482e6 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j1013e69c81070069a20618f73308d64a467085da733b465e6c7482e6_i4 ON pgboss.j1013e69c81070069a20618f73308d64a467085da733b465e6c7482e6 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j1013e69c81070069a20618f73308d64a467085da733b465e6c7482e6_i5 ON pgboss.j1013e69c81070069a20618f73308d64a467085da733b465e6c7482e6 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX j1013e69c81070069a20618f73308d64a467085da733b465e6c7482e6_pkey ON pgboss.j1013e69c81070069a20618f73308d64a467085da733b465e6c7482e6 USING btree (name, id);

CREATE UNIQUE INDEX j2cbce0e86cd2027d91b7f89322d0fa39967ca43558cf1e58ccb4efc7_i1 ON pgboss.j2cbce0e86cd2027d91b7f89322d0fa39967ca43558cf1e58ccb4efc7 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j2cbce0e86cd2027d91b7f89322d0fa39967ca43558cf1e58ccb4efc7_i2 ON pgboss.j2cbce0e86cd2027d91b7f89322d0fa39967ca43558cf1e58ccb4efc7 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j2cbce0e86cd2027d91b7f89322d0fa39967ca43558cf1e58ccb4efc7_i3 ON pgboss.j2cbce0e86cd2027d91b7f89322d0fa39967ca43558cf1e58ccb4efc7 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j2cbce0e86cd2027d91b7f89322d0fa39967ca43558cf1e58ccb4efc7_i4 ON pgboss.j2cbce0e86cd2027d91b7f89322d0fa39967ca43558cf1e58ccb4efc7 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j2cbce0e86cd2027d91b7f89322d0fa39967ca43558cf1e58ccb4efc7_i5 ON pgboss.j2cbce0e86cd2027d91b7f89322d0fa39967ca43558cf1e58ccb4efc7 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX j2cbce0e86cd2027d91b7f89322d0fa39967ca43558cf1e58ccb4efc7_pkey ON pgboss.j2cbce0e86cd2027d91b7f89322d0fa39967ca43558cf1e58ccb4efc7 USING btree (name, id);

CREATE UNIQUE INDEX j2ec38ec84ae710c0cc61646cf3ab0d97cadfc576b0a2a2223c9bbd0d_i1 ON pgboss.j2ec38ec84ae710c0cc61646cf3ab0d97cadfc576b0a2a2223c9bbd0d USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j2ec38ec84ae710c0cc61646cf3ab0d97cadfc576b0a2a2223c9bbd0d_i2 ON pgboss.j2ec38ec84ae710c0cc61646cf3ab0d97cadfc576b0a2a2223c9bbd0d USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j2ec38ec84ae710c0cc61646cf3ab0d97cadfc576b0a2a2223c9bbd0d_i3 ON pgboss.j2ec38ec84ae710c0cc61646cf3ab0d97cadfc576b0a2a2223c9bbd0d USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j2ec38ec84ae710c0cc61646cf3ab0d97cadfc576b0a2a2223c9bbd0d_i4 ON pgboss.j2ec38ec84ae710c0cc61646cf3ab0d97cadfc576b0a2a2223c9bbd0d USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j2ec38ec84ae710c0cc61646cf3ab0d97cadfc576b0a2a2223c9bbd0d_i5 ON pgboss.j2ec38ec84ae710c0cc61646cf3ab0d97cadfc576b0a2a2223c9bbd0d USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX j2ec38ec84ae710c0cc61646cf3ab0d97cadfc576b0a2a2223c9bbd0d_pkey ON pgboss.j2ec38ec84ae710c0cc61646cf3ab0d97cadfc576b0a2a2223c9bbd0d USING btree (name, id);

CREATE UNIQUE INDEX j2fda5fa249afd61d94d450bea30fcdc69fe12d72b19dbe46de6e01dc_i1 ON pgboss.j2fda5fa249afd61d94d450bea30fcdc69fe12d72b19dbe46de6e01dc USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j2fda5fa249afd61d94d450bea30fcdc69fe12d72b19dbe46de6e01dc_i2 ON pgboss.j2fda5fa249afd61d94d450bea30fcdc69fe12d72b19dbe46de6e01dc USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j2fda5fa249afd61d94d450bea30fcdc69fe12d72b19dbe46de6e01dc_i3 ON pgboss.j2fda5fa249afd61d94d450bea30fcdc69fe12d72b19dbe46de6e01dc USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j2fda5fa249afd61d94d450bea30fcdc69fe12d72b19dbe46de6e01dc_i4 ON pgboss.j2fda5fa249afd61d94d450bea30fcdc69fe12d72b19dbe46de6e01dc USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j2fda5fa249afd61d94d450bea30fcdc69fe12d72b19dbe46de6e01dc_i5 ON pgboss.j2fda5fa249afd61d94d450bea30fcdc69fe12d72b19dbe46de6e01dc USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX j2fda5fa249afd61d94d450bea30fcdc69fe12d72b19dbe46de6e01dc_pkey ON pgboss.j2fda5fa249afd61d94d450bea30fcdc69fe12d72b19dbe46de6e01dc USING btree (name, id);

CREATE UNIQUE INDEX j3439a9c67b3fe6f938233905da5e9950dfa0c86b4b049434aa69985b_i1 ON pgboss.j3439a9c67b3fe6f938233905da5e9950dfa0c86b4b049434aa69985b USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j3439a9c67b3fe6f938233905da5e9950dfa0c86b4b049434aa69985b_i2 ON pgboss.j3439a9c67b3fe6f938233905da5e9950dfa0c86b4b049434aa69985b USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j3439a9c67b3fe6f938233905da5e9950dfa0c86b4b049434aa69985b_i3 ON pgboss.j3439a9c67b3fe6f938233905da5e9950dfa0c86b4b049434aa69985b USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j3439a9c67b3fe6f938233905da5e9950dfa0c86b4b049434aa69985b_i4 ON pgboss.j3439a9c67b3fe6f938233905da5e9950dfa0c86b4b049434aa69985b USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j3439a9c67b3fe6f938233905da5e9950dfa0c86b4b049434aa69985b_i5 ON pgboss.j3439a9c67b3fe6f938233905da5e9950dfa0c86b4b049434aa69985b USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX j3439a9c67b3fe6f938233905da5e9950dfa0c86b4b049434aa69985b_pkey ON pgboss.j3439a9c67b3fe6f938233905da5e9950dfa0c86b4b049434aa69985b USING btree (name, id);

CREATE UNIQUE INDEX j38c6f13b70081b52318ffca32760d310a2e988af0f26a6296b2202f9_i1 ON pgboss.j38c6f13b70081b52318ffca32760d310a2e988af0f26a6296b2202f9 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j38c6f13b70081b52318ffca32760d310a2e988af0f26a6296b2202f9_i2 ON pgboss.j38c6f13b70081b52318ffca32760d310a2e988af0f26a6296b2202f9 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j38c6f13b70081b52318ffca32760d310a2e988af0f26a6296b2202f9_i3 ON pgboss.j38c6f13b70081b52318ffca32760d310a2e988af0f26a6296b2202f9 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j38c6f13b70081b52318ffca32760d310a2e988af0f26a6296b2202f9_i4 ON pgboss.j38c6f13b70081b52318ffca32760d310a2e988af0f26a6296b2202f9 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j38c6f13b70081b52318ffca32760d310a2e988af0f26a6296b2202f9_i5 ON pgboss.j38c6f13b70081b52318ffca32760d310a2e988af0f26a6296b2202f9 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX j38c6f13b70081b52318ffca32760d310a2e988af0f26a6296b2202f9_pkey ON pgboss.j38c6f13b70081b52318ffca32760d310a2e988af0f26a6296b2202f9 USING btree (name, id);

CREATE UNIQUE INDEX j3bf5bc2325ebfa3abdcf0624bd070a1bd682f30889cd752114cd540f_i1 ON pgboss.j3bf5bc2325ebfa3abdcf0624bd070a1bd682f30889cd752114cd540f USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j3bf5bc2325ebfa3abdcf0624bd070a1bd682f30889cd752114cd540f_i2 ON pgboss.j3bf5bc2325ebfa3abdcf0624bd070a1bd682f30889cd752114cd540f USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j3bf5bc2325ebfa3abdcf0624bd070a1bd682f30889cd752114cd540f_i3 ON pgboss.j3bf5bc2325ebfa3abdcf0624bd070a1bd682f30889cd752114cd540f USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j3bf5bc2325ebfa3abdcf0624bd070a1bd682f30889cd752114cd540f_i4 ON pgboss.j3bf5bc2325ebfa3abdcf0624bd070a1bd682f30889cd752114cd540f USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j3bf5bc2325ebfa3abdcf0624bd070a1bd682f30889cd752114cd540f_i5 ON pgboss.j3bf5bc2325ebfa3abdcf0624bd070a1bd682f30889cd752114cd540f USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX j3bf5bc2325ebfa3abdcf0624bd070a1bd682f30889cd752114cd540f_pkey ON pgboss.j3bf5bc2325ebfa3abdcf0624bd070a1bd682f30889cd752114cd540f USING btree (name, id);

CREATE UNIQUE INDEX j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i1 ON pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i2 ON pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i3 ON pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i4 ON pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i5 ON pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_pkey ON pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 USING btree (name, id);

CREATE UNIQUE INDEX j4530b6b83fe2f947dc0b10ef8f9886938e1ce3b48de4e00962173c05_i1 ON pgboss.j4530b6b83fe2f947dc0b10ef8f9886938e1ce3b48de4e00962173c05 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j4530b6b83fe2f947dc0b10ef8f9886938e1ce3b48de4e00962173c05_i2 ON pgboss.j4530b6b83fe2f947dc0b10ef8f9886938e1ce3b48de4e00962173c05 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j4530b6b83fe2f947dc0b10ef8f9886938e1ce3b48de4e00962173c05_i3 ON pgboss.j4530b6b83fe2f947dc0b10ef8f9886938e1ce3b48de4e00962173c05 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j4530b6b83fe2f947dc0b10ef8f9886938e1ce3b48de4e00962173c05_i4 ON pgboss.j4530b6b83fe2f947dc0b10ef8f9886938e1ce3b48de4e00962173c05 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j4530b6b83fe2f947dc0b10ef8f9886938e1ce3b48de4e00962173c05_i5 ON pgboss.j4530b6b83fe2f947dc0b10ef8f9886938e1ce3b48de4e00962173c05 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX j4530b6b83fe2f947dc0b10ef8f9886938e1ce3b48de4e00962173c05_pkey ON pgboss.j4530b6b83fe2f947dc0b10ef8f9886938e1ce3b48de4e00962173c05 USING btree (name, id);

CREATE UNIQUE INDEX j458f32dd7e19364c858d5a141e6768800f16f6729c9d6aee39ce892c_i1 ON pgboss.j458f32dd7e19364c858d5a141e6768800f16f6729c9d6aee39ce892c USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j458f32dd7e19364c858d5a141e6768800f16f6729c9d6aee39ce892c_i2 ON pgboss.j458f32dd7e19364c858d5a141e6768800f16f6729c9d6aee39ce892c USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j458f32dd7e19364c858d5a141e6768800f16f6729c9d6aee39ce892c_i3 ON pgboss.j458f32dd7e19364c858d5a141e6768800f16f6729c9d6aee39ce892c USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j458f32dd7e19364c858d5a141e6768800f16f6729c9d6aee39ce892c_i4 ON pgboss.j458f32dd7e19364c858d5a141e6768800f16f6729c9d6aee39ce892c USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j458f32dd7e19364c858d5a141e6768800f16f6729c9d6aee39ce892c_i5 ON pgboss.j458f32dd7e19364c858d5a141e6768800f16f6729c9d6aee39ce892c USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX j458f32dd7e19364c858d5a141e6768800f16f6729c9d6aee39ce892c_pkey ON pgboss.j458f32dd7e19364c858d5a141e6768800f16f6729c9d6aee39ce892c USING btree (name, id);

CREATE UNIQUE INDEX j48ea4d455d918dbbd82be88c3c7e00f2124ccc3f530044064048d960_i1 ON pgboss.j48ea4d455d918dbbd82be88c3c7e00f2124ccc3f530044064048d960 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j48ea4d455d918dbbd82be88c3c7e00f2124ccc3f530044064048d960_i2 ON pgboss.j48ea4d455d918dbbd82be88c3c7e00f2124ccc3f530044064048d960 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j48ea4d455d918dbbd82be88c3c7e00f2124ccc3f530044064048d960_i3 ON pgboss.j48ea4d455d918dbbd82be88c3c7e00f2124ccc3f530044064048d960 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j48ea4d455d918dbbd82be88c3c7e00f2124ccc3f530044064048d960_i4 ON pgboss.j48ea4d455d918dbbd82be88c3c7e00f2124ccc3f530044064048d960 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j48ea4d455d918dbbd82be88c3c7e00f2124ccc3f530044064048d960_i5 ON pgboss.j48ea4d455d918dbbd82be88c3c7e00f2124ccc3f530044064048d960 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX j48ea4d455d918dbbd82be88c3c7e00f2124ccc3f530044064048d960_pkey ON pgboss.j48ea4d455d918dbbd82be88c3c7e00f2124ccc3f530044064048d960 USING btree (name, id);

CREATE UNIQUE INDEX j4e3f0bc26b70ce765c0d6597fbc835e92160729e8ee256af24b3ae30_i1 ON pgboss.j4e3f0bc26b70ce765c0d6597fbc835e92160729e8ee256af24b3ae30 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j4e3f0bc26b70ce765c0d6597fbc835e92160729e8ee256af24b3ae30_i2 ON pgboss.j4e3f0bc26b70ce765c0d6597fbc835e92160729e8ee256af24b3ae30 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j4e3f0bc26b70ce765c0d6597fbc835e92160729e8ee256af24b3ae30_i3 ON pgboss.j4e3f0bc26b70ce765c0d6597fbc835e92160729e8ee256af24b3ae30 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j4e3f0bc26b70ce765c0d6597fbc835e92160729e8ee256af24b3ae30_i4 ON pgboss.j4e3f0bc26b70ce765c0d6597fbc835e92160729e8ee256af24b3ae30 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j4e3f0bc26b70ce765c0d6597fbc835e92160729e8ee256af24b3ae30_i5 ON pgboss.j4e3f0bc26b70ce765c0d6597fbc835e92160729e8ee256af24b3ae30 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX j4e3f0bc26b70ce765c0d6597fbc835e92160729e8ee256af24b3ae30_pkey ON pgboss.j4e3f0bc26b70ce765c0d6597fbc835e92160729e8ee256af24b3ae30 USING btree (name, id);

CREATE UNIQUE INDEX j5328867a2176c7dd1ec6ff89bd0aa38f37a5e2658d131d6ff2e8de95_i1 ON pgboss.j5328867a2176c7dd1ec6ff89bd0aa38f37a5e2658d131d6ff2e8de95 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j5328867a2176c7dd1ec6ff89bd0aa38f37a5e2658d131d6ff2e8de95_i2 ON pgboss.j5328867a2176c7dd1ec6ff89bd0aa38f37a5e2658d131d6ff2e8de95 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j5328867a2176c7dd1ec6ff89bd0aa38f37a5e2658d131d6ff2e8de95_i3 ON pgboss.j5328867a2176c7dd1ec6ff89bd0aa38f37a5e2658d131d6ff2e8de95 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j5328867a2176c7dd1ec6ff89bd0aa38f37a5e2658d131d6ff2e8de95_i4 ON pgboss.j5328867a2176c7dd1ec6ff89bd0aa38f37a5e2658d131d6ff2e8de95 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j5328867a2176c7dd1ec6ff89bd0aa38f37a5e2658d131d6ff2e8de95_i5 ON pgboss.j5328867a2176c7dd1ec6ff89bd0aa38f37a5e2658d131d6ff2e8de95 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX j5328867a2176c7dd1ec6ff89bd0aa38f37a5e2658d131d6ff2e8de95_pkey ON pgboss.j5328867a2176c7dd1ec6ff89bd0aa38f37a5e2658d131d6ff2e8de95 USING btree (name, id);

CREATE UNIQUE INDEX j5a4c315c1a92f8e46d354763f338288cc06242e9b9cd23e58703b6a4_i1 ON pgboss.j5a4c315c1a92f8e46d354763f338288cc06242e9b9cd23e58703b6a4 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j5a4c315c1a92f8e46d354763f338288cc06242e9b9cd23e58703b6a4_i2 ON pgboss.j5a4c315c1a92f8e46d354763f338288cc06242e9b9cd23e58703b6a4 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j5a4c315c1a92f8e46d354763f338288cc06242e9b9cd23e58703b6a4_i3 ON pgboss.j5a4c315c1a92f8e46d354763f338288cc06242e9b9cd23e58703b6a4 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j5a4c315c1a92f8e46d354763f338288cc06242e9b9cd23e58703b6a4_i4 ON pgboss.j5a4c315c1a92f8e46d354763f338288cc06242e9b9cd23e58703b6a4 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j5a4c315c1a92f8e46d354763f338288cc06242e9b9cd23e58703b6a4_i5 ON pgboss.j5a4c315c1a92f8e46d354763f338288cc06242e9b9cd23e58703b6a4 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX j5a4c315c1a92f8e46d354763f338288cc06242e9b9cd23e58703b6a4_pkey ON pgboss.j5a4c315c1a92f8e46d354763f338288cc06242e9b9cd23e58703b6a4 USING btree (name, id);

CREATE UNIQUE INDEX j5da920745b4c9f268ebabda749957c0887d7e5b9d77a6d61a9b4cc50_i1 ON pgboss.j5da920745b4c9f268ebabda749957c0887d7e5b9d77a6d61a9b4cc50 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j5da920745b4c9f268ebabda749957c0887d7e5b9d77a6d61a9b4cc50_i2 ON pgboss.j5da920745b4c9f268ebabda749957c0887d7e5b9d77a6d61a9b4cc50 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j5da920745b4c9f268ebabda749957c0887d7e5b9d77a6d61a9b4cc50_i3 ON pgboss.j5da920745b4c9f268ebabda749957c0887d7e5b9d77a6d61a9b4cc50 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j5da920745b4c9f268ebabda749957c0887d7e5b9d77a6d61a9b4cc50_i4 ON pgboss.j5da920745b4c9f268ebabda749957c0887d7e5b9d77a6d61a9b4cc50 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j5da920745b4c9f268ebabda749957c0887d7e5b9d77a6d61a9b4cc50_i5 ON pgboss.j5da920745b4c9f268ebabda749957c0887d7e5b9d77a6d61a9b4cc50 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX j5da920745b4c9f268ebabda749957c0887d7e5b9d77a6d61a9b4cc50_pkey ON pgboss.j5da920745b4c9f268ebabda749957c0887d7e5b9d77a6d61a9b4cc50 USING btree (name, id);

CREATE UNIQUE INDEX j5f12ff84a5d223de9f2603765cdaeb15303e6824e2d1b5cefc5126b3_i1 ON pgboss.j5f12ff84a5d223de9f2603765cdaeb15303e6824e2d1b5cefc5126b3 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j5f12ff84a5d223de9f2603765cdaeb15303e6824e2d1b5cefc5126b3_i2 ON pgboss.j5f12ff84a5d223de9f2603765cdaeb15303e6824e2d1b5cefc5126b3 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j5f12ff84a5d223de9f2603765cdaeb15303e6824e2d1b5cefc5126b3_i3 ON pgboss.j5f12ff84a5d223de9f2603765cdaeb15303e6824e2d1b5cefc5126b3 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j5f12ff84a5d223de9f2603765cdaeb15303e6824e2d1b5cefc5126b3_i4 ON pgboss.j5f12ff84a5d223de9f2603765cdaeb15303e6824e2d1b5cefc5126b3 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j5f12ff84a5d223de9f2603765cdaeb15303e6824e2d1b5cefc5126b3_i5 ON pgboss.j5f12ff84a5d223de9f2603765cdaeb15303e6824e2d1b5cefc5126b3 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX j5f12ff84a5d223de9f2603765cdaeb15303e6824e2d1b5cefc5126b3_pkey ON pgboss.j5f12ff84a5d223de9f2603765cdaeb15303e6824e2d1b5cefc5126b3 USING btree (name, id);

CREATE UNIQUE INDEX j60ba924ab6b9fcce1644d2da9decf1d7356a9c093e8014f11a2ddf9f_i1 ON pgboss.j60ba924ab6b9fcce1644d2da9decf1d7356a9c093e8014f11a2ddf9f USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j60ba924ab6b9fcce1644d2da9decf1d7356a9c093e8014f11a2ddf9f_i2 ON pgboss.j60ba924ab6b9fcce1644d2da9decf1d7356a9c093e8014f11a2ddf9f USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j60ba924ab6b9fcce1644d2da9decf1d7356a9c093e8014f11a2ddf9f_i3 ON pgboss.j60ba924ab6b9fcce1644d2da9decf1d7356a9c093e8014f11a2ddf9f USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j60ba924ab6b9fcce1644d2da9decf1d7356a9c093e8014f11a2ddf9f_i4 ON pgboss.j60ba924ab6b9fcce1644d2da9decf1d7356a9c093e8014f11a2ddf9f USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j60ba924ab6b9fcce1644d2da9decf1d7356a9c093e8014f11a2ddf9f_i5 ON pgboss.j60ba924ab6b9fcce1644d2da9decf1d7356a9c093e8014f11a2ddf9f USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX j60ba924ab6b9fcce1644d2da9decf1d7356a9c093e8014f11a2ddf9f_pkey ON pgboss.j60ba924ab6b9fcce1644d2da9decf1d7356a9c093e8014f11a2ddf9f USING btree (name, id);

CREATE UNIQUE INDEX j62362595b2c644435af6b6d4e7f46ec15b6873418278eee93b30c295_i1 ON pgboss.j62362595b2c644435af6b6d4e7f46ec15b6873418278eee93b30c295 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j62362595b2c644435af6b6d4e7f46ec15b6873418278eee93b30c295_i2 ON pgboss.j62362595b2c644435af6b6d4e7f46ec15b6873418278eee93b30c295 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j62362595b2c644435af6b6d4e7f46ec15b6873418278eee93b30c295_i3 ON pgboss.j62362595b2c644435af6b6d4e7f46ec15b6873418278eee93b30c295 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j62362595b2c644435af6b6d4e7f46ec15b6873418278eee93b30c295_i4 ON pgboss.j62362595b2c644435af6b6d4e7f46ec15b6873418278eee93b30c295 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j62362595b2c644435af6b6d4e7f46ec15b6873418278eee93b30c295_i5 ON pgboss.j62362595b2c644435af6b6d4e7f46ec15b6873418278eee93b30c295 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX j62362595b2c644435af6b6d4e7f46ec15b6873418278eee93b30c295_pkey ON pgboss.j62362595b2c644435af6b6d4e7f46ec15b6873418278eee93b30c295 USING btree (name, id);

CREATE UNIQUE INDEX j65e3e7ae1d8ab50c48bc2c5f22786b64661e3588c75e80237c42a207_i1 ON pgboss.j65e3e7ae1d8ab50c48bc2c5f22786b64661e3588c75e80237c42a207 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j65e3e7ae1d8ab50c48bc2c5f22786b64661e3588c75e80237c42a207_i2 ON pgboss.j65e3e7ae1d8ab50c48bc2c5f22786b64661e3588c75e80237c42a207 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j65e3e7ae1d8ab50c48bc2c5f22786b64661e3588c75e80237c42a207_i3 ON pgboss.j65e3e7ae1d8ab50c48bc2c5f22786b64661e3588c75e80237c42a207 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j65e3e7ae1d8ab50c48bc2c5f22786b64661e3588c75e80237c42a207_i4 ON pgboss.j65e3e7ae1d8ab50c48bc2c5f22786b64661e3588c75e80237c42a207 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j65e3e7ae1d8ab50c48bc2c5f22786b64661e3588c75e80237c42a207_i5 ON pgboss.j65e3e7ae1d8ab50c48bc2c5f22786b64661e3588c75e80237c42a207 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX j65e3e7ae1d8ab50c48bc2c5f22786b64661e3588c75e80237c42a207_pkey ON pgboss.j65e3e7ae1d8ab50c48bc2c5f22786b64661e3588c75e80237c42a207 USING btree (name, id);

CREATE UNIQUE INDEX j7366837bee1de6bbd09b1187cec3a088873cf79db57a5139d56c9eaf_i1 ON pgboss.j7366837bee1de6bbd09b1187cec3a088873cf79db57a5139d56c9eaf USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j7366837bee1de6bbd09b1187cec3a088873cf79db57a5139d56c9eaf_i2 ON pgboss.j7366837bee1de6bbd09b1187cec3a088873cf79db57a5139d56c9eaf USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j7366837bee1de6bbd09b1187cec3a088873cf79db57a5139d56c9eaf_i3 ON pgboss.j7366837bee1de6bbd09b1187cec3a088873cf79db57a5139d56c9eaf USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j7366837bee1de6bbd09b1187cec3a088873cf79db57a5139d56c9eaf_i4 ON pgboss.j7366837bee1de6bbd09b1187cec3a088873cf79db57a5139d56c9eaf USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j7366837bee1de6bbd09b1187cec3a088873cf79db57a5139d56c9eaf_i5 ON pgboss.j7366837bee1de6bbd09b1187cec3a088873cf79db57a5139d56c9eaf USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX j7366837bee1de6bbd09b1187cec3a088873cf79db57a5139d56c9eaf_pkey ON pgboss.j7366837bee1de6bbd09b1187cec3a088873cf79db57a5139d56c9eaf USING btree (name, id);

CREATE UNIQUE INDEX j74eaf89cd1079d79baee7731c939029aeb2c484aa8983416bb6c3687_i1 ON pgboss.j74eaf89cd1079d79baee7731c939029aeb2c484aa8983416bb6c3687 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j74eaf89cd1079d79baee7731c939029aeb2c484aa8983416bb6c3687_i2 ON pgboss.j74eaf89cd1079d79baee7731c939029aeb2c484aa8983416bb6c3687 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j74eaf89cd1079d79baee7731c939029aeb2c484aa8983416bb6c3687_i3 ON pgboss.j74eaf89cd1079d79baee7731c939029aeb2c484aa8983416bb6c3687 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j74eaf89cd1079d79baee7731c939029aeb2c484aa8983416bb6c3687_i4 ON pgboss.j74eaf89cd1079d79baee7731c939029aeb2c484aa8983416bb6c3687 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j74eaf89cd1079d79baee7731c939029aeb2c484aa8983416bb6c3687_i5 ON pgboss.j74eaf89cd1079d79baee7731c939029aeb2c484aa8983416bb6c3687 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX j74eaf89cd1079d79baee7731c939029aeb2c484aa8983416bb6c3687_pkey ON pgboss.j74eaf89cd1079d79baee7731c939029aeb2c484aa8983416bb6c3687 USING btree (name, id);

CREATE UNIQUE INDEX j7a857c868c95a7707b7aa3215014d045670840b3351777d961aadfb1_i1 ON pgboss.j7a857c868c95a7707b7aa3215014d045670840b3351777d961aadfb1 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j7a857c868c95a7707b7aa3215014d045670840b3351777d961aadfb1_i2 ON pgboss.j7a857c868c95a7707b7aa3215014d045670840b3351777d961aadfb1 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j7a857c868c95a7707b7aa3215014d045670840b3351777d961aadfb1_i3 ON pgboss.j7a857c868c95a7707b7aa3215014d045670840b3351777d961aadfb1 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j7a857c868c95a7707b7aa3215014d045670840b3351777d961aadfb1_i4 ON pgboss.j7a857c868c95a7707b7aa3215014d045670840b3351777d961aadfb1 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j7a857c868c95a7707b7aa3215014d045670840b3351777d961aadfb1_i5 ON pgboss.j7a857c868c95a7707b7aa3215014d045670840b3351777d961aadfb1 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX j7a857c868c95a7707b7aa3215014d045670840b3351777d961aadfb1_pkey ON pgboss.j7a857c868c95a7707b7aa3215014d045670840b3351777d961aadfb1 USING btree (name, id);

CREATE UNIQUE INDEX j7f0c2500b29c6260adf041dec7b6ad7b71bb2896f61123293118291d_i1 ON pgboss.j7f0c2500b29c6260adf041dec7b6ad7b71bb2896f61123293118291d USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j7f0c2500b29c6260adf041dec7b6ad7b71bb2896f61123293118291d_i2 ON pgboss.j7f0c2500b29c6260adf041dec7b6ad7b71bb2896f61123293118291d USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j7f0c2500b29c6260adf041dec7b6ad7b71bb2896f61123293118291d_i3 ON pgboss.j7f0c2500b29c6260adf041dec7b6ad7b71bb2896f61123293118291d USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j7f0c2500b29c6260adf041dec7b6ad7b71bb2896f61123293118291d_i4 ON pgboss.j7f0c2500b29c6260adf041dec7b6ad7b71bb2896f61123293118291d USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j7f0c2500b29c6260adf041dec7b6ad7b71bb2896f61123293118291d_i5 ON pgboss.j7f0c2500b29c6260adf041dec7b6ad7b71bb2896f61123293118291d USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX j7f0c2500b29c6260adf041dec7b6ad7b71bb2896f61123293118291d_pkey ON pgboss.j7f0c2500b29c6260adf041dec7b6ad7b71bb2896f61123293118291d USING btree (name, id);

CREATE UNIQUE INDEX j7f46e583d0abc66aceffd655d84cd99a72edd712ec92cfdd579e34fc_i1 ON pgboss.j7f46e583d0abc66aceffd655d84cd99a72edd712ec92cfdd579e34fc USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j7f46e583d0abc66aceffd655d84cd99a72edd712ec92cfdd579e34fc_i2 ON pgboss.j7f46e583d0abc66aceffd655d84cd99a72edd712ec92cfdd579e34fc USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j7f46e583d0abc66aceffd655d84cd99a72edd712ec92cfdd579e34fc_i3 ON pgboss.j7f46e583d0abc66aceffd655d84cd99a72edd712ec92cfdd579e34fc USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j7f46e583d0abc66aceffd655d84cd99a72edd712ec92cfdd579e34fc_i4 ON pgboss.j7f46e583d0abc66aceffd655d84cd99a72edd712ec92cfdd579e34fc USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j7f46e583d0abc66aceffd655d84cd99a72edd712ec92cfdd579e34fc_i5 ON pgboss.j7f46e583d0abc66aceffd655d84cd99a72edd712ec92cfdd579e34fc USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX j7f46e583d0abc66aceffd655d84cd99a72edd712ec92cfdd579e34fc_pkey ON pgboss.j7f46e583d0abc66aceffd655d84cd99a72edd712ec92cfdd579e34fc USING btree (name, id);

CREATE UNIQUE INDEX j81444f35593fb2ba7c6be51a1cc9206be2ab5e16fe361d6ee2b3a7c6_i1 ON pgboss.j81444f35593fb2ba7c6be51a1cc9206be2ab5e16fe361d6ee2b3a7c6 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j81444f35593fb2ba7c6be51a1cc9206be2ab5e16fe361d6ee2b3a7c6_i2 ON pgboss.j81444f35593fb2ba7c6be51a1cc9206be2ab5e16fe361d6ee2b3a7c6 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j81444f35593fb2ba7c6be51a1cc9206be2ab5e16fe361d6ee2b3a7c6_i3 ON pgboss.j81444f35593fb2ba7c6be51a1cc9206be2ab5e16fe361d6ee2b3a7c6 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j81444f35593fb2ba7c6be51a1cc9206be2ab5e16fe361d6ee2b3a7c6_i4 ON pgboss.j81444f35593fb2ba7c6be51a1cc9206be2ab5e16fe361d6ee2b3a7c6 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j81444f35593fb2ba7c6be51a1cc9206be2ab5e16fe361d6ee2b3a7c6_i5 ON pgboss.j81444f35593fb2ba7c6be51a1cc9206be2ab5e16fe361d6ee2b3a7c6 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX j81444f35593fb2ba7c6be51a1cc9206be2ab5e16fe361d6ee2b3a7c6_pkey ON pgboss.j81444f35593fb2ba7c6be51a1cc9206be2ab5e16fe361d6ee2b3a7c6 USING btree (name, id);

CREATE UNIQUE INDEX j856d54ad98b9316ca35cd0586f7cfe819b15b6891dc30cb5111cf1d8_i1 ON pgboss.j856d54ad98b9316ca35cd0586f7cfe819b15b6891dc30cb5111cf1d8 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j856d54ad98b9316ca35cd0586f7cfe819b15b6891dc30cb5111cf1d8_i2 ON pgboss.j856d54ad98b9316ca35cd0586f7cfe819b15b6891dc30cb5111cf1d8 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j856d54ad98b9316ca35cd0586f7cfe819b15b6891dc30cb5111cf1d8_i3 ON pgboss.j856d54ad98b9316ca35cd0586f7cfe819b15b6891dc30cb5111cf1d8 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j856d54ad98b9316ca35cd0586f7cfe819b15b6891dc30cb5111cf1d8_i4 ON pgboss.j856d54ad98b9316ca35cd0586f7cfe819b15b6891dc30cb5111cf1d8 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j856d54ad98b9316ca35cd0586f7cfe819b15b6891dc30cb5111cf1d8_i5 ON pgboss.j856d54ad98b9316ca35cd0586f7cfe819b15b6891dc30cb5111cf1d8 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX j856d54ad98b9316ca35cd0586f7cfe819b15b6891dc30cb5111cf1d8_pkey ON pgboss.j856d54ad98b9316ca35cd0586f7cfe819b15b6891dc30cb5111cf1d8 USING btree (name, id);

CREATE UNIQUE INDEX j85c7356970884dc50d1715045004824f4f5c61eac9b140ec7dadbaac_i1 ON pgboss.j85c7356970884dc50d1715045004824f4f5c61eac9b140ec7dadbaac USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j85c7356970884dc50d1715045004824f4f5c61eac9b140ec7dadbaac_i2 ON pgboss.j85c7356970884dc50d1715045004824f4f5c61eac9b140ec7dadbaac USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j85c7356970884dc50d1715045004824f4f5c61eac9b140ec7dadbaac_i3 ON pgboss.j85c7356970884dc50d1715045004824f4f5c61eac9b140ec7dadbaac USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j85c7356970884dc50d1715045004824f4f5c61eac9b140ec7dadbaac_i4 ON pgboss.j85c7356970884dc50d1715045004824f4f5c61eac9b140ec7dadbaac USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j85c7356970884dc50d1715045004824f4f5c61eac9b140ec7dadbaac_i5 ON pgboss.j85c7356970884dc50d1715045004824f4f5c61eac9b140ec7dadbaac USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX j85c7356970884dc50d1715045004824f4f5c61eac9b140ec7dadbaac_pkey ON pgboss.j85c7356970884dc50d1715045004824f4f5c61eac9b140ec7dadbaac USING btree (name, id);

CREATE UNIQUE INDEX j8c119d8a760829826696fdefd2ec870aeeb47fe899f7fcd9eb2b1772_i1 ON pgboss.j8c119d8a760829826696fdefd2ec870aeeb47fe899f7fcd9eb2b1772 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j8c119d8a760829826696fdefd2ec870aeeb47fe899f7fcd9eb2b1772_i2 ON pgboss.j8c119d8a760829826696fdefd2ec870aeeb47fe899f7fcd9eb2b1772 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j8c119d8a760829826696fdefd2ec870aeeb47fe899f7fcd9eb2b1772_i3 ON pgboss.j8c119d8a760829826696fdefd2ec870aeeb47fe899f7fcd9eb2b1772 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j8c119d8a760829826696fdefd2ec870aeeb47fe899f7fcd9eb2b1772_i4 ON pgboss.j8c119d8a760829826696fdefd2ec870aeeb47fe899f7fcd9eb2b1772 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j8c119d8a760829826696fdefd2ec870aeeb47fe899f7fcd9eb2b1772_i5 ON pgboss.j8c119d8a760829826696fdefd2ec870aeeb47fe899f7fcd9eb2b1772 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX j8c119d8a760829826696fdefd2ec870aeeb47fe899f7fcd9eb2b1772_pkey ON pgboss.j8c119d8a760829826696fdefd2ec870aeeb47fe899f7fcd9eb2b1772 USING btree (name, id);

CREATE UNIQUE INDEX j93e89fa439fd38f2c7e454c34bc55898b673a56f50611fa8c99107b4_i1 ON pgboss.j93e89fa439fd38f2c7e454c34bc55898b673a56f50611fa8c99107b4 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j93e89fa439fd38f2c7e454c34bc55898b673a56f50611fa8c99107b4_i2 ON pgboss.j93e89fa439fd38f2c7e454c34bc55898b673a56f50611fa8c99107b4 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j93e89fa439fd38f2c7e454c34bc55898b673a56f50611fa8c99107b4_i3 ON pgboss.j93e89fa439fd38f2c7e454c34bc55898b673a56f50611fa8c99107b4 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j93e89fa439fd38f2c7e454c34bc55898b673a56f50611fa8c99107b4_i4 ON pgboss.j93e89fa439fd38f2c7e454c34bc55898b673a56f50611fa8c99107b4 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j93e89fa439fd38f2c7e454c34bc55898b673a56f50611fa8c99107b4_i5 ON pgboss.j93e89fa439fd38f2c7e454c34bc55898b673a56f50611fa8c99107b4 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX j93e89fa439fd38f2c7e454c34bc55898b673a56f50611fa8c99107b4_pkey ON pgboss.j93e89fa439fd38f2c7e454c34bc55898b673a56f50611fa8c99107b4 USING btree (name, id);

CREATE UNIQUE INDEX j9563d8821f1397994f758aa8627af5363cf5d1d0b3d2edae93fc9ae6_i1 ON pgboss.j9563d8821f1397994f758aa8627af5363cf5d1d0b3d2edae93fc9ae6 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j9563d8821f1397994f758aa8627af5363cf5d1d0b3d2edae93fc9ae6_i2 ON pgboss.j9563d8821f1397994f758aa8627af5363cf5d1d0b3d2edae93fc9ae6 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j9563d8821f1397994f758aa8627af5363cf5d1d0b3d2edae93fc9ae6_i3 ON pgboss.j9563d8821f1397994f758aa8627af5363cf5d1d0b3d2edae93fc9ae6 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j9563d8821f1397994f758aa8627af5363cf5d1d0b3d2edae93fc9ae6_i4 ON pgboss.j9563d8821f1397994f758aa8627af5363cf5d1d0b3d2edae93fc9ae6 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j9563d8821f1397994f758aa8627af5363cf5d1d0b3d2edae93fc9ae6_i5 ON pgboss.j9563d8821f1397994f758aa8627af5363cf5d1d0b3d2edae93fc9ae6 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX j9563d8821f1397994f758aa8627af5363cf5d1d0b3d2edae93fc9ae6_pkey ON pgboss.j9563d8821f1397994f758aa8627af5363cf5d1d0b3d2edae93fc9ae6 USING btree (name, id);

CREATE UNIQUE INDEX j96fbc7bc51cc9013c362eac101db8c30a03b27ffa24c9772cd339a96_i1 ON pgboss.j96fbc7bc51cc9013c362eac101db8c30a03b27ffa24c9772cd339a96 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j96fbc7bc51cc9013c362eac101db8c30a03b27ffa24c9772cd339a96_i2 ON pgboss.j96fbc7bc51cc9013c362eac101db8c30a03b27ffa24c9772cd339a96 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j96fbc7bc51cc9013c362eac101db8c30a03b27ffa24c9772cd339a96_i3 ON pgboss.j96fbc7bc51cc9013c362eac101db8c30a03b27ffa24c9772cd339a96 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j96fbc7bc51cc9013c362eac101db8c30a03b27ffa24c9772cd339a96_i4 ON pgboss.j96fbc7bc51cc9013c362eac101db8c30a03b27ffa24c9772cd339a96 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j96fbc7bc51cc9013c362eac101db8c30a03b27ffa24c9772cd339a96_i5 ON pgboss.j96fbc7bc51cc9013c362eac101db8c30a03b27ffa24c9772cd339a96 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX j96fbc7bc51cc9013c362eac101db8c30a03b27ffa24c9772cd339a96_pkey ON pgboss.j96fbc7bc51cc9013c362eac101db8c30a03b27ffa24c9772cd339a96 USING btree (name, id);

CREATE UNIQUE INDEX j9a99bedc70b475d0bc99e8c36247fe3e7d636e080d30bd918a58e274_i1 ON pgboss.j9a99bedc70b475d0bc99e8c36247fe3e7d636e080d30bd918a58e274 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j9a99bedc70b475d0bc99e8c36247fe3e7d636e080d30bd918a58e274_i2 ON pgboss.j9a99bedc70b475d0bc99e8c36247fe3e7d636e080d30bd918a58e274 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j9a99bedc70b475d0bc99e8c36247fe3e7d636e080d30bd918a58e274_i3 ON pgboss.j9a99bedc70b475d0bc99e8c36247fe3e7d636e080d30bd918a58e274 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j9a99bedc70b475d0bc99e8c36247fe3e7d636e080d30bd918a58e274_i4 ON pgboss.j9a99bedc70b475d0bc99e8c36247fe3e7d636e080d30bd918a58e274 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j9a99bedc70b475d0bc99e8c36247fe3e7d636e080d30bd918a58e274_i5 ON pgboss.j9a99bedc70b475d0bc99e8c36247fe3e7d636e080d30bd918a58e274 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX j9a99bedc70b475d0bc99e8c36247fe3e7d636e080d30bd918a58e274_pkey ON pgboss.j9a99bedc70b475d0bc99e8c36247fe3e7d636e080d30bd918a58e274 USING btree (name, id);

CREATE UNIQUE INDEX j9bafadb7093981a69acefcde622f6bfe9f1d9fea5111a2c54af906c2_i1 ON pgboss.j9bafadb7093981a69acefcde622f6bfe9f1d9fea5111a2c54af906c2 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j9bafadb7093981a69acefcde622f6bfe9f1d9fea5111a2c54af906c2_i2 ON pgboss.j9bafadb7093981a69acefcde622f6bfe9f1d9fea5111a2c54af906c2 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j9bafadb7093981a69acefcde622f6bfe9f1d9fea5111a2c54af906c2_i3 ON pgboss.j9bafadb7093981a69acefcde622f6bfe9f1d9fea5111a2c54af906c2 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j9bafadb7093981a69acefcde622f6bfe9f1d9fea5111a2c54af906c2_i4 ON pgboss.j9bafadb7093981a69acefcde622f6bfe9f1d9fea5111a2c54af906c2 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j9bafadb7093981a69acefcde622f6bfe9f1d9fea5111a2c54af906c2_i5 ON pgboss.j9bafadb7093981a69acefcde622f6bfe9f1d9fea5111a2c54af906c2 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX j9bafadb7093981a69acefcde622f6bfe9f1d9fea5111a2c54af906c2_pkey ON pgboss.j9bafadb7093981a69acefcde622f6bfe9f1d9fea5111a2c54af906c2 USING btree (name, id);

CREATE UNIQUE INDEX j9e24d92cadfe1a5de1369fd66f5f84ed436c9ff10eafe22adc2ec71d_i1 ON pgboss.j9e24d92cadfe1a5de1369fd66f5f84ed436c9ff10eafe22adc2ec71d USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX j9e24d92cadfe1a5de1369fd66f5f84ed436c9ff10eafe22adc2ec71d_i2 ON pgboss.j9e24d92cadfe1a5de1369fd66f5f84ed436c9ff10eafe22adc2ec71d USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX j9e24d92cadfe1a5de1369fd66f5f84ed436c9ff10eafe22adc2ec71d_i3 ON pgboss.j9e24d92cadfe1a5de1369fd66f5f84ed436c9ff10eafe22adc2ec71d USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX j9e24d92cadfe1a5de1369fd66f5f84ed436c9ff10eafe22adc2ec71d_i4 ON pgboss.j9e24d92cadfe1a5de1369fd66f5f84ed436c9ff10eafe22adc2ec71d USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX j9e24d92cadfe1a5de1369fd66f5f84ed436c9ff10eafe22adc2ec71d_i5 ON pgboss.j9e24d92cadfe1a5de1369fd66f5f84ed436c9ff10eafe22adc2ec71d USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX j9e24d92cadfe1a5de1369fd66f5f84ed436c9ff10eafe22adc2ec71d_pkey ON pgboss.j9e24d92cadfe1a5de1369fd66f5f84ed436c9ff10eafe22adc2ec71d USING btree (name, id);

CREATE UNIQUE INDEX ja140fe9874ff015f3efbe309d045e74ca25bbf51fc7e64a4a54c09a0_i1 ON pgboss.ja140fe9874ff015f3efbe309d045e74ca25bbf51fc7e64a4a54c09a0 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX ja140fe9874ff015f3efbe309d045e74ca25bbf51fc7e64a4a54c09a0_i2 ON pgboss.ja140fe9874ff015f3efbe309d045e74ca25bbf51fc7e64a4a54c09a0 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX ja140fe9874ff015f3efbe309d045e74ca25bbf51fc7e64a4a54c09a0_i3 ON pgboss.ja140fe9874ff015f3efbe309d045e74ca25bbf51fc7e64a4a54c09a0 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX ja140fe9874ff015f3efbe309d045e74ca25bbf51fc7e64a4a54c09a0_i4 ON pgboss.ja140fe9874ff015f3efbe309d045e74ca25bbf51fc7e64a4a54c09a0 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX ja140fe9874ff015f3efbe309d045e74ca25bbf51fc7e64a4a54c09a0_i5 ON pgboss.ja140fe9874ff015f3efbe309d045e74ca25bbf51fc7e64a4a54c09a0 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX ja140fe9874ff015f3efbe309d045e74ca25bbf51fc7e64a4a54c09a0_pkey ON pgboss.ja140fe9874ff015f3efbe309d045e74ca25bbf51fc7e64a4a54c09a0 USING btree (name, id);

CREATE UNIQUE INDEX ja8a8843bd2b2f92ae407887b6256dd7e2430273a221d31f1a15ff54d_i1 ON pgboss.ja8a8843bd2b2f92ae407887b6256dd7e2430273a221d31f1a15ff54d USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX ja8a8843bd2b2f92ae407887b6256dd7e2430273a221d31f1a15ff54d_i2 ON pgboss.ja8a8843bd2b2f92ae407887b6256dd7e2430273a221d31f1a15ff54d USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX ja8a8843bd2b2f92ae407887b6256dd7e2430273a221d31f1a15ff54d_i3 ON pgboss.ja8a8843bd2b2f92ae407887b6256dd7e2430273a221d31f1a15ff54d USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX ja8a8843bd2b2f92ae407887b6256dd7e2430273a221d31f1a15ff54d_i4 ON pgboss.ja8a8843bd2b2f92ae407887b6256dd7e2430273a221d31f1a15ff54d USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX ja8a8843bd2b2f92ae407887b6256dd7e2430273a221d31f1a15ff54d_i5 ON pgboss.ja8a8843bd2b2f92ae407887b6256dd7e2430273a221d31f1a15ff54d USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX ja8a8843bd2b2f92ae407887b6256dd7e2430273a221d31f1a15ff54d_pkey ON pgboss.ja8a8843bd2b2f92ae407887b6256dd7e2430273a221d31f1a15ff54d USING btree (name, id);

CREATE UNIQUE INDEX jb6bb3b5824c8ea430e84e2940db9359408667b227c68d545bfa81495_i1 ON pgboss.jb6bb3b5824c8ea430e84e2940db9359408667b227c68d545bfa81495 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX jb6bb3b5824c8ea430e84e2940db9359408667b227c68d545bfa81495_i2 ON pgboss.jb6bb3b5824c8ea430e84e2940db9359408667b227c68d545bfa81495 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX jb6bb3b5824c8ea430e84e2940db9359408667b227c68d545bfa81495_i3 ON pgboss.jb6bb3b5824c8ea430e84e2940db9359408667b227c68d545bfa81495 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX jb6bb3b5824c8ea430e84e2940db9359408667b227c68d545bfa81495_i4 ON pgboss.jb6bb3b5824c8ea430e84e2940db9359408667b227c68d545bfa81495 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX jb6bb3b5824c8ea430e84e2940db9359408667b227c68d545bfa81495_i5 ON pgboss.jb6bb3b5824c8ea430e84e2940db9359408667b227c68d545bfa81495 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX jb6bb3b5824c8ea430e84e2940db9359408667b227c68d545bfa81495_pkey ON pgboss.jb6bb3b5824c8ea430e84e2940db9359408667b227c68d545bfa81495 USING btree (name, id);

CREATE UNIQUE INDEX jbfe6be70bfd5dd32770953210aafd2d07b2b2968fb9e266983f2e567_i1 ON pgboss.jbfe6be70bfd5dd32770953210aafd2d07b2b2968fb9e266983f2e567 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX jbfe6be70bfd5dd32770953210aafd2d07b2b2968fb9e266983f2e567_i2 ON pgboss.jbfe6be70bfd5dd32770953210aafd2d07b2b2968fb9e266983f2e567 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX jbfe6be70bfd5dd32770953210aafd2d07b2b2968fb9e266983f2e567_i3 ON pgboss.jbfe6be70bfd5dd32770953210aafd2d07b2b2968fb9e266983f2e567 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX jbfe6be70bfd5dd32770953210aafd2d07b2b2968fb9e266983f2e567_i4 ON pgboss.jbfe6be70bfd5dd32770953210aafd2d07b2b2968fb9e266983f2e567 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX jbfe6be70bfd5dd32770953210aafd2d07b2b2968fb9e266983f2e567_i5 ON pgboss.jbfe6be70bfd5dd32770953210aafd2d07b2b2968fb9e266983f2e567 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX jbfe6be70bfd5dd32770953210aafd2d07b2b2968fb9e266983f2e567_pkey ON pgboss.jbfe6be70bfd5dd32770953210aafd2d07b2b2968fb9e266983f2e567 USING btree (name, id);

CREATE UNIQUE INDEX jc3b284f1f3f3e0584ba2554b54d9633d9151c0202075344e862e0be6_i1 ON pgboss.jc3b284f1f3f3e0584ba2554b54d9633d9151c0202075344e862e0be6 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX jc3b284f1f3f3e0584ba2554b54d9633d9151c0202075344e862e0be6_i2 ON pgboss.jc3b284f1f3f3e0584ba2554b54d9633d9151c0202075344e862e0be6 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX jc3b284f1f3f3e0584ba2554b54d9633d9151c0202075344e862e0be6_i3 ON pgboss.jc3b284f1f3f3e0584ba2554b54d9633d9151c0202075344e862e0be6 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX jc3b284f1f3f3e0584ba2554b54d9633d9151c0202075344e862e0be6_i4 ON pgboss.jc3b284f1f3f3e0584ba2554b54d9633d9151c0202075344e862e0be6 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX jc3b284f1f3f3e0584ba2554b54d9633d9151c0202075344e862e0be6_i5 ON pgboss.jc3b284f1f3f3e0584ba2554b54d9633d9151c0202075344e862e0be6 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX jc3b284f1f3f3e0584ba2554b54d9633d9151c0202075344e862e0be6_pkey ON pgboss.jc3b284f1f3f3e0584ba2554b54d9633d9151c0202075344e862e0be6 USING btree (name, id);

CREATE UNIQUE INDEX jc4f43e4fc67c6cfde9f0e84c9314ec634c11b1b4ce04d7b85ddc8221_i1 ON pgboss.jc4f43e4fc67c6cfde9f0e84c9314ec634c11b1b4ce04d7b85ddc8221 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX jc4f43e4fc67c6cfde9f0e84c9314ec634c11b1b4ce04d7b85ddc8221_i2 ON pgboss.jc4f43e4fc67c6cfde9f0e84c9314ec634c11b1b4ce04d7b85ddc8221 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX jc4f43e4fc67c6cfde9f0e84c9314ec634c11b1b4ce04d7b85ddc8221_i3 ON pgboss.jc4f43e4fc67c6cfde9f0e84c9314ec634c11b1b4ce04d7b85ddc8221 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX jc4f43e4fc67c6cfde9f0e84c9314ec634c11b1b4ce04d7b85ddc8221_i4 ON pgboss.jc4f43e4fc67c6cfde9f0e84c9314ec634c11b1b4ce04d7b85ddc8221 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX jc4f43e4fc67c6cfde9f0e84c9314ec634c11b1b4ce04d7b85ddc8221_i5 ON pgboss.jc4f43e4fc67c6cfde9f0e84c9314ec634c11b1b4ce04d7b85ddc8221 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX jc4f43e4fc67c6cfde9f0e84c9314ec634c11b1b4ce04d7b85ddc8221_pkey ON pgboss.jc4f43e4fc67c6cfde9f0e84c9314ec634c11b1b4ce04d7b85ddc8221 USING btree (name, id);

CREATE UNIQUE INDEX jd19fbd02b617cc48cad5e04dde519cb8c55385c141d61a582718f30b_i1 ON pgboss.jd19fbd02b617cc48cad5e04dde519cb8c55385c141d61a582718f30b USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX jd19fbd02b617cc48cad5e04dde519cb8c55385c141d61a582718f30b_i2 ON pgboss.jd19fbd02b617cc48cad5e04dde519cb8c55385c141d61a582718f30b USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX jd19fbd02b617cc48cad5e04dde519cb8c55385c141d61a582718f30b_i3 ON pgboss.jd19fbd02b617cc48cad5e04dde519cb8c55385c141d61a582718f30b USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX jd19fbd02b617cc48cad5e04dde519cb8c55385c141d61a582718f30b_i4 ON pgboss.jd19fbd02b617cc48cad5e04dde519cb8c55385c141d61a582718f30b USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX jd19fbd02b617cc48cad5e04dde519cb8c55385c141d61a582718f30b_i5 ON pgboss.jd19fbd02b617cc48cad5e04dde519cb8c55385c141d61a582718f30b USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX jd19fbd02b617cc48cad5e04dde519cb8c55385c141d61a582718f30b_pkey ON pgboss.jd19fbd02b617cc48cad5e04dde519cb8c55385c141d61a582718f30b USING btree (name, id);

CREATE UNIQUE INDEX jd31543c12dafcf0388873088540ad425cf51e04178195a8057629023_i1 ON pgboss.jd31543c12dafcf0388873088540ad425cf51e04178195a8057629023 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX jd31543c12dafcf0388873088540ad425cf51e04178195a8057629023_i2 ON pgboss.jd31543c12dafcf0388873088540ad425cf51e04178195a8057629023 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX jd31543c12dafcf0388873088540ad425cf51e04178195a8057629023_i3 ON pgboss.jd31543c12dafcf0388873088540ad425cf51e04178195a8057629023 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX jd31543c12dafcf0388873088540ad425cf51e04178195a8057629023_i4 ON pgboss.jd31543c12dafcf0388873088540ad425cf51e04178195a8057629023 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX jd31543c12dafcf0388873088540ad425cf51e04178195a8057629023_i5 ON pgboss.jd31543c12dafcf0388873088540ad425cf51e04178195a8057629023 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX jd31543c12dafcf0388873088540ad425cf51e04178195a8057629023_pkey ON pgboss.jd31543c12dafcf0388873088540ad425cf51e04178195a8057629023 USING btree (name, id);

CREATE UNIQUE INDEX jd442d23c0525fe5305a418bd1d96d790241806b056c3dac97a07a25a_i1 ON pgboss.jd442d23c0525fe5305a418bd1d96d790241806b056c3dac97a07a25a USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX jd442d23c0525fe5305a418bd1d96d790241806b056c3dac97a07a25a_i2 ON pgboss.jd442d23c0525fe5305a418bd1d96d790241806b056c3dac97a07a25a USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX jd442d23c0525fe5305a418bd1d96d790241806b056c3dac97a07a25a_i3 ON pgboss.jd442d23c0525fe5305a418bd1d96d790241806b056c3dac97a07a25a USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX jd442d23c0525fe5305a418bd1d96d790241806b056c3dac97a07a25a_i4 ON pgboss.jd442d23c0525fe5305a418bd1d96d790241806b056c3dac97a07a25a USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX jd442d23c0525fe5305a418bd1d96d790241806b056c3dac97a07a25a_i5 ON pgboss.jd442d23c0525fe5305a418bd1d96d790241806b056c3dac97a07a25a USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX jd442d23c0525fe5305a418bd1d96d790241806b056c3dac97a07a25a_pkey ON pgboss.jd442d23c0525fe5305a418bd1d96d790241806b056c3dac97a07a25a USING btree (name, id);

CREATE UNIQUE INDEX jd4de1d3c2a088ea0767c30d7974c9579436fa347c61208d5e6f998ca_i1 ON pgboss.jd4de1d3c2a088ea0767c30d7974c9579436fa347c61208d5e6f998ca USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX jd4de1d3c2a088ea0767c30d7974c9579436fa347c61208d5e6f998ca_i2 ON pgboss.jd4de1d3c2a088ea0767c30d7974c9579436fa347c61208d5e6f998ca USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX jd4de1d3c2a088ea0767c30d7974c9579436fa347c61208d5e6f998ca_i3 ON pgboss.jd4de1d3c2a088ea0767c30d7974c9579436fa347c61208d5e6f998ca USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX jd4de1d3c2a088ea0767c30d7974c9579436fa347c61208d5e6f998ca_i4 ON pgboss.jd4de1d3c2a088ea0767c30d7974c9579436fa347c61208d5e6f998ca USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX jd4de1d3c2a088ea0767c30d7974c9579436fa347c61208d5e6f998ca_i5 ON pgboss.jd4de1d3c2a088ea0767c30d7974c9579436fa347c61208d5e6f998ca USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX jd4de1d3c2a088ea0767c30d7974c9579436fa347c61208d5e6f998ca_pkey ON pgboss.jd4de1d3c2a088ea0767c30d7974c9579436fa347c61208d5e6f998ca USING btree (name, id);

CREATE UNIQUE INDEX jd6a5c00363ad8705d1bf6988594c2729c9365c9941ca95152f0e84f5_i1 ON pgboss.jd6a5c00363ad8705d1bf6988594c2729c9365c9941ca95152f0e84f5 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX jd6a5c00363ad8705d1bf6988594c2729c9365c9941ca95152f0e84f5_i2 ON pgboss.jd6a5c00363ad8705d1bf6988594c2729c9365c9941ca95152f0e84f5 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX jd6a5c00363ad8705d1bf6988594c2729c9365c9941ca95152f0e84f5_i3 ON pgboss.jd6a5c00363ad8705d1bf6988594c2729c9365c9941ca95152f0e84f5 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX jd6a5c00363ad8705d1bf6988594c2729c9365c9941ca95152f0e84f5_i4 ON pgboss.jd6a5c00363ad8705d1bf6988594c2729c9365c9941ca95152f0e84f5 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX jd6a5c00363ad8705d1bf6988594c2729c9365c9941ca95152f0e84f5_i5 ON pgboss.jd6a5c00363ad8705d1bf6988594c2729c9365c9941ca95152f0e84f5 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX jd6a5c00363ad8705d1bf6988594c2729c9365c9941ca95152f0e84f5_pkey ON pgboss.jd6a5c00363ad8705d1bf6988594c2729c9365c9941ca95152f0e84f5 USING btree (name, id);

CREATE UNIQUE INDEX jdb8d5f8033c0fce6fe7291be33c409aa854ee1a51557132f4ece404b_i1 ON pgboss.jdb8d5f8033c0fce6fe7291be33c409aa854ee1a51557132f4ece404b USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX jdb8d5f8033c0fce6fe7291be33c409aa854ee1a51557132f4ece404b_i2 ON pgboss.jdb8d5f8033c0fce6fe7291be33c409aa854ee1a51557132f4ece404b USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX jdb8d5f8033c0fce6fe7291be33c409aa854ee1a51557132f4ece404b_i3 ON pgboss.jdb8d5f8033c0fce6fe7291be33c409aa854ee1a51557132f4ece404b USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX jdb8d5f8033c0fce6fe7291be33c409aa854ee1a51557132f4ece404b_i4 ON pgboss.jdb8d5f8033c0fce6fe7291be33c409aa854ee1a51557132f4ece404b USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX jdb8d5f8033c0fce6fe7291be33c409aa854ee1a51557132f4ece404b_i5 ON pgboss.jdb8d5f8033c0fce6fe7291be33c409aa854ee1a51557132f4ece404b USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX jdb8d5f8033c0fce6fe7291be33c409aa854ee1a51557132f4ece404b_pkey ON pgboss.jdb8d5f8033c0fce6fe7291be33c409aa854ee1a51557132f4ece404b USING btree (name, id);

CREATE UNIQUE INDEX je194883db8168f5b3faa57d619cfc0f47b5d57ee2e049c6704887b0d_i1 ON pgboss.je194883db8168f5b3faa57d619cfc0f47b5d57ee2e049c6704887b0d USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX je194883db8168f5b3faa57d619cfc0f47b5d57ee2e049c6704887b0d_i2 ON pgboss.je194883db8168f5b3faa57d619cfc0f47b5d57ee2e049c6704887b0d USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX je194883db8168f5b3faa57d619cfc0f47b5d57ee2e049c6704887b0d_i3 ON pgboss.je194883db8168f5b3faa57d619cfc0f47b5d57ee2e049c6704887b0d USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX je194883db8168f5b3faa57d619cfc0f47b5d57ee2e049c6704887b0d_i4 ON pgboss.je194883db8168f5b3faa57d619cfc0f47b5d57ee2e049c6704887b0d USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX je194883db8168f5b3faa57d619cfc0f47b5d57ee2e049c6704887b0d_i5 ON pgboss.je194883db8168f5b3faa57d619cfc0f47b5d57ee2e049c6704887b0d USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX je194883db8168f5b3faa57d619cfc0f47b5d57ee2e049c6704887b0d_pkey ON pgboss.je194883db8168f5b3faa57d619cfc0f47b5d57ee2e049c6704887b0d USING btree (name, id);

CREATE UNIQUE INDEX je40a4837a72589e8afb5db6ce4066cc5a2c1ade743b34dc386395baf_i1 ON pgboss.je40a4837a72589e8afb5db6ce4066cc5a2c1ade743b34dc386395baf USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX je40a4837a72589e8afb5db6ce4066cc5a2c1ade743b34dc386395baf_i2 ON pgboss.je40a4837a72589e8afb5db6ce4066cc5a2c1ade743b34dc386395baf USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX je40a4837a72589e8afb5db6ce4066cc5a2c1ade743b34dc386395baf_i3 ON pgboss.je40a4837a72589e8afb5db6ce4066cc5a2c1ade743b34dc386395baf USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX je40a4837a72589e8afb5db6ce4066cc5a2c1ade743b34dc386395baf_i4 ON pgboss.je40a4837a72589e8afb5db6ce4066cc5a2c1ade743b34dc386395baf USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX je40a4837a72589e8afb5db6ce4066cc5a2c1ade743b34dc386395baf_i5 ON pgboss.je40a4837a72589e8afb5db6ce4066cc5a2c1ade743b34dc386395baf USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX je40a4837a72589e8afb5db6ce4066cc5a2c1ade743b34dc386395baf_pkey ON pgboss.je40a4837a72589e8afb5db6ce4066cc5a2c1ade743b34dc386395baf USING btree (name, id);

CREATE UNIQUE INDEX je48c64b5dcac7f77221d4a73f8de49465b53a9b7708b4a3145eb2e16_i1 ON pgboss.je48c64b5dcac7f77221d4a73f8de49465b53a9b7708b4a3145eb2e16 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX je48c64b5dcac7f77221d4a73f8de49465b53a9b7708b4a3145eb2e16_i2 ON pgboss.je48c64b5dcac7f77221d4a73f8de49465b53a9b7708b4a3145eb2e16 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX je48c64b5dcac7f77221d4a73f8de49465b53a9b7708b4a3145eb2e16_i3 ON pgboss.je48c64b5dcac7f77221d4a73f8de49465b53a9b7708b4a3145eb2e16 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX je48c64b5dcac7f77221d4a73f8de49465b53a9b7708b4a3145eb2e16_i4 ON pgboss.je48c64b5dcac7f77221d4a73f8de49465b53a9b7708b4a3145eb2e16 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX je48c64b5dcac7f77221d4a73f8de49465b53a9b7708b4a3145eb2e16_i5 ON pgboss.je48c64b5dcac7f77221d4a73f8de49465b53a9b7708b4a3145eb2e16 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX je48c64b5dcac7f77221d4a73f8de49465b53a9b7708b4a3145eb2e16_pkey ON pgboss.je48c64b5dcac7f77221d4a73f8de49465b53a9b7708b4a3145eb2e16 USING btree (name, id);

CREATE UNIQUE INDEX je9a42f250cee0d3976f4512cfd2cbc9b0a9a4fa4208c77496f73b961_i1 ON pgboss.je9a42f250cee0d3976f4512cfd2cbc9b0a9a4fa4208c77496f73b961 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX je9a42f250cee0d3976f4512cfd2cbc9b0a9a4fa4208c77496f73b961_i2 ON pgboss.je9a42f250cee0d3976f4512cfd2cbc9b0a9a4fa4208c77496f73b961 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX je9a42f250cee0d3976f4512cfd2cbc9b0a9a4fa4208c77496f73b961_i3 ON pgboss.je9a42f250cee0d3976f4512cfd2cbc9b0a9a4fa4208c77496f73b961 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX je9a42f250cee0d3976f4512cfd2cbc9b0a9a4fa4208c77496f73b961_i4 ON pgboss.je9a42f250cee0d3976f4512cfd2cbc9b0a9a4fa4208c77496f73b961 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX je9a42f250cee0d3976f4512cfd2cbc9b0a9a4fa4208c77496f73b961_i5 ON pgboss.je9a42f250cee0d3976f4512cfd2cbc9b0a9a4fa4208c77496f73b961 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX je9a42f250cee0d3976f4512cfd2cbc9b0a9a4fa4208c77496f73b961_pkey ON pgboss.je9a42f250cee0d3976f4512cfd2cbc9b0a9a4fa4208c77496f73b961 USING btree (name, id);

CREATE UNIQUE INDEX jea85060b5607bdc3ef2b58f758995b9124f659d470d6cec22b204b71_i1 ON pgboss.jea85060b5607bdc3ef2b58f758995b9124f659d470d6cec22b204b71 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX jea85060b5607bdc3ef2b58f758995b9124f659d470d6cec22b204b71_i2 ON pgboss.jea85060b5607bdc3ef2b58f758995b9124f659d470d6cec22b204b71 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX jea85060b5607bdc3ef2b58f758995b9124f659d470d6cec22b204b71_i3 ON pgboss.jea85060b5607bdc3ef2b58f758995b9124f659d470d6cec22b204b71 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX jea85060b5607bdc3ef2b58f758995b9124f659d470d6cec22b204b71_i4 ON pgboss.jea85060b5607bdc3ef2b58f758995b9124f659d470d6cec22b204b71 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX jea85060b5607bdc3ef2b58f758995b9124f659d470d6cec22b204b71_i5 ON pgboss.jea85060b5607bdc3ef2b58f758995b9124f659d470d6cec22b204b71 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX jea85060b5607bdc3ef2b58f758995b9124f659d470d6cec22b204b71_pkey ON pgboss.jea85060b5607bdc3ef2b58f758995b9124f659d470d6cec22b204b71 USING btree (name, id);

CREATE UNIQUE INDEX jee5a4ed8b83cd79110f0de65b1132a50575d50670f0277c417c9749b_i1 ON pgboss.jee5a4ed8b83cd79110f0de65b1132a50575d50670f0277c417c9749b USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX jee5a4ed8b83cd79110f0de65b1132a50575d50670f0277c417c9749b_i2 ON pgboss.jee5a4ed8b83cd79110f0de65b1132a50575d50670f0277c417c9749b USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX jee5a4ed8b83cd79110f0de65b1132a50575d50670f0277c417c9749b_i3 ON pgboss.jee5a4ed8b83cd79110f0de65b1132a50575d50670f0277c417c9749b USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX jee5a4ed8b83cd79110f0de65b1132a50575d50670f0277c417c9749b_i4 ON pgboss.jee5a4ed8b83cd79110f0de65b1132a50575d50670f0277c417c9749b USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX jee5a4ed8b83cd79110f0de65b1132a50575d50670f0277c417c9749b_i5 ON pgboss.jee5a4ed8b83cd79110f0de65b1132a50575d50670f0277c417c9749b USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX jee5a4ed8b83cd79110f0de65b1132a50575d50670f0277c417c9749b_pkey ON pgboss.jee5a4ed8b83cd79110f0de65b1132a50575d50670f0277c417c9749b USING btree (name, id);

CREATE UNIQUE INDEX jf02cd78c21f22c64f831f3364dfa0d4baba406a92cbd29d75795829a_i1 ON pgboss.jf02cd78c21f22c64f831f3364dfa0d4baba406a92cbd29d75795829a USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX jf02cd78c21f22c64f831f3364dfa0d4baba406a92cbd29d75795829a_i2 ON pgboss.jf02cd78c21f22c64f831f3364dfa0d4baba406a92cbd29d75795829a USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX jf02cd78c21f22c64f831f3364dfa0d4baba406a92cbd29d75795829a_i3 ON pgboss.jf02cd78c21f22c64f831f3364dfa0d4baba406a92cbd29d75795829a USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX jf02cd78c21f22c64f831f3364dfa0d4baba406a92cbd29d75795829a_i4 ON pgboss.jf02cd78c21f22c64f831f3364dfa0d4baba406a92cbd29d75795829a USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX jf02cd78c21f22c64f831f3364dfa0d4baba406a92cbd29d75795829a_i5 ON pgboss.jf02cd78c21f22c64f831f3364dfa0d4baba406a92cbd29d75795829a USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX jf02cd78c21f22c64f831f3364dfa0d4baba406a92cbd29d75795829a_pkey ON pgboss.jf02cd78c21f22c64f831f3364dfa0d4baba406a92cbd29d75795829a USING btree (name, id);

CREATE UNIQUE INDEX jf6105e34c1cb87b2990e484aaa66dccbbd06e004c2c6efd6e2ac7afe_i1 ON pgboss.jf6105e34c1cb87b2990e484aaa66dccbbd06e004c2c6efd6e2ac7afe USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX jf6105e34c1cb87b2990e484aaa66dccbbd06e004c2c6efd6e2ac7afe_i2 ON pgboss.jf6105e34c1cb87b2990e484aaa66dccbbd06e004c2c6efd6e2ac7afe USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX jf6105e34c1cb87b2990e484aaa66dccbbd06e004c2c6efd6e2ac7afe_i3 ON pgboss.jf6105e34c1cb87b2990e484aaa66dccbbd06e004c2c6efd6e2ac7afe USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX jf6105e34c1cb87b2990e484aaa66dccbbd06e004c2c6efd6e2ac7afe_i4 ON pgboss.jf6105e34c1cb87b2990e484aaa66dccbbd06e004c2c6efd6e2ac7afe USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX jf6105e34c1cb87b2990e484aaa66dccbbd06e004c2c6efd6e2ac7afe_i5 ON pgboss.jf6105e34c1cb87b2990e484aaa66dccbbd06e004c2c6efd6e2ac7afe USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX jf6105e34c1cb87b2990e484aaa66dccbbd06e004c2c6efd6e2ac7afe_pkey ON pgboss.jf6105e34c1cb87b2990e484aaa66dccbbd06e004c2c6efd6e2ac7afe USING btree (name, id);

CREATE UNIQUE INDEX jfff85c8ab363e80c03564838251fc3256e3497fc8b72d65af3ae28b5_i1 ON pgboss.jfff85c8ab363e80c03564838251fc3256e3497fc8b72d65af3ae28b5 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));

CREATE UNIQUE INDEX jfff85c8ab363e80c03564838251fc3256e3497fc8b72d65af3ae28b5_i2 ON pgboss.jfff85c8ab363e80c03564838251fc3256e3497fc8b72d65af3ae28b5 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));

CREATE UNIQUE INDEX jfff85c8ab363e80c03564838251fc3256e3497fc8b72d65af3ae28b5_i3 ON pgboss.jfff85c8ab363e80c03564838251fc3256e3497fc8b72d65af3ae28b5 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));

CREATE UNIQUE INDEX jfff85c8ab363e80c03564838251fc3256e3497fc8b72d65af3ae28b5_i4 ON pgboss.jfff85c8ab363e80c03564838251fc3256e3497fc8b72d65af3ae28b5 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));

CREATE INDEX jfff85c8ab363e80c03564838251fc3256e3497fc8b72d65af3ae28b5_i5 ON pgboss.jfff85c8ab363e80c03564838251fc3256e3497fc8b72d65af3ae28b5 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);

CREATE UNIQUE INDEX jfff85c8ab363e80c03564838251fc3256e3497fc8b72d65af3ae28b5_pkey ON pgboss.jfff85c8ab363e80c03564838251fc3256e3497fc8b72d65af3ae28b5 USING btree (name, id);

CREATE UNIQUE INDEX job_pkey ON ONLY pgboss.job USING btree (name, id);

CREATE UNIQUE INDEX queue_pkey ON pgboss.queue USING btree (name);

CREATE UNIQUE INDEX schedule_pkey ON pgboss.schedule USING btree (name);

CREATE UNIQUE INDEX subscription_pkey ON pgboss.subscription USING btree (event, name);

CREATE UNIQUE INDEX version_pkey ON pgboss.version USING btree (version);

CREATE INDEX "FeedbackEvent_createdAt_idx" ON public."FeedbackEvent" USING btree ("createdAt");

CREATE INDEX "FeedbackEvent_eventType_occurredAt_idx" ON public."FeedbackEvent" USING btree ("eventType", "occurredAt");

CREATE INDEX "FeedbackEvent_messageSendId_eventType_occurredAt_idx" ON public."FeedbackEvent" USING btree ("messageSendId", "eventType", "occurredAt");

CREATE INDEX "Lead_businessId_idx" ON public."Lead" USING btree ("businessId");

CREATE INDEX "Lead_deletedAt_idx" ON public."Lead" USING btree ("deletedAt");

CREATE INDEX "ManagerAnalysis_createdAt_idx" ON public."ManagerAnalysis" USING btree ("createdAt");

CREATE UNIQUE INDEX "ManagerAnalysis_pkey" ON public."ManagerAnalysis" USING btree (id);

CREATE UNIQUE INDEX "ManagerAnalysis_runId_key" ON public."ManagerAnalysis" USING btree ("runId");

CREATE INDEX "ManagerAnalysis_weekStart_idx" ON public."ManagerAnalysis" USING btree ("weekStart");

CREATE INDEX "MessageDraft_leadId_approvalStatus_idx" ON public."MessageDraft" USING btree ("leadId", "approvalStatus");

CREATE INDEX "MessageSend_leadId_status_idx" ON public."MessageSend" USING btree ("leadId", status);

CREATE INDEX "MessageSend_sentAt_status_idx" ON public."MessageSend" USING btree ("sentAt", status);

CREATE INDEX "TrainingLabel_leadId_idx" ON public."TrainingLabel" USING btree ("leadId");

CREATE INDEX "business_contacts_businessId_idx" ON public.business_contacts USING btree ("businessId");

CREATE UNIQUE INDEX business_contacts_pkey ON public.business_contacts USING btree (id);

CREATE INDEX "business_conversions_businessId_idx" ON public.business_conversions USING btree ("businessId");

CREATE UNIQUE INDEX "business_conversions_businessId_leadId_key" ON public.business_conversions USING btree ("businessId", "leadId");

CREATE INDEX "business_conversions_leadId_idx" ON public.business_conversions USING btree ("leadId");

CREATE UNIQUE INDEX business_conversions_pkey ON public.business_conversions USING btree (id);

CREATE INDEX businesses_discovery_run_id_idx ON public.businesses USING btree (discovery_run_id);

CREATE INDEX businesses_pre_qualified_idx ON public.businesses USING btree (pre_qualified);

CREATE UNIQUE INDEX contact_recovery_items_business_id_icp_profile_id_key ON public.contact_recovery_items USING btree (business_id, icp_profile_id);

CREATE INDEX contact_recovery_items_discovery_run_id_idx ON public.contact_recovery_items USING btree (discovery_run_id);

CREATE INDEX contact_recovery_items_icp_profile_id_status_idx ON public.contact_recovery_items USING btree (icp_profile_id, status);

CREATE UNIQUE INDEX contact_recovery_items_pkey ON public.contact_recovery_items USING btree (id);

CREATE INDEX contact_recovery_items_reason_idx ON public.contact_recovery_items USING btree (reason);

CREATE INDEX contact_recovery_items_status_updated_at_idx ON public.contact_recovery_items USING btree (status, updated_at);

CREATE INDEX "discovery_cost_events_businessId_idx" ON public.discovery_cost_events USING btree ("businessId");

CREATE INDEX "discovery_cost_events_discoveryRunId_idx" ON public.discovery_cost_events USING btree ("discoveryRunId");

CREATE UNIQUE INDEX discovery_cost_events_pkey ON public.discovery_cost_events USING btree (id);

CREATE INDEX discovery_cost_events_provider_idx ON public.discovery_cost_events USING btree (provider);

CREATE INDEX lead_pipeline_events_job_id_idx ON public.lead_pipeline_events USING btree (job_id);

CREATE INDEX lead_pipeline_events_lead_id_occurred_at_idx ON public.lead_pipeline_events USING btree (lead_id, occurred_at);

CREATE UNIQUE INDEX lead_pipeline_events_pkey ON public.lead_pipeline_events USING btree (id);

CREATE INDEX lead_pipeline_events_stage_status_idx ON public.lead_pipeline_events USING btree (stage, status);

CREATE INDEX "lead_rejections_icpProfileId_idx" ON public.lead_rejections USING btree ("icpProfileId");

CREATE UNIQUE INDEX "lead_rejections_leadId_key" ON public.lead_rejections USING btree ("leadId");

CREATE UNIQUE INDEX lead_rejections_pkey ON public.lead_rejections USING btree (id);

CREATE INDEX lead_rejections_reason_idx ON public.lead_rejections USING btree (reason);

CREATE INDEX "manager_recommendation_records_analysisRunId_idx" ON public.manager_recommendation_records USING btree ("analysisRunId");

CREATE INDEX "manager_recommendation_records_icpProfileId_status_idx" ON public.manager_recommendation_records USING btree ("icpProfileId", status);

CREATE UNIQUE INDEX manager_recommendation_records_pkey ON public.manager_recommendation_records USING btree (id);

CREATE INDEX "manager_recommendation_records_status_createdAt_idx" ON public.manager_recommendation_records USING btree (status, "createdAt");

CREATE UNIQUE INDEX pipeline_settings_key_key ON public.pipeline_settings USING btree (key);

CREATE UNIQUE INDEX pipeline_settings_pkey ON public.pipeline_settings USING btree (id);

CREATE INDEX search_tasks_discovery_run_id_idx ON public.search_tasks USING btree (discovery_run_id);

CREATE UNIQUE INDEX search_tasks_task_type_query_hash_discovery_run_id_key ON public.search_tasks USING btree (task_type, query_hash, discovery_run_id);

alter table "pgboss"."archive" add constraint "archive_pkey" PRIMARY KEY using index "archive_pkey";

alter table "pgboss"."j08a4caf376c33f608770f8c03c86a5683a4f201d5bdadcb2d49ab8f4" add constraint "j08a4caf376c33f608770f8c03c86a5683a4f201d5bdadcb2d49ab8f4_pkey" PRIMARY KEY using index "j08a4caf376c33f608770f8c03c86a5683a4f201d5bdadcb2d49ab8f4_pkey";

alter table "pgboss"."j09d3b4cd0d2bd8982d6b8411f73f35d272a215d9af29e4fd8f096f78" add constraint "j09d3b4cd0d2bd8982d6b8411f73f35d272a215d9af29e4fd8f096f78_pkey" PRIMARY KEY using index "j09d3b4cd0d2bd8982d6b8411f73f35d272a215d9af29e4fd8f096f78_pkey";

alter table "pgboss"."j1013e69c81070069a20618f73308d64a467085da733b465e6c7482e6" add constraint "j1013e69c81070069a20618f73308d64a467085da733b465e6c7482e6_pkey" PRIMARY KEY using index "j1013e69c81070069a20618f73308d64a467085da733b465e6c7482e6_pkey";

alter table "pgboss"."j2cbce0e86cd2027d91b7f89322d0fa39967ca43558cf1e58ccb4efc7" add constraint "j2cbce0e86cd2027d91b7f89322d0fa39967ca43558cf1e58ccb4efc7_pkey" PRIMARY KEY using index "j2cbce0e86cd2027d91b7f89322d0fa39967ca43558cf1e58ccb4efc7_pkey";

alter table "pgboss"."j2ec38ec84ae710c0cc61646cf3ab0d97cadfc576b0a2a2223c9bbd0d" add constraint "j2ec38ec84ae710c0cc61646cf3ab0d97cadfc576b0a2a2223c9bbd0d_pkey" PRIMARY KEY using index "j2ec38ec84ae710c0cc61646cf3ab0d97cadfc576b0a2a2223c9bbd0d_pkey";

alter table "pgboss"."j2fda5fa249afd61d94d450bea30fcdc69fe12d72b19dbe46de6e01dc" add constraint "j2fda5fa249afd61d94d450bea30fcdc69fe12d72b19dbe46de6e01dc_pkey" PRIMARY KEY using index "j2fda5fa249afd61d94d450bea30fcdc69fe12d72b19dbe46de6e01dc_pkey";

alter table "pgboss"."j3439a9c67b3fe6f938233905da5e9950dfa0c86b4b049434aa69985b" add constraint "j3439a9c67b3fe6f938233905da5e9950dfa0c86b4b049434aa69985b_pkey" PRIMARY KEY using index "j3439a9c67b3fe6f938233905da5e9950dfa0c86b4b049434aa69985b_pkey";

alter table "pgboss"."j38c6f13b70081b52318ffca32760d310a2e988af0f26a6296b2202f9" add constraint "j38c6f13b70081b52318ffca32760d310a2e988af0f26a6296b2202f9_pkey" PRIMARY KEY using index "j38c6f13b70081b52318ffca32760d310a2e988af0f26a6296b2202f9_pkey";

alter table "pgboss"."j3bf5bc2325ebfa3abdcf0624bd070a1bd682f30889cd752114cd540f" add constraint "j3bf5bc2325ebfa3abdcf0624bd070a1bd682f30889cd752114cd540f_pkey" PRIMARY KEY using index "j3bf5bc2325ebfa3abdcf0624bd070a1bd682f30889cd752114cd540f_pkey";

alter table "pgboss"."j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3" add constraint "j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_pkey" PRIMARY KEY using index "j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_pkey";

alter table "pgboss"."j4530b6b83fe2f947dc0b10ef8f9886938e1ce3b48de4e00962173c05" add constraint "j4530b6b83fe2f947dc0b10ef8f9886938e1ce3b48de4e00962173c05_pkey" PRIMARY KEY using index "j4530b6b83fe2f947dc0b10ef8f9886938e1ce3b48de4e00962173c05_pkey";

alter table "pgboss"."j458f32dd7e19364c858d5a141e6768800f16f6729c9d6aee39ce892c" add constraint "j458f32dd7e19364c858d5a141e6768800f16f6729c9d6aee39ce892c_pkey" PRIMARY KEY using index "j458f32dd7e19364c858d5a141e6768800f16f6729c9d6aee39ce892c_pkey";

alter table "pgboss"."j48ea4d455d918dbbd82be88c3c7e00f2124ccc3f530044064048d960" add constraint "j48ea4d455d918dbbd82be88c3c7e00f2124ccc3f530044064048d960_pkey" PRIMARY KEY using index "j48ea4d455d918dbbd82be88c3c7e00f2124ccc3f530044064048d960_pkey";

alter table "pgboss"."j4e3f0bc26b70ce765c0d6597fbc835e92160729e8ee256af24b3ae30" add constraint "j4e3f0bc26b70ce765c0d6597fbc835e92160729e8ee256af24b3ae30_pkey" PRIMARY KEY using index "j4e3f0bc26b70ce765c0d6597fbc835e92160729e8ee256af24b3ae30_pkey";

alter table "pgboss"."j5328867a2176c7dd1ec6ff89bd0aa38f37a5e2658d131d6ff2e8de95" add constraint "j5328867a2176c7dd1ec6ff89bd0aa38f37a5e2658d131d6ff2e8de95_pkey" PRIMARY KEY using index "j5328867a2176c7dd1ec6ff89bd0aa38f37a5e2658d131d6ff2e8de95_pkey";

alter table "pgboss"."j5a4c315c1a92f8e46d354763f338288cc06242e9b9cd23e58703b6a4" add constraint "j5a4c315c1a92f8e46d354763f338288cc06242e9b9cd23e58703b6a4_pkey" PRIMARY KEY using index "j5a4c315c1a92f8e46d354763f338288cc06242e9b9cd23e58703b6a4_pkey";

alter table "pgboss"."j5da920745b4c9f268ebabda749957c0887d7e5b9d77a6d61a9b4cc50" add constraint "j5da920745b4c9f268ebabda749957c0887d7e5b9d77a6d61a9b4cc50_pkey" PRIMARY KEY using index "j5da920745b4c9f268ebabda749957c0887d7e5b9d77a6d61a9b4cc50_pkey";

alter table "pgboss"."j5f12ff84a5d223de9f2603765cdaeb15303e6824e2d1b5cefc5126b3" add constraint "j5f12ff84a5d223de9f2603765cdaeb15303e6824e2d1b5cefc5126b3_pkey" PRIMARY KEY using index "j5f12ff84a5d223de9f2603765cdaeb15303e6824e2d1b5cefc5126b3_pkey";

alter table "pgboss"."j60ba924ab6b9fcce1644d2da9decf1d7356a9c093e8014f11a2ddf9f" add constraint "j60ba924ab6b9fcce1644d2da9decf1d7356a9c093e8014f11a2ddf9f_pkey" PRIMARY KEY using index "j60ba924ab6b9fcce1644d2da9decf1d7356a9c093e8014f11a2ddf9f_pkey";

alter table "pgboss"."j62362595b2c644435af6b6d4e7f46ec15b6873418278eee93b30c295" add constraint "j62362595b2c644435af6b6d4e7f46ec15b6873418278eee93b30c295_pkey" PRIMARY KEY using index "j62362595b2c644435af6b6d4e7f46ec15b6873418278eee93b30c295_pkey";

alter table "pgboss"."j65e3e7ae1d8ab50c48bc2c5f22786b64661e3588c75e80237c42a207" add constraint "j65e3e7ae1d8ab50c48bc2c5f22786b64661e3588c75e80237c42a207_pkey" PRIMARY KEY using index "j65e3e7ae1d8ab50c48bc2c5f22786b64661e3588c75e80237c42a207_pkey";

alter table "pgboss"."j7366837bee1de6bbd09b1187cec3a088873cf79db57a5139d56c9eaf" add constraint "j7366837bee1de6bbd09b1187cec3a088873cf79db57a5139d56c9eaf_pkey" PRIMARY KEY using index "j7366837bee1de6bbd09b1187cec3a088873cf79db57a5139d56c9eaf_pkey";

alter table "pgboss"."j74eaf89cd1079d79baee7731c939029aeb2c484aa8983416bb6c3687" add constraint "j74eaf89cd1079d79baee7731c939029aeb2c484aa8983416bb6c3687_pkey" PRIMARY KEY using index "j74eaf89cd1079d79baee7731c939029aeb2c484aa8983416bb6c3687_pkey";

alter table "pgboss"."j7a857c868c95a7707b7aa3215014d045670840b3351777d961aadfb1" add constraint "j7a857c868c95a7707b7aa3215014d045670840b3351777d961aadfb1_pkey" PRIMARY KEY using index "j7a857c868c95a7707b7aa3215014d045670840b3351777d961aadfb1_pkey";

alter table "pgboss"."j7f0c2500b29c6260adf041dec7b6ad7b71bb2896f61123293118291d" add constraint "j7f0c2500b29c6260adf041dec7b6ad7b71bb2896f61123293118291d_pkey" PRIMARY KEY using index "j7f0c2500b29c6260adf041dec7b6ad7b71bb2896f61123293118291d_pkey";

alter table "pgboss"."j7f46e583d0abc66aceffd655d84cd99a72edd712ec92cfdd579e34fc" add constraint "j7f46e583d0abc66aceffd655d84cd99a72edd712ec92cfdd579e34fc_pkey" PRIMARY KEY using index "j7f46e583d0abc66aceffd655d84cd99a72edd712ec92cfdd579e34fc_pkey";

alter table "pgboss"."j81444f35593fb2ba7c6be51a1cc9206be2ab5e16fe361d6ee2b3a7c6" add constraint "j81444f35593fb2ba7c6be51a1cc9206be2ab5e16fe361d6ee2b3a7c6_pkey" PRIMARY KEY using index "j81444f35593fb2ba7c6be51a1cc9206be2ab5e16fe361d6ee2b3a7c6_pkey";

alter table "pgboss"."j856d54ad98b9316ca35cd0586f7cfe819b15b6891dc30cb5111cf1d8" add constraint "j856d54ad98b9316ca35cd0586f7cfe819b15b6891dc30cb5111cf1d8_pkey" PRIMARY KEY using index "j856d54ad98b9316ca35cd0586f7cfe819b15b6891dc30cb5111cf1d8_pkey";

alter table "pgboss"."j85c7356970884dc50d1715045004824f4f5c61eac9b140ec7dadbaac" add constraint "j85c7356970884dc50d1715045004824f4f5c61eac9b140ec7dadbaac_pkey" PRIMARY KEY using index "j85c7356970884dc50d1715045004824f4f5c61eac9b140ec7dadbaac_pkey";

alter table "pgboss"."j8c119d8a760829826696fdefd2ec870aeeb47fe899f7fcd9eb2b1772" add constraint "j8c119d8a760829826696fdefd2ec870aeeb47fe899f7fcd9eb2b1772_pkey" PRIMARY KEY using index "j8c119d8a760829826696fdefd2ec870aeeb47fe899f7fcd9eb2b1772_pkey";

alter table "pgboss"."j93e89fa439fd38f2c7e454c34bc55898b673a56f50611fa8c99107b4" add constraint "j93e89fa439fd38f2c7e454c34bc55898b673a56f50611fa8c99107b4_pkey" PRIMARY KEY using index "j93e89fa439fd38f2c7e454c34bc55898b673a56f50611fa8c99107b4_pkey";

alter table "pgboss"."j9563d8821f1397994f758aa8627af5363cf5d1d0b3d2edae93fc9ae6" add constraint "j9563d8821f1397994f758aa8627af5363cf5d1d0b3d2edae93fc9ae6_pkey" PRIMARY KEY using index "j9563d8821f1397994f758aa8627af5363cf5d1d0b3d2edae93fc9ae6_pkey";

alter table "pgboss"."j96fbc7bc51cc9013c362eac101db8c30a03b27ffa24c9772cd339a96" add constraint "j96fbc7bc51cc9013c362eac101db8c30a03b27ffa24c9772cd339a96_pkey" PRIMARY KEY using index "j96fbc7bc51cc9013c362eac101db8c30a03b27ffa24c9772cd339a96_pkey";

alter table "pgboss"."j9a99bedc70b475d0bc99e8c36247fe3e7d636e080d30bd918a58e274" add constraint "j9a99bedc70b475d0bc99e8c36247fe3e7d636e080d30bd918a58e274_pkey" PRIMARY KEY using index "j9a99bedc70b475d0bc99e8c36247fe3e7d636e080d30bd918a58e274_pkey";

alter table "pgboss"."j9bafadb7093981a69acefcde622f6bfe9f1d9fea5111a2c54af906c2" add constraint "j9bafadb7093981a69acefcde622f6bfe9f1d9fea5111a2c54af906c2_pkey" PRIMARY KEY using index "j9bafadb7093981a69acefcde622f6bfe9f1d9fea5111a2c54af906c2_pkey";

alter table "pgboss"."j9e24d92cadfe1a5de1369fd66f5f84ed436c9ff10eafe22adc2ec71d" add constraint "j9e24d92cadfe1a5de1369fd66f5f84ed436c9ff10eafe22adc2ec71d_pkey" PRIMARY KEY using index "j9e24d92cadfe1a5de1369fd66f5f84ed436c9ff10eafe22adc2ec71d_pkey";

alter table "pgboss"."ja140fe9874ff015f3efbe309d045e74ca25bbf51fc7e64a4a54c09a0" add constraint "ja140fe9874ff015f3efbe309d045e74ca25bbf51fc7e64a4a54c09a0_pkey" PRIMARY KEY using index "ja140fe9874ff015f3efbe309d045e74ca25bbf51fc7e64a4a54c09a0_pkey";

alter table "pgboss"."ja8a8843bd2b2f92ae407887b6256dd7e2430273a221d31f1a15ff54d" add constraint "ja8a8843bd2b2f92ae407887b6256dd7e2430273a221d31f1a15ff54d_pkey" PRIMARY KEY using index "ja8a8843bd2b2f92ae407887b6256dd7e2430273a221d31f1a15ff54d_pkey";

alter table "pgboss"."jb6bb3b5824c8ea430e84e2940db9359408667b227c68d545bfa81495" add constraint "jb6bb3b5824c8ea430e84e2940db9359408667b227c68d545bfa81495_pkey" PRIMARY KEY using index "jb6bb3b5824c8ea430e84e2940db9359408667b227c68d545bfa81495_pkey";

alter table "pgboss"."jbfe6be70bfd5dd32770953210aafd2d07b2b2968fb9e266983f2e567" add constraint "jbfe6be70bfd5dd32770953210aafd2d07b2b2968fb9e266983f2e567_pkey" PRIMARY KEY using index "jbfe6be70bfd5dd32770953210aafd2d07b2b2968fb9e266983f2e567_pkey";

alter table "pgboss"."jc3b284f1f3f3e0584ba2554b54d9633d9151c0202075344e862e0be6" add constraint "jc3b284f1f3f3e0584ba2554b54d9633d9151c0202075344e862e0be6_pkey" PRIMARY KEY using index "jc3b284f1f3f3e0584ba2554b54d9633d9151c0202075344e862e0be6_pkey";

alter table "pgboss"."jc4f43e4fc67c6cfde9f0e84c9314ec634c11b1b4ce04d7b85ddc8221" add constraint "jc4f43e4fc67c6cfde9f0e84c9314ec634c11b1b4ce04d7b85ddc8221_pkey" PRIMARY KEY using index "jc4f43e4fc67c6cfde9f0e84c9314ec634c11b1b4ce04d7b85ddc8221_pkey";

alter table "pgboss"."jd19fbd02b617cc48cad5e04dde519cb8c55385c141d61a582718f30b" add constraint "jd19fbd02b617cc48cad5e04dde519cb8c55385c141d61a582718f30b_pkey" PRIMARY KEY using index "jd19fbd02b617cc48cad5e04dde519cb8c55385c141d61a582718f30b_pkey";

alter table "pgboss"."jd31543c12dafcf0388873088540ad425cf51e04178195a8057629023" add constraint "jd31543c12dafcf0388873088540ad425cf51e04178195a8057629023_pkey" PRIMARY KEY using index "jd31543c12dafcf0388873088540ad425cf51e04178195a8057629023_pkey";

alter table "pgboss"."jd442d23c0525fe5305a418bd1d96d790241806b056c3dac97a07a25a" add constraint "jd442d23c0525fe5305a418bd1d96d790241806b056c3dac97a07a25a_pkey" PRIMARY KEY using index "jd442d23c0525fe5305a418bd1d96d790241806b056c3dac97a07a25a_pkey";

alter table "pgboss"."jd4de1d3c2a088ea0767c30d7974c9579436fa347c61208d5e6f998ca" add constraint "jd4de1d3c2a088ea0767c30d7974c9579436fa347c61208d5e6f998ca_pkey" PRIMARY KEY using index "jd4de1d3c2a088ea0767c30d7974c9579436fa347c61208d5e6f998ca_pkey";

alter table "pgboss"."jd6a5c00363ad8705d1bf6988594c2729c9365c9941ca95152f0e84f5" add constraint "jd6a5c00363ad8705d1bf6988594c2729c9365c9941ca95152f0e84f5_pkey" PRIMARY KEY using index "jd6a5c00363ad8705d1bf6988594c2729c9365c9941ca95152f0e84f5_pkey";

alter table "pgboss"."jdb8d5f8033c0fce6fe7291be33c409aa854ee1a51557132f4ece404b" add constraint "jdb8d5f8033c0fce6fe7291be33c409aa854ee1a51557132f4ece404b_pkey" PRIMARY KEY using index "jdb8d5f8033c0fce6fe7291be33c409aa854ee1a51557132f4ece404b_pkey";

alter table "pgboss"."je194883db8168f5b3faa57d619cfc0f47b5d57ee2e049c6704887b0d" add constraint "je194883db8168f5b3faa57d619cfc0f47b5d57ee2e049c6704887b0d_pkey" PRIMARY KEY using index "je194883db8168f5b3faa57d619cfc0f47b5d57ee2e049c6704887b0d_pkey";

alter table "pgboss"."je40a4837a72589e8afb5db6ce4066cc5a2c1ade743b34dc386395baf" add constraint "je40a4837a72589e8afb5db6ce4066cc5a2c1ade743b34dc386395baf_pkey" PRIMARY KEY using index "je40a4837a72589e8afb5db6ce4066cc5a2c1ade743b34dc386395baf_pkey";

alter table "pgboss"."je48c64b5dcac7f77221d4a73f8de49465b53a9b7708b4a3145eb2e16" add constraint "je48c64b5dcac7f77221d4a73f8de49465b53a9b7708b4a3145eb2e16_pkey" PRIMARY KEY using index "je48c64b5dcac7f77221d4a73f8de49465b53a9b7708b4a3145eb2e16_pkey";

alter table "pgboss"."je9a42f250cee0d3976f4512cfd2cbc9b0a9a4fa4208c77496f73b961" add constraint "je9a42f250cee0d3976f4512cfd2cbc9b0a9a4fa4208c77496f73b961_pkey" PRIMARY KEY using index "je9a42f250cee0d3976f4512cfd2cbc9b0a9a4fa4208c77496f73b961_pkey";

alter table "pgboss"."jea85060b5607bdc3ef2b58f758995b9124f659d470d6cec22b204b71" add constraint "jea85060b5607bdc3ef2b58f758995b9124f659d470d6cec22b204b71_pkey" PRIMARY KEY using index "jea85060b5607bdc3ef2b58f758995b9124f659d470d6cec22b204b71_pkey";

alter table "pgboss"."jee5a4ed8b83cd79110f0de65b1132a50575d50670f0277c417c9749b" add constraint "jee5a4ed8b83cd79110f0de65b1132a50575d50670f0277c417c9749b_pkey" PRIMARY KEY using index "jee5a4ed8b83cd79110f0de65b1132a50575d50670f0277c417c9749b_pkey";

alter table "pgboss"."jf02cd78c21f22c64f831f3364dfa0d4baba406a92cbd29d75795829a" add constraint "jf02cd78c21f22c64f831f3364dfa0d4baba406a92cbd29d75795829a_pkey" PRIMARY KEY using index "jf02cd78c21f22c64f831f3364dfa0d4baba406a92cbd29d75795829a_pkey";

alter table "pgboss"."jf6105e34c1cb87b2990e484aaa66dccbbd06e004c2c6efd6e2ac7afe" add constraint "jf6105e34c1cb87b2990e484aaa66dccbbd06e004c2c6efd6e2ac7afe_pkey" PRIMARY KEY using index "jf6105e34c1cb87b2990e484aaa66dccbbd06e004c2c6efd6e2ac7afe_pkey";

alter table "pgboss"."jfff85c8ab363e80c03564838251fc3256e3497fc8b72d65af3ae28b5" add constraint "jfff85c8ab363e80c03564838251fc3256e3497fc8b72d65af3ae28b5_pkey" PRIMARY KEY using index "jfff85c8ab363e80c03564838251fc3256e3497fc8b72d65af3ae28b5_pkey";

alter table "pgboss"."job" add constraint "job_pkey" PRIMARY KEY using index "job_pkey";

alter table "pgboss"."queue" add constraint "queue_pkey" PRIMARY KEY using index "queue_pkey";

alter table "pgboss"."schedule" add constraint "schedule_pkey" PRIMARY KEY using index "schedule_pkey";

alter table "pgboss"."subscription" add constraint "subscription_pkey" PRIMARY KEY using index "subscription_pkey";

alter table "pgboss"."version" add constraint "version_pkey" PRIMARY KEY using index "version_pkey";

alter table "public"."ManagerAnalysis" add constraint "ManagerAnalysis_pkey" PRIMARY KEY using index "ManagerAnalysis_pkey";

alter table "public"."business_contacts" add constraint "business_contacts_pkey" PRIMARY KEY using index "business_contacts_pkey";

alter table "public"."business_conversions" add constraint "business_conversions_pkey" PRIMARY KEY using index "business_conversions_pkey";

alter table "public"."contact_recovery_items" add constraint "contact_recovery_items_pkey" PRIMARY KEY using index "contact_recovery_items_pkey";

alter table "public"."discovery_cost_events" add constraint "discovery_cost_events_pkey" PRIMARY KEY using index "discovery_cost_events_pkey";

alter table "public"."lead_pipeline_events" add constraint "lead_pipeline_events_pkey" PRIMARY KEY using index "lead_pipeline_events_pkey";

alter table "public"."lead_rejections" add constraint "lead_rejections_pkey" PRIMARY KEY using index "lead_rejections_pkey";

alter table "public"."manager_recommendation_records" add constraint "manager_recommendation_records_pkey" PRIMARY KEY using index "manager_recommendation_records_pkey";

alter table "public"."pipeline_settings" add constraint "pipeline_settings_pkey" PRIMARY KEY using index "pipeline_settings_pkey";

alter table "pgboss"."j08a4caf376c33f608770f8c03c86a5683a4f201d5bdadcb2d49ab8f4" add constraint "cjc" CHECK ((name = 'business.prequalify'::text)) not valid;

alter table "pgboss"."j08a4caf376c33f608770f8c03c86a5683a4f201d5bdadcb2d49ab8f4" validate constraint "cjc";

alter table "pgboss"."j08a4caf376c33f608770f8c03c86a5683a4f201d5bdadcb2d49ab8f4" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j08a4caf376c33f608770f8c03c86a5683a4f201d5bdadcb2d49ab8f4" validate constraint "dlq_fkey";

alter table "pgboss"."j08a4caf376c33f608770f8c03c86a5683a4f201d5bdadcb2d49ab8f4" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j08a4caf376c33f608770f8c03c86a5683a4f201d5bdadcb2d49ab8f4" validate constraint "q_fkey";

alter table "pgboss"."j09d3b4cd0d2bd8982d6b8411f73f35d272a215d9af29e4fd8f096f78" add constraint "cjc" CHECK ((name = 'model.drift'::text)) not valid;

alter table "pgboss"."j09d3b4cd0d2bd8982d6b8411f73f35d272a215d9af29e4fd8f096f78" validate constraint "cjc";

alter table "pgboss"."j09d3b4cd0d2bd8982d6b8411f73f35d272a215d9af29e4fd8f096f78" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j09d3b4cd0d2bd8982d6b8411f73f35d272a215d9af29e4fd8f096f78" validate constraint "dlq_fkey";

alter table "pgboss"."j09d3b4cd0d2bd8982d6b8411f73f35d272a215d9af29e4fd8f096f78" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j09d3b4cd0d2bd8982d6b8411f73f35d272a215d9af29e4fd8f096f78" validate constraint "q_fkey";

alter table "pgboss"."j1013e69c81070069a20618f73308d64a467085da733b465e6c7482e6" add constraint "cjc" CHECK ((name = 'discovery.seed.dead_letter'::text)) not valid;

alter table "pgboss"."j1013e69c81070069a20618f73308d64a467085da733b465e6c7482e6" validate constraint "cjc";

alter table "pgboss"."j1013e69c81070069a20618f73308d64a467085da733b465e6c7482e6" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j1013e69c81070069a20618f73308d64a467085da733b465e6c7482e6" validate constraint "dlq_fkey";

alter table "pgboss"."j1013e69c81070069a20618f73308d64a467085da733b465e6c7482e6" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j1013e69c81070069a20618f73308d64a467085da733b465e6c7482e6" validate constraint "q_fkey";

alter table "pgboss"."j2cbce0e86cd2027d91b7f89322d0fa39967ca43558cf1e58ccb4efc7" add constraint "cjc" CHECK ((name = 'labels.generate.dead_letter'::text)) not valid;

alter table "pgboss"."j2cbce0e86cd2027d91b7f89322d0fa39967ca43558cf1e58ccb4efc7" validate constraint "cjc";

alter table "pgboss"."j2cbce0e86cd2027d91b7f89322d0fa39967ca43558cf1e58ccb4efc7" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j2cbce0e86cd2027d91b7f89322d0fa39967ca43558cf1e58ccb4efc7" validate constraint "dlq_fkey";

alter table "pgboss"."j2cbce0e86cd2027d91b7f89322d0fa39967ca43558cf1e58ccb4efc7" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j2cbce0e86cd2027d91b7f89322d0fa39967ca43558cf1e58ccb4efc7" validate constraint "q_fkey";

alter table "pgboss"."j2ec38ec84ae710c0cc61646cf3ab0d97cadfc576b0a2a2223c9bbd0d" add constraint "cjc" CHECK ((name = 'reply.classify.dead_letter'::text)) not valid;

alter table "pgboss"."j2ec38ec84ae710c0cc61646cf3ab0d97cadfc576b0a2a2223c9bbd0d" validate constraint "cjc";

alter table "pgboss"."j2ec38ec84ae710c0cc61646cf3ab0d97cadfc576b0a2a2223c9bbd0d" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j2ec38ec84ae710c0cc61646cf3ab0d97cadfc576b0a2a2223c9bbd0d" validate constraint "dlq_fkey";

alter table "pgboss"."j2ec38ec84ae710c0cc61646cf3ab0d97cadfc576b0a2a2223c9bbd0d" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j2ec38ec84ae710c0cc61646cf3ab0d97cadfc576b0a2a2223c9bbd0d" validate constraint "q_fkey";

alter table "pgboss"."j2fda5fa249afd61d94d450bea30fcdc69fe12d72b19dbe46de6e01dc" add constraint "cjc" CHECK ((name = 'manager.analyze'::text)) not valid;

alter table "pgboss"."j2fda5fa249afd61d94d450bea30fcdc69fe12d72b19dbe46de6e01dc" validate constraint "cjc";

alter table "pgboss"."j2fda5fa249afd61d94d450bea30fcdc69fe12d72b19dbe46de6e01dc" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j2fda5fa249afd61d94d450bea30fcdc69fe12d72b19dbe46de6e01dc" validate constraint "dlq_fkey";

alter table "pgboss"."j2fda5fa249afd61d94d450bea30fcdc69fe12d72b19dbe46de6e01dc" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j2fda5fa249afd61d94d450bea30fcdc69fe12d72b19dbe46de6e01dc" validate constraint "q_fkey";

alter table "pgboss"."j3439a9c67b3fe6f938233905da5e9950dfa0c86b4b049434aa69985b" add constraint "cjc" CHECK ((name = 'features.compute.dead_letter'::text)) not valid;

alter table "pgboss"."j3439a9c67b3fe6f938233905da5e9950dfa0c86b4b049434aa69985b" validate constraint "cjc";

alter table "pgboss"."j3439a9c67b3fe6f938233905da5e9950dfa0c86b4b049434aa69985b" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j3439a9c67b3fe6f938233905da5e9950dfa0c86b4b049434aa69985b" validate constraint "dlq_fkey";

alter table "pgboss"."j3439a9c67b3fe6f938233905da5e9950dfa0c86b4b049434aa69985b" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j3439a9c67b3fe6f938233905da5e9950dfa0c86b4b049434aa69985b" validate constraint "q_fkey";

alter table "pgboss"."j38c6f13b70081b52318ffca32760d310a2e988af0f26a6296b2202f9" add constraint "cjc" CHECK ((name = 'notify.sales.dead_letter'::text)) not valid;

alter table "pgboss"."j38c6f13b70081b52318ffca32760d310a2e988af0f26a6296b2202f9" validate constraint "cjc";

alter table "pgboss"."j38c6f13b70081b52318ffca32760d310a2e988af0f26a6296b2202f9" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j38c6f13b70081b52318ffca32760d310a2e988af0f26a6296b2202f9" validate constraint "dlq_fkey";

alter table "pgboss"."j38c6f13b70081b52318ffca32760d310a2e988af0f26a6296b2202f9" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j38c6f13b70081b52318ffca32760d310a2e988af0f26a6296b2202f9" validate constraint "q_fkey";

alter table "pgboss"."j3bf5bc2325ebfa3abdcf0624bd070a1bd682f30889cd752114cd540f" add constraint "cjc" CHECK ((name = 'outbox.cleanup.dead_letter'::text)) not valid;

alter table "pgboss"."j3bf5bc2325ebfa3abdcf0624bd070a1bd682f30889cd752114cd540f" validate constraint "cjc";

alter table "pgboss"."j3bf5bc2325ebfa3abdcf0624bd070a1bd682f30889cd752114cd540f" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j3bf5bc2325ebfa3abdcf0624bd070a1bd682f30889cd752114cd540f" validate constraint "dlq_fkey";

alter table "pgboss"."j3bf5bc2325ebfa3abdcf0624bd070a1bd682f30889cd752114cd540f" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j3bf5bc2325ebfa3abdcf0624bd070a1bd682f30889cd752114cd540f" validate constraint "q_fkey";

alter table "pgboss"."j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3" add constraint "cjc" CHECK ((name = '__pgboss__send-it'::text)) not valid;

alter table "pgboss"."j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3" validate constraint "cjc";

alter table "pgboss"."j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3" validate constraint "dlq_fkey";

alter table "pgboss"."j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3" validate constraint "q_fkey";

alter table "pgboss"."j4530b6b83fe2f947dc0b10ef8f9886938e1ce3b48de4e00962173c05" add constraint "cjc" CHECK ((name = 'model.drift.dead_letter'::text)) not valid;

alter table "pgboss"."j4530b6b83fe2f947dc0b10ef8f9886938e1ce3b48de4e00962173c05" validate constraint "cjc";

alter table "pgboss"."j4530b6b83fe2f947dc0b10ef8f9886938e1ce3b48de4e00962173c05" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j4530b6b83fe2f947dc0b10ef8f9886938e1ce3b48de4e00962173c05" validate constraint "dlq_fkey";

alter table "pgboss"."j4530b6b83fe2f947dc0b10ef8f9886938e1ce3b48de4e00962173c05" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j4530b6b83fe2f947dc0b10ef8f9886938e1ce3b48de4e00962173c05" validate constraint "q_fkey";

alter table "pgboss"."j458f32dd7e19364c858d5a141e6768800f16f6729c9d6aee39ce892c" add constraint "cjc" CHECK ((name = 'scoring.batch.dead_letter'::text)) not valid;

alter table "pgboss"."j458f32dd7e19364c858d5a141e6768800f16f6729c9d6aee39ce892c" validate constraint "cjc";

alter table "pgboss"."j458f32dd7e19364c858d5a141e6768800f16f6729c9d6aee39ce892c" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j458f32dd7e19364c858d5a141e6768800f16f6729c9d6aee39ce892c" validate constraint "dlq_fkey";

alter table "pgboss"."j458f32dd7e19364c858d5a141e6768800f16f6729c9d6aee39ce892c" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j458f32dd7e19364c858d5a141e6768800f16f6729c9d6aee39ce892c" validate constraint "q_fkey";

alter table "pgboss"."j48ea4d455d918dbbd82be88c3c7e00f2124ccc3f530044064048d960" add constraint "cjc" CHECK ((name = 'discovery.seed'::text)) not valid;

alter table "pgboss"."j48ea4d455d918dbbd82be88c3c7e00f2124ccc3f530044064048d960" validate constraint "cjc";

alter table "pgboss"."j48ea4d455d918dbbd82be88c3c7e00f2124ccc3f530044064048d960" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j48ea4d455d918dbbd82be88c3c7e00f2124ccc3f530044064048d960" validate constraint "dlq_fkey";

alter table "pgboss"."j48ea4d455d918dbbd82be88c3c7e00f2124ccc3f530044064048d960" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j48ea4d455d918dbbd82be88c3c7e00f2124ccc3f530044064048d960" validate constraint "q_fkey";

alter table "pgboss"."j4e3f0bc26b70ce765c0d6597fbc835e92160729e8ee256af24b3ae30" add constraint "cjc" CHECK ((name = 'model.train'::text)) not valid;

alter table "pgboss"."j4e3f0bc26b70ce765c0d6597fbc835e92160729e8ee256af24b3ae30" validate constraint "cjc";

alter table "pgboss"."j4e3f0bc26b70ce765c0d6597fbc835e92160729e8ee256af24b3ae30" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j4e3f0bc26b70ce765c0d6597fbc835e92160729e8ee256af24b3ae30" validate constraint "dlq_fkey";

alter table "pgboss"."j4e3f0bc26b70ce765c0d6597fbc835e92160729e8ee256af24b3ae30" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j4e3f0bc26b70ce765c0d6597fbc835e92160729e8ee256af24b3ae30" validate constraint "q_fkey";

alter table "pgboss"."j5328867a2176c7dd1ec6ff89bd0aa38f37a5e2658d131d6ff2e8de95" add constraint "cjc" CHECK ((name = 'data.retention.dead_letter'::text)) not valid;

alter table "pgboss"."j5328867a2176c7dd1ec6ff89bd0aa38f37a5e2658d131d6ff2e8de95" validate constraint "cjc";

alter table "pgboss"."j5328867a2176c7dd1ec6ff89bd0aa38f37a5e2658d131d6ff2e8de95" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j5328867a2176c7dd1ec6ff89bd0aa38f37a5e2658d131d6ff2e8de95" validate constraint "dlq_fkey";

alter table "pgboss"."j5328867a2176c7dd1ec6ff89bd0aa38f37a5e2658d131d6ff2e8de95" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j5328867a2176c7dd1ec6ff89bd0aa38f37a5e2658d131d6ff2e8de95" validate constraint "q_fkey";

alter table "pgboss"."j5a4c315c1a92f8e46d354763f338288cc06242e9b9cd23e58703b6a4" add constraint "cjc" CHECK ((name = 'message.send'::text)) not valid;

alter table "pgboss"."j5a4c315c1a92f8e46d354763f338288cc06242e9b9cd23e58703b6a4" validate constraint "cjc";

alter table "pgboss"."j5a4c315c1a92f8e46d354763f338288cc06242e9b9cd23e58703b6a4" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j5a4c315c1a92f8e46d354763f338288cc06242e9b9cd23e58703b6a4" validate constraint "dlq_fkey";

alter table "pgboss"."j5a4c315c1a92f8e46d354763f338288cc06242e9b9cd23e58703b6a4" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j5a4c315c1a92f8e46d354763f338288cc06242e9b9cd23e58703b6a4" validate constraint "q_fkey";

alter table "pgboss"."j5da920745b4c9f268ebabda749957c0887d7e5b9d77a6d61a9b4cc50" add constraint "cjc" CHECK ((name = 'labels.generate'::text)) not valid;

alter table "pgboss"."j5da920745b4c9f268ebabda749957c0887d7e5b9d77a6d61a9b4cc50" validate constraint "cjc";

alter table "pgboss"."j5da920745b4c9f268ebabda749957c0887d7e5b9d77a6d61a9b4cc50" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j5da920745b4c9f268ebabda749957c0887d7e5b9d77a6d61a9b4cc50" validate constraint "dlq_fkey";

alter table "pgboss"."j5da920745b4c9f268ebabda749957c0887d7e5b9d77a6d61a9b4cc50" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j5da920745b4c9f268ebabda749957c0887d7e5b9d77a6d61a9b4cc50" validate constraint "q_fkey";

alter table "pgboss"."j5f12ff84a5d223de9f2603765cdaeb15303e6824e2d1b5cefc5126b3" add constraint "cjc" CHECK ((name = 'business.convert'::text)) not valid;

alter table "pgboss"."j5f12ff84a5d223de9f2603765cdaeb15303e6824e2d1b5cefc5126b3" validate constraint "cjc";

alter table "pgboss"."j5f12ff84a5d223de9f2603765cdaeb15303e6824e2d1b5cefc5126b3" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j5f12ff84a5d223de9f2603765cdaeb15303e6824e2d1b5cefc5126b3" validate constraint "dlq_fkey";

alter table "pgboss"."j5f12ff84a5d223de9f2603765cdaeb15303e6824e2d1b5cefc5126b3" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j5f12ff84a5d223de9f2603765cdaeb15303e6824e2d1b5cefc5126b3" validate constraint "q_fkey";

alter table "pgboss"."j60ba924ab6b9fcce1644d2da9decf1d7356a9c093e8014f11a2ddf9f" add constraint "cjc" CHECK ((name = 'search-task.recovery'::text)) not valid;

alter table "pgboss"."j60ba924ab6b9fcce1644d2da9decf1d7356a9c093e8014f11a2ddf9f" validate constraint "cjc";

alter table "pgboss"."j60ba924ab6b9fcce1644d2da9decf1d7356a9c093e8014f11a2ddf9f" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j60ba924ab6b9fcce1644d2da9decf1d7356a9c093e8014f11a2ddf9f" validate constraint "dlq_fkey";

alter table "pgboss"."j60ba924ab6b9fcce1644d2da9decf1d7356a9c093e8014f11a2ddf9f" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j60ba924ab6b9fcce1644d2da9decf1d7356a9c093e8014f11a2ddf9f" validate constraint "q_fkey";

alter table "pgboss"."j62362595b2c644435af6b6d4e7f46ec15b6873418278eee93b30c295" add constraint "cjc" CHECK ((name = 'discovery.run.dead_letter'::text)) not valid;

alter table "pgboss"."j62362595b2c644435af6b6d4e7f46ec15b6873418278eee93b30c295" validate constraint "cjc";

alter table "pgboss"."j62362595b2c644435af6b6d4e7f46ec15b6873418278eee93b30c295" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j62362595b2c644435af6b6d4e7f46ec15b6873418278eee93b30c295" validate constraint "dlq_fkey";

alter table "pgboss"."j62362595b2c644435af6b6d4e7f46ec15b6873418278eee93b30c295" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j62362595b2c644435af6b6d4e7f46ec15b6873418278eee93b30c295" validate constraint "q_fkey";

alter table "pgboss"."j65e3e7ae1d8ab50c48bc2c5f22786b64661e3588c75e80237c42a207" add constraint "cjc" CHECK ((name = 'scoring.compute.dead_letter'::text)) not valid;

alter table "pgboss"."j65e3e7ae1d8ab50c48bc2c5f22786b64661e3588c75e80237c42a207" validate constraint "cjc";

alter table "pgboss"."j65e3e7ae1d8ab50c48bc2c5f22786b64661e3588c75e80237c42a207" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j65e3e7ae1d8ab50c48bc2c5f22786b64661e3588c75e80237c42a207" validate constraint "dlq_fkey";

alter table "pgboss"."j65e3e7ae1d8ab50c48bc2c5f22786b64661e3588c75e80237c42a207" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j65e3e7ae1d8ab50c48bc2c5f22786b64661e3588c75e80237c42a207" validate constraint "q_fkey";

alter table "pgboss"."j7366837bee1de6bbd09b1187cec3a088873cf79db57a5139d56c9eaf" add constraint "cjc" CHECK ((name = 'pipeline.health.dead_letter'::text)) not valid;

alter table "pgboss"."j7366837bee1de6bbd09b1187cec3a088873cf79db57a5139d56c9eaf" validate constraint "cjc";

alter table "pgboss"."j7366837bee1de6bbd09b1187cec3a088873cf79db57a5139d56c9eaf" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j7366837bee1de6bbd09b1187cec3a088873cf79db57a5139d56c9eaf" validate constraint "dlq_fkey";

alter table "pgboss"."j7366837bee1de6bbd09b1187cec3a088873cf79db57a5139d56c9eaf" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j7366837bee1de6bbd09b1187cec3a088873cf79db57a5139d56c9eaf" validate constraint "q_fkey";

alter table "pgboss"."j74eaf89cd1079d79baee7731c939029aeb2c484aa8983416bb6c3687" add constraint "cjc" CHECK ((name = 'manager.analyze.dead_letter'::text)) not valid;

alter table "pgboss"."j74eaf89cd1079d79baee7731c939029aeb2c484aa8983416bb6c3687" validate constraint "cjc";

alter table "pgboss"."j74eaf89cd1079d79baee7731c939029aeb2c484aa8983416bb6c3687" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j74eaf89cd1079d79baee7731c939029aeb2c484aa8983416bb6c3687" validate constraint "dlq_fkey";

alter table "pgboss"."j74eaf89cd1079d79baee7731c939029aeb2c484aa8983416bb6c3687" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j74eaf89cd1079d79baee7731c939029aeb2c484aa8983416bb6c3687" validate constraint "q_fkey";

alter table "pgboss"."j7a857c868c95a7707b7aa3215014d045670840b3351777d961aadfb1" add constraint "cjc" CHECK ((name = 'outbox.cleanup'::text)) not valid;

alter table "pgboss"."j7a857c868c95a7707b7aa3215014d045670840b3351777d961aadfb1" validate constraint "cjc";

alter table "pgboss"."j7a857c868c95a7707b7aa3215014d045670840b3351777d961aadfb1" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j7a857c868c95a7707b7aa3215014d045670840b3351777d961aadfb1" validate constraint "dlq_fkey";

alter table "pgboss"."j7a857c868c95a7707b7aa3215014d045670840b3351777d961aadfb1" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j7a857c868c95a7707b7aa3215014d045670840b3351777d961aadfb1" validate constraint "q_fkey";

alter table "pgboss"."j7f0c2500b29c6260adf041dec7b6ad7b71bb2896f61123293118291d" add constraint "cjc" CHECK ((name = 'model.evaluate'::text)) not valid;

alter table "pgboss"."j7f0c2500b29c6260adf041dec7b6ad7b71bb2896f61123293118291d" validate constraint "cjc";

alter table "pgboss"."j7f0c2500b29c6260adf041dec7b6ad7b71bb2896f61123293118291d" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j7f0c2500b29c6260adf041dec7b6ad7b71bb2896f61123293118291d" validate constraint "dlq_fkey";

alter table "pgboss"."j7f0c2500b29c6260adf041dec7b6ad7b71bb2896f61123293118291d" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j7f0c2500b29c6260adf041dec7b6ad7b71bb2896f61123293118291d" validate constraint "q_fkey";

alter table "pgboss"."j7f46e583d0abc66aceffd655d84cd99a72edd712ec92cfdd579e34fc" add constraint "cjc" CHECK ((name = 'model.train.dead_letter'::text)) not valid;

alter table "pgboss"."j7f46e583d0abc66aceffd655d84cd99a72edd712ec92cfdd579e34fc" validate constraint "cjc";

alter table "pgboss"."j7f46e583d0abc66aceffd655d84cd99a72edd712ec92cfdd579e34fc" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j7f46e583d0abc66aceffd655d84cd99a72edd712ec92cfdd579e34fc" validate constraint "dlq_fkey";

alter table "pgboss"."j7f46e583d0abc66aceffd655d84cd99a72edd712ec92cfdd579e34fc" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j7f46e583d0abc66aceffd655d84cd99a72edd712ec92cfdd579e34fc" validate constraint "q_fkey";

alter table "pgboss"."j81444f35593fb2ba7c6be51a1cc9206be2ab5e16fe361d6ee2b3a7c6" add constraint "cjc" CHECK ((name = 'notify.sales'::text)) not valid;

alter table "pgboss"."j81444f35593fb2ba7c6be51a1cc9206be2ab5e16fe361d6ee2b3a7c6" validate constraint "cjc";

alter table "pgboss"."j81444f35593fb2ba7c6be51a1cc9206be2ab5e16fe361d6ee2b3a7c6" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j81444f35593fb2ba7c6be51a1cc9206be2ab5e16fe361d6ee2b3a7c6" validate constraint "dlq_fkey";

alter table "pgboss"."j81444f35593fb2ba7c6be51a1cc9206be2ab5e16fe361d6ee2b3a7c6" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j81444f35593fb2ba7c6be51a1cc9206be2ab5e16fe361d6ee2b3a7c6" validate constraint "q_fkey";

alter table "pgboss"."j856d54ad98b9316ca35cd0586f7cfe819b15b6891dc30cb5111cf1d8" add constraint "cjc" CHECK ((name = 'message.generate'::text)) not valid;

alter table "pgboss"."j856d54ad98b9316ca35cd0586f7cfe819b15b6891dc30cb5111cf1d8" validate constraint "cjc";

alter table "pgboss"."j856d54ad98b9316ca35cd0586f7cfe819b15b6891dc30cb5111cf1d8" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j856d54ad98b9316ca35cd0586f7cfe819b15b6891dc30cb5111cf1d8" validate constraint "dlq_fkey";

alter table "pgboss"."j856d54ad98b9316ca35cd0586f7cfe819b15b6891dc30cb5111cf1d8" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j856d54ad98b9316ca35cd0586f7cfe819b15b6891dc30cb5111cf1d8" validate constraint "q_fkey";

alter table "pgboss"."j85c7356970884dc50d1715045004824f4f5c61eac9b140ec7dadbaac" add constraint "cjc" CHECK ((name = 'lead.recovery'::text)) not valid;

alter table "pgboss"."j85c7356970884dc50d1715045004824f4f5c61eac9b140ec7dadbaac" validate constraint "cjc";

alter table "pgboss"."j85c7356970884dc50d1715045004824f4f5c61eac9b140ec7dadbaac" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j85c7356970884dc50d1715045004824f4f5c61eac9b140ec7dadbaac" validate constraint "dlq_fkey";

alter table "pgboss"."j85c7356970884dc50d1715045004824f4f5c61eac9b140ec7dadbaac" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j85c7356970884dc50d1715045004824f4f5c61eac9b140ec7dadbaac" validate constraint "q_fkey";

alter table "pgboss"."j8c119d8a760829826696fdefd2ec870aeeb47fe899f7fcd9eb2b1772" add constraint "cjc" CHECK ((name = 'reply.classify'::text)) not valid;

alter table "pgboss"."j8c119d8a760829826696fdefd2ec870aeeb47fe899f7fcd9eb2b1772" validate constraint "cjc";

alter table "pgboss"."j8c119d8a760829826696fdefd2ec870aeeb47fe899f7fcd9eb2b1772" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j8c119d8a760829826696fdefd2ec870aeeb47fe899f7fcd9eb2b1772" validate constraint "dlq_fkey";

alter table "pgboss"."j8c119d8a760829826696fdefd2ec870aeeb47fe899f7fcd9eb2b1772" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j8c119d8a760829826696fdefd2ec870aeeb47fe899f7fcd9eb2b1772" validate constraint "q_fkey";

alter table "pgboss"."j93e89fa439fd38f2c7e454c34bc55898b673a56f50611fa8c99107b4" add constraint "cjc" CHECK ((name = 'lead.recovery.dead_letter'::text)) not valid;

alter table "pgboss"."j93e89fa439fd38f2c7e454c34bc55898b673a56f50611fa8c99107b4" validate constraint "cjc";

alter table "pgboss"."j93e89fa439fd38f2c7e454c34bc55898b673a56f50611fa8c99107b4" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j93e89fa439fd38f2c7e454c34bc55898b673a56f50611fa8c99107b4" validate constraint "dlq_fkey";

alter table "pgboss"."j93e89fa439fd38f2c7e454c34bc55898b673a56f50611fa8c99107b4" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j93e89fa439fd38f2c7e454c34bc55898b673a56f50611fa8c99107b4" validate constraint "q_fkey";

alter table "pgboss"."j9563d8821f1397994f758aa8627af5363cf5d1d0b3d2edae93fc9ae6" add constraint "cjc" CHECK ((name = 'scoring.batch'::text)) not valid;

alter table "pgboss"."j9563d8821f1397994f758aa8627af5363cf5d1d0b3d2edae93fc9ae6" validate constraint "cjc";

alter table "pgboss"."j9563d8821f1397994f758aa8627af5363cf5d1d0b3d2edae93fc9ae6" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j9563d8821f1397994f758aa8627af5363cf5d1d0b3d2edae93fc9ae6" validate constraint "dlq_fkey";

alter table "pgboss"."j9563d8821f1397994f758aa8627af5363cf5d1d0b3d2edae93fc9ae6" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j9563d8821f1397994f758aa8627af5363cf5d1d0b3d2edae93fc9ae6" validate constraint "q_fkey";

alter table "pgboss"."j96fbc7bc51cc9013c362eac101db8c30a03b27ffa24c9772cd339a96" add constraint "cjc" CHECK ((name = 'analytics.rollup'::text)) not valid;

alter table "pgboss"."j96fbc7bc51cc9013c362eac101db8c30a03b27ffa24c9772cd339a96" validate constraint "cjc";

alter table "pgboss"."j96fbc7bc51cc9013c362eac101db8c30a03b27ffa24c9772cd339a96" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j96fbc7bc51cc9013c362eac101db8c30a03b27ffa24c9772cd339a96" validate constraint "dlq_fkey";

alter table "pgboss"."j96fbc7bc51cc9013c362eac101db8c30a03b27ffa24c9772cd339a96" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j96fbc7bc51cc9013c362eac101db8c30a03b27ffa24c9772cd339a96" validate constraint "q_fkey";

alter table "pgboss"."j9a99bedc70b475d0bc99e8c36247fe3e7d636e080d30bd918a58e274" add constraint "cjc" CHECK ((name = 'message.generate.dead_letter'::text)) not valid;

alter table "pgboss"."j9a99bedc70b475d0bc99e8c36247fe3e7d636e080d30bd918a58e274" validate constraint "cjc";

alter table "pgboss"."j9a99bedc70b475d0bc99e8c36247fe3e7d636e080d30bd918a58e274" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j9a99bedc70b475d0bc99e8c36247fe3e7d636e080d30bd918a58e274" validate constraint "dlq_fkey";

alter table "pgboss"."j9a99bedc70b475d0bc99e8c36247fe3e7d636e080d30bd918a58e274" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j9a99bedc70b475d0bc99e8c36247fe3e7d636e080d30bd918a58e274" validate constraint "q_fkey";

alter table "pgboss"."j9bafadb7093981a69acefcde622f6bfe9f1d9fea5111a2c54af906c2" add constraint "cjc" CHECK ((name = 'enrichment.run'::text)) not valid;

alter table "pgboss"."j9bafadb7093981a69acefcde622f6bfe9f1d9fea5111a2c54af906c2" validate constraint "cjc";

alter table "pgboss"."j9bafadb7093981a69acefcde622f6bfe9f1d9fea5111a2c54af906c2" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j9bafadb7093981a69acefcde622f6bfe9f1d9fea5111a2c54af906c2" validate constraint "dlq_fkey";

alter table "pgboss"."j9bafadb7093981a69acefcde622f6bfe9f1d9fea5111a2c54af906c2" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j9bafadb7093981a69acefcde622f6bfe9f1d9fea5111a2c54af906c2" validate constraint "q_fkey";

alter table "pgboss"."j9e24d92cadfe1a5de1369fd66f5f84ed436c9ff10eafe22adc2ec71d" add constraint "cjc" CHECK ((name = 'data.retention'::text)) not valid;

alter table "pgboss"."j9e24d92cadfe1a5de1369fd66f5f84ed436c9ff10eafe22adc2ec71d" validate constraint "cjc";

alter table "pgboss"."j9e24d92cadfe1a5de1369fd66f5f84ed436c9ff10eafe22adc2ec71d" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j9e24d92cadfe1a5de1369fd66f5f84ed436c9ff10eafe22adc2ec71d" validate constraint "dlq_fkey";

alter table "pgboss"."j9e24d92cadfe1a5de1369fd66f5f84ed436c9ff10eafe22adc2ec71d" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."j9e24d92cadfe1a5de1369fd66f5f84ed436c9ff10eafe22adc2ec71d" validate constraint "q_fkey";

alter table "pgboss"."ja140fe9874ff015f3efbe309d045e74ca25bbf51fc7e64a4a54c09a0" add constraint "cjc" CHECK ((name = 'apollo.enrich'::text)) not valid;

alter table "pgboss"."ja140fe9874ff015f3efbe309d045e74ca25bbf51fc7e64a4a54c09a0" validate constraint "cjc";

alter table "pgboss"."ja140fe9874ff015f3efbe309d045e74ca25bbf51fc7e64a4a54c09a0" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."ja140fe9874ff015f3efbe309d045e74ca25bbf51fc7e64a4a54c09a0" validate constraint "dlq_fkey";

alter table "pgboss"."ja140fe9874ff015f3efbe309d045e74ca25bbf51fc7e64a4a54c09a0" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."ja140fe9874ff015f3efbe309d045e74ca25bbf51fc7e64a4a54c09a0" validate constraint "q_fkey";

alter table "pgboss"."ja8a8843bd2b2f92ae407887b6256dd7e2430273a221d31f1a15ff54d" add constraint "cjc" CHECK ((name = 'business.prequalify.dead_letter'::text)) not valid;

alter table "pgboss"."ja8a8843bd2b2f92ae407887b6256dd7e2430273a221d31f1a15ff54d" validate constraint "cjc";

alter table "pgboss"."ja8a8843bd2b2f92ae407887b6256dd7e2430273a221d31f1a15ff54d" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."ja8a8843bd2b2f92ae407887b6256dd7e2430273a221d31f1a15ff54d" validate constraint "dlq_fkey";

alter table "pgboss"."ja8a8843bd2b2f92ae407887b6256dd7e2430273a221d31f1a15ff54d" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."ja8a8843bd2b2f92ae407887b6256dd7e2430273a221d31f1a15ff54d" validate constraint "q_fkey";

alter table "pgboss"."jb6bb3b5824c8ea430e84e2940db9359408667b227c68d545bfa81495" add constraint "cjc" CHECK ((name = 'followup.check'::text)) not valid;

alter table "pgboss"."jb6bb3b5824c8ea430e84e2940db9359408667b227c68d545bfa81495" validate constraint "cjc";

alter table "pgboss"."jb6bb3b5824c8ea430e84e2940db9359408667b227c68d545bfa81495" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."jb6bb3b5824c8ea430e84e2940db9359408667b227c68d545bfa81495" validate constraint "dlq_fkey";

alter table "pgboss"."jb6bb3b5824c8ea430e84e2940db9359408667b227c68d545bfa81495" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."jb6bb3b5824c8ea430e84e2940db9359408667b227c68d545bfa81495" validate constraint "q_fkey";

alter table "pgboss"."jbfe6be70bfd5dd32770953210aafd2d07b2b2968fb9e266983f2e567" add constraint "cjc" CHECK ((name = 'features.compute'::text)) not valid;

alter table "pgboss"."jbfe6be70bfd5dd32770953210aafd2d07b2b2968fb9e266983f2e567" validate constraint "cjc";

alter table "pgboss"."jbfe6be70bfd5dd32770953210aafd2d07b2b2968fb9e266983f2e567" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."jbfe6be70bfd5dd32770953210aafd2d07b2b2968fb9e266983f2e567" validate constraint "dlq_fkey";

alter table "pgboss"."jbfe6be70bfd5dd32770953210aafd2d07b2b2968fb9e266983f2e567" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."jbfe6be70bfd5dd32770953210aafd2d07b2b2968fb9e266983f2e567" validate constraint "q_fkey";

alter table "pgboss"."jc3b284f1f3f3e0584ba2554b54d9633d9151c0202075344e862e0be6" add constraint "cjc" CHECK ((name = 'scoring.compute'::text)) not valid;

alter table "pgboss"."jc3b284f1f3f3e0584ba2554b54d9633d9151c0202075344e862e0be6" validate constraint "cjc";

alter table "pgboss"."jc3b284f1f3f3e0584ba2554b54d9633d9151c0202075344e862e0be6" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."jc3b284f1f3f3e0584ba2554b54d9633d9151c0202075344e862e0be6" validate constraint "dlq_fkey";

alter table "pgboss"."jc3b284f1f3f3e0584ba2554b54d9633d9151c0202075344e862e0be6" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."jc3b284f1f3f3e0584ba2554b54d9633d9151c0202075344e862e0be6" validate constraint "q_fkey";

alter table "pgboss"."jc4f43e4fc67c6cfde9f0e84c9314ec634c11b1b4ce04d7b85ddc8221" add constraint "cjc" CHECK ((name = 'apollo.enrich.dead_letter'::text)) not valid;

alter table "pgboss"."jc4f43e4fc67c6cfde9f0e84c9314ec634c11b1b4ce04d7b85ddc8221" validate constraint "cjc";

alter table "pgboss"."jc4f43e4fc67c6cfde9f0e84c9314ec634c11b1b4ce04d7b85ddc8221" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."jc4f43e4fc67c6cfde9f0e84c9314ec634c11b1b4ce04d7b85ddc8221" validate constraint "dlq_fkey";

alter table "pgboss"."jc4f43e4fc67c6cfde9f0e84c9314ec634c11b1b4ce04d7b85ddc8221" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."jc4f43e4fc67c6cfde9f0e84c9314ec634c11b1b4ce04d7b85ddc8221" validate constraint "q_fkey";

alter table "pgboss"."jd19fbd02b617cc48cad5e04dde519cb8c55385c141d61a582718f30b" add constraint "cjc" CHECK ((name = 'system.heartbeat'::text)) not valid;

alter table "pgboss"."jd19fbd02b617cc48cad5e04dde519cb8c55385c141d61a582718f30b" validate constraint "cjc";

alter table "pgboss"."jd19fbd02b617cc48cad5e04dde519cb8c55385c141d61a582718f30b" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."jd19fbd02b617cc48cad5e04dde519cb8c55385c141d61a582718f30b" validate constraint "dlq_fkey";

alter table "pgboss"."jd19fbd02b617cc48cad5e04dde519cb8c55385c141d61a582718f30b" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."jd19fbd02b617cc48cad5e04dde519cb8c55385c141d61a582718f30b" validate constraint "q_fkey";

alter table "pgboss"."jd31543c12dafcf0388873088540ad425cf51e04178195a8057629023" add constraint "cjc" CHECK ((name = 'business.convert.dead_letter'::text)) not valid;

alter table "pgboss"."jd31543c12dafcf0388873088540ad425cf51e04178195a8057629023" validate constraint "cjc";

alter table "pgboss"."jd31543c12dafcf0388873088540ad425cf51e04178195a8057629023" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."jd31543c12dafcf0388873088540ad425cf51e04178195a8057629023" validate constraint "dlq_fkey";

alter table "pgboss"."jd31543c12dafcf0388873088540ad425cf51e04178195a8057629023" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."jd31543c12dafcf0388873088540ad425cf51e04178195a8057629023" validate constraint "q_fkey";

alter table "pgboss"."jd442d23c0525fe5305a418bd1d96d790241806b056c3dac97a07a25a" add constraint "cjc" CHECK ((name = 'model.evaluate.dead_letter'::text)) not valid;

alter table "pgboss"."jd442d23c0525fe5305a418bd1d96d790241806b056c3dac97a07a25a" validate constraint "cjc";

alter table "pgboss"."jd442d23c0525fe5305a418bd1d96d790241806b056c3dac97a07a25a" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."jd442d23c0525fe5305a418bd1d96d790241806b056c3dac97a07a25a" validate constraint "dlq_fkey";

alter table "pgboss"."jd442d23c0525fe5305a418bd1d96d790241806b056c3dac97a07a25a" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."jd442d23c0525fe5305a418bd1d96d790241806b056c3dac97a07a25a" validate constraint "q_fkey";

alter table "pgboss"."jd4de1d3c2a088ea0767c30d7974c9579436fa347c61208d5e6f998ca" add constraint "cjc" CHECK ((name = 'enrichment.run.dead_letter'::text)) not valid;

alter table "pgboss"."jd4de1d3c2a088ea0767c30d7974c9579436fa347c61208d5e6f998ca" validate constraint "cjc";

alter table "pgboss"."jd4de1d3c2a088ea0767c30d7974c9579436fa347c61208d5e6f998ca" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."jd4de1d3c2a088ea0767c30d7974c9579436fa347c61208d5e6f998ca" validate constraint "dlq_fkey";

alter table "pgboss"."jd4de1d3c2a088ea0767c30d7974c9579436fa347c61208d5e6f998ca" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."jd4de1d3c2a088ea0767c30d7974c9579436fa347c61208d5e6f998ca" validate constraint "q_fkey";

alter table "pgboss"."jd6a5c00363ad8705d1bf6988594c2729c9365c9941ca95152f0e84f5" add constraint "cjc" CHECK ((name = 'dlq.process.dead_letter'::text)) not valid;

alter table "pgboss"."jd6a5c00363ad8705d1bf6988594c2729c9365c9941ca95152f0e84f5" validate constraint "cjc";

alter table "pgboss"."jd6a5c00363ad8705d1bf6988594c2729c9365c9941ca95152f0e84f5" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."jd6a5c00363ad8705d1bf6988594c2729c9365c9941ca95152f0e84f5" validate constraint "dlq_fkey";

alter table "pgboss"."jd6a5c00363ad8705d1bf6988594c2729c9365c9941ca95152f0e84f5" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."jd6a5c00363ad8705d1bf6988594c2729c9365c9941ca95152f0e84f5" validate constraint "q_fkey";

alter table "pgboss"."jdb8d5f8033c0fce6fe7291be33c409aa854ee1a51557132f4ece404b" add constraint "cjc" CHECK ((name = 'discovery.run'::text)) not valid;

alter table "pgboss"."jdb8d5f8033c0fce6fe7291be33c409aa854ee1a51557132f4ece404b" validate constraint "cjc";

alter table "pgboss"."jdb8d5f8033c0fce6fe7291be33c409aa854ee1a51557132f4ece404b" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."jdb8d5f8033c0fce6fe7291be33c409aa854ee1a51557132f4ece404b" validate constraint "dlq_fkey";

alter table "pgboss"."jdb8d5f8033c0fce6fe7291be33c409aa854ee1a51557132f4ece404b" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."jdb8d5f8033c0fce6fe7291be33c409aa854ee1a51557132f4ece404b" validate constraint "q_fkey";

alter table "pgboss"."je194883db8168f5b3faa57d619cfc0f47b5d57ee2e049c6704887b0d" add constraint "cjc" CHECK ((name = 'followup.check.dead_letter'::text)) not valid;

alter table "pgboss"."je194883db8168f5b3faa57d619cfc0f47b5d57ee2e049c6704887b0d" validate constraint "cjc";

alter table "pgboss"."je194883db8168f5b3faa57d619cfc0f47b5d57ee2e049c6704887b0d" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."je194883db8168f5b3faa57d619cfc0f47b5d57ee2e049c6704887b0d" validate constraint "dlq_fkey";

alter table "pgboss"."je194883db8168f5b3faa57d619cfc0f47b5d57ee2e049c6704887b0d" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."je194883db8168f5b3faa57d619cfc0f47b5d57ee2e049c6704887b0d" validate constraint "q_fkey";

alter table "pgboss"."je40a4837a72589e8afb5db6ce4066cc5a2c1ade743b34dc386395baf" add constraint "cjc" CHECK ((name = 'analytics.rollup.dead_letter'::text)) not valid;

alter table "pgboss"."je40a4837a72589e8afb5db6ce4066cc5a2c1ade743b34dc386395baf" validate constraint "cjc";

alter table "pgboss"."je40a4837a72589e8afb5db6ce4066cc5a2c1ade743b34dc386395baf" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."je40a4837a72589e8afb5db6ce4066cc5a2c1ade743b34dc386395baf" validate constraint "dlq_fkey";

alter table "pgboss"."je40a4837a72589e8afb5db6ce4066cc5a2c1ade743b34dc386395baf" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."je40a4837a72589e8afb5db6ce4066cc5a2c1ade743b34dc386395baf" validate constraint "q_fkey";

alter table "pgboss"."je48c64b5dcac7f77221d4a73f8de49465b53a9b7708b4a3145eb2e16" add constraint "cjc" CHECK ((name = 'message.send.dead_letter'::text)) not valid;

alter table "pgboss"."je48c64b5dcac7f77221d4a73f8de49465b53a9b7708b4a3145eb2e16" validate constraint "cjc";

alter table "pgboss"."je48c64b5dcac7f77221d4a73f8de49465b53a9b7708b4a3145eb2e16" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."je48c64b5dcac7f77221d4a73f8de49465b53a9b7708b4a3145eb2e16" validate constraint "dlq_fkey";

alter table "pgboss"."je48c64b5dcac7f77221d4a73f8de49465b53a9b7708b4a3145eb2e16" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."je48c64b5dcac7f77221d4a73f8de49465b53a9b7708b4a3145eb2e16" validate constraint "q_fkey";

alter table "pgboss"."je9a42f250cee0d3976f4512cfd2cbc9b0a9a4fa4208c77496f73b961" add constraint "cjc" CHECK ((name = 'discovery.run_search_task.dead_letter'::text)) not valid;

alter table "pgboss"."je9a42f250cee0d3976f4512cfd2cbc9b0a9a4fa4208c77496f73b961" validate constraint "cjc";

alter table "pgboss"."je9a42f250cee0d3976f4512cfd2cbc9b0a9a4fa4208c77496f73b961" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."je9a42f250cee0d3976f4512cfd2cbc9b0a9a4fa4208c77496f73b961" validate constraint "dlq_fkey";

alter table "pgboss"."je9a42f250cee0d3976f4512cfd2cbc9b0a9a4fa4208c77496f73b961" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."je9a42f250cee0d3976f4512cfd2cbc9b0a9a4fa4208c77496f73b961" validate constraint "q_fkey";

alter table "pgboss"."jea85060b5607bdc3ef2b58f758995b9124f659d470d6cec22b204b71" add constraint "cjc" CHECK ((name = 'system.heartbeat.dead_letter'::text)) not valid;

alter table "pgboss"."jea85060b5607bdc3ef2b58f758995b9124f659d470d6cec22b204b71" validate constraint "cjc";

alter table "pgboss"."jea85060b5607bdc3ef2b58f758995b9124f659d470d6cec22b204b71" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."jea85060b5607bdc3ef2b58f758995b9124f659d470d6cec22b204b71" validate constraint "dlq_fkey";

alter table "pgboss"."jea85060b5607bdc3ef2b58f758995b9124f659d470d6cec22b204b71" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."jea85060b5607bdc3ef2b58f758995b9124f659d470d6cec22b204b71" validate constraint "q_fkey";

alter table "pgboss"."jee5a4ed8b83cd79110f0de65b1132a50575d50670f0277c417c9749b" add constraint "cjc" CHECK ((name = 'pipeline.health'::text)) not valid;

alter table "pgboss"."jee5a4ed8b83cd79110f0de65b1132a50575d50670f0277c417c9749b" validate constraint "cjc";

alter table "pgboss"."jee5a4ed8b83cd79110f0de65b1132a50575d50670f0277c417c9749b" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."jee5a4ed8b83cd79110f0de65b1132a50575d50670f0277c417c9749b" validate constraint "dlq_fkey";

alter table "pgboss"."jee5a4ed8b83cd79110f0de65b1132a50575d50670f0277c417c9749b" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."jee5a4ed8b83cd79110f0de65b1132a50575d50670f0277c417c9749b" validate constraint "q_fkey";

alter table "pgboss"."jf02cd78c21f22c64f831f3364dfa0d4baba406a92cbd29d75795829a" add constraint "cjc" CHECK ((name = 'search-task.recovery.dead_letter'::text)) not valid;

alter table "pgboss"."jf02cd78c21f22c64f831f3364dfa0d4baba406a92cbd29d75795829a" validate constraint "cjc";

alter table "pgboss"."jf02cd78c21f22c64f831f3364dfa0d4baba406a92cbd29d75795829a" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."jf02cd78c21f22c64f831f3364dfa0d4baba406a92cbd29d75795829a" validate constraint "dlq_fkey";

alter table "pgboss"."jf02cd78c21f22c64f831f3364dfa0d4baba406a92cbd29d75795829a" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."jf02cd78c21f22c64f831f3364dfa0d4baba406a92cbd29d75795829a" validate constraint "q_fkey";

alter table "pgboss"."jf6105e34c1cb87b2990e484aaa66dccbbd06e004c2c6efd6e2ac7afe" add constraint "cjc" CHECK ((name = 'dlq.process'::text)) not valid;

alter table "pgboss"."jf6105e34c1cb87b2990e484aaa66dccbbd06e004c2c6efd6e2ac7afe" validate constraint "cjc";

alter table "pgboss"."jf6105e34c1cb87b2990e484aaa66dccbbd06e004c2c6efd6e2ac7afe" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."jf6105e34c1cb87b2990e484aaa66dccbbd06e004c2c6efd6e2ac7afe" validate constraint "dlq_fkey";

alter table "pgboss"."jf6105e34c1cb87b2990e484aaa66dccbbd06e004c2c6efd6e2ac7afe" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."jf6105e34c1cb87b2990e484aaa66dccbbd06e004c2c6efd6e2ac7afe" validate constraint "q_fkey";

alter table "pgboss"."jfff85c8ab363e80c03564838251fc3256e3497fc8b72d65af3ae28b5" add constraint "cjc" CHECK ((name = 'discovery.run_search_task'::text)) not valid;

alter table "pgboss"."jfff85c8ab363e80c03564838251fc3256e3497fc8b72d65af3ae28b5" validate constraint "cjc";

alter table "pgboss"."jfff85c8ab363e80c03564838251fc3256e3497fc8b72d65af3ae28b5" add constraint "dlq_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."jfff85c8ab363e80c03564838251fc3256e3497fc8b72d65af3ae28b5" validate constraint "dlq_fkey";

alter table "pgboss"."jfff85c8ab363e80c03564838251fc3256e3497fc8b72d65af3ae28b5" add constraint "q_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED not valid;

alter table "pgboss"."jfff85c8ab363e80c03564838251fc3256e3497fc8b72d65af3ae28b5" validate constraint "q_fkey";

alter table "pgboss"."queue" add constraint "queue_dead_letter_fkey" FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) not valid;

alter table "pgboss"."queue" validate constraint "queue_dead_letter_fkey";

alter table "pgboss"."schedule" add constraint "schedule_name_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE CASCADE not valid;

alter table "pgboss"."schedule" validate constraint "schedule_name_fkey";

alter table "pgboss"."subscription" add constraint "subscription_name_fkey" FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE CASCADE not valid;

alter table "pgboss"."subscription" validate constraint "subscription_name_fkey";

alter table "public"."Lead" add constraint "Lead_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES public.businesses(id) ON UPDATE CASCADE ON DELETE SET NULL not valid;

alter table "public"."Lead" validate constraint "Lead_businessId_fkey";

alter table "public"."business_contacts" add constraint "business_contacts_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES public.businesses(id) ON UPDATE CASCADE ON DELETE RESTRICT not valid;

alter table "public"."business_contacts" validate constraint "business_contacts_businessId_fkey";

alter table "public"."business_conversions" add constraint "business_conversions_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES public.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE not valid;

alter table "public"."business_conversions" validate constraint "business_conversions_businessId_fkey";

alter table "public"."business_conversions" add constraint "business_conversions_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES public."Lead"(id) ON UPDATE CASCADE ON DELETE CASCADE not valid;

alter table "public"."business_conversions" validate constraint "business_conversions_leadId_fkey";

alter table "public"."businesses" add constraint "businesses_country_code_check" CHECK ((country_code = ANY (ARRAY['JO'::text, 'SA'::text, 'AE'::text, 'EG'::text, 'BH'::text, 'KW'::text, 'OM'::text, 'QA'::text, 'LB'::text, 'IQ'::text, 'MA'::text, 'TN'::text, 'DZ'::text, 'LY'::text, 'YE'::text, 'SY'::text, 'PS'::text, 'SD'::text]))) not valid;

alter table "public"."businesses" validate constraint "businesses_country_code_check";

alter table "public"."contact_recovery_items" add constraint "contact_recovery_items_business_id_fkey" FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE not valid;

alter table "public"."contact_recovery_items" validate constraint "contact_recovery_items_business_id_fkey";

alter table "public"."contact_recovery_items" add constraint "contact_recovery_items_icp_profile_id_fkey" FOREIGN KEY (icp_profile_id) REFERENCES public."IcpProfile"(id) ON UPDATE CASCADE ON DELETE CASCADE not valid;

alter table "public"."contact_recovery_items" validate constraint "contact_recovery_items_icp_profile_id_fkey";

alter table "public"."discovery_cost_events" add constraint "discovery_cost_events_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES public.businesses(id) ON UPDATE CASCADE ON DELETE SET NULL not valid;

alter table "public"."discovery_cost_events" validate constraint "discovery_cost_events_businessId_fkey";

alter table "public"."lead_pipeline_events" add constraint "lead_pipeline_events_lead_id_fkey" FOREIGN KEY (lead_id) REFERENCES public."Lead"(id) ON UPDATE CASCADE ON DELETE CASCADE not valid;

alter table "public"."lead_pipeline_events" validate constraint "lead_pipeline_events_lead_id_fkey";

alter table "public"."lead_rejections" add constraint "lead_rejections_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES public."Lead"(id) ON UPDATE CASCADE ON DELETE CASCADE not valid;

alter table "public"."lead_rejections" validate constraint "lead_rejections_leadId_fkey";

alter table "public"."manager_recommendation_records" add constraint "manager_recommendation_records_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES public."ManagerAnalysis"(id) ON UPDATE CASCADE ON DELETE SET NULL not valid;

alter table "public"."manager_recommendation_records" validate constraint "manager_recommendation_records_analysisRunId_fkey";

alter table "public"."search_tasks" add constraint "search_tasks_country_code_allowed_chk" CHECK ((country_code = ANY (ARRAY['JO'::text, 'SA'::text, 'AE'::text, 'EG'::text, 'QA'::text, 'BH'::text, 'KW'::text, 'OM'::text, 'LB'::text, 'IQ'::text, 'MA'::text, 'TN'::text, 'DZ'::text, 'LY'::text, 'YE'::text, 'SY'::text, 'PS'::text, 'SD'::text]))) not valid;

alter table "public"."search_tasks" validate constraint "search_tasks_country_code_allowed_chk";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION pgboss.create_queue(queue_name text, options json)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
    DECLARE
      table_name varchar := 'j' || encode(sha224(queue_name::bytea), 'hex');
      queue_created_on timestamptz;
    BEGIN

      WITH q as (
      INSERT INTO pgboss.queue (
        name,
        policy,
        retry_limit,
        retry_delay,
        retry_backoff,
        expire_seconds,
        retention_minutes,
        dead_letter,
        partition_name
      )
      VALUES (
        queue_name,
        options->>'policy',
        (options->>'retryLimit')::int,
        (options->>'retryDelay')::int,
        (options->>'retryBackoff')::bool,
        (options->>'expireInSeconds')::int,
        (options->>'retentionMinutes')::int,
        options->>'deadLetter',
        table_name
      )
      ON CONFLICT DO NOTHING
      RETURNING created_on
      )
      SELECT created_on into queue_created_on from q;

      IF queue_created_on IS NULL THEN
        RETURN;
      END IF;

      EXECUTE format('CREATE TABLE pgboss.%I (LIKE pgboss.job INCLUDING DEFAULTS)', table_name);

      EXECUTE format('ALTER TABLE pgboss.%1$I ADD PRIMARY KEY (name, id)', table_name);
      EXECUTE format('ALTER TABLE pgboss.%1$I ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue (name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED', table_name);
      EXECUTE format('ALTER TABLE pgboss.%1$I ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue (name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED', table_name);
      EXECUTE format('CREATE UNIQUE INDEX %1$s_i1 ON pgboss.%1$I (name, COALESCE(singleton_key, '''')) WHERE state = ''created'' AND policy = ''short''', table_name);
      EXECUTE format('CREATE UNIQUE INDEX %1$s_i2 ON pgboss.%1$I (name, COALESCE(singleton_key, '''')) WHERE state = ''active'' AND policy = ''singleton''', table_name);
      EXECUTE format('CREATE UNIQUE INDEX %1$s_i3 ON pgboss.%1$I (name, state, COALESCE(singleton_key, '''')) WHERE state <= ''active'' AND policy = ''stately''', table_name);
      EXECUTE format('CREATE UNIQUE INDEX %1$s_i4 ON pgboss.%1$I (name, singleton_on, COALESCE(singleton_key, '''')) WHERE state <> ''cancelled'' AND singleton_on IS NOT NULL', table_name);
      EXECUTE format('CREATE INDEX %1$s_i5 ON pgboss.%1$I (name, start_after) INCLUDE (priority, created_on, id) WHERE state < ''active''', table_name);

      EXECUTE format('ALTER TABLE pgboss.%I ADD CONSTRAINT cjc CHECK (name=%L)', table_name, queue_name);
      EXECUTE format('ALTER TABLE pgboss.job ATTACH PARTITION pgboss.%I FOR VALUES IN (%L)', table_name, queue_name);
    END;
    $function$
;

CREATE OR REPLACE FUNCTION pgboss.delete_queue(queue_name text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
    DECLARE
      table_name varchar;
    BEGIN
      WITH deleted as (
        DELETE FROM pgboss.queue
        WHERE name = queue_name
        RETURNING partition_name
      )
      SELECT partition_name from deleted INTO table_name;

      EXECUTE format('DROP TABLE IF EXISTS pgboss.%I', table_name);
    END;
    $function$
;

grant delete on table "public"."ManagerAnalysis" to "anon";

grant insert on table "public"."ManagerAnalysis" to "anon";

grant references on table "public"."ManagerAnalysis" to "anon";

grant select on table "public"."ManagerAnalysis" to "anon";

grant trigger on table "public"."ManagerAnalysis" to "anon";

grant truncate on table "public"."ManagerAnalysis" to "anon";

grant update on table "public"."ManagerAnalysis" to "anon";

grant delete on table "public"."ManagerAnalysis" to "authenticated";

grant insert on table "public"."ManagerAnalysis" to "authenticated";

grant references on table "public"."ManagerAnalysis" to "authenticated";

grant select on table "public"."ManagerAnalysis" to "authenticated";

grant trigger on table "public"."ManagerAnalysis" to "authenticated";

grant truncate on table "public"."ManagerAnalysis" to "authenticated";

grant update on table "public"."ManagerAnalysis" to "authenticated";

grant delete on table "public"."ManagerAnalysis" to "service_role";

grant insert on table "public"."ManagerAnalysis" to "service_role";

grant references on table "public"."ManagerAnalysis" to "service_role";

grant select on table "public"."ManagerAnalysis" to "service_role";

grant trigger on table "public"."ManagerAnalysis" to "service_role";

grant truncate on table "public"."ManagerAnalysis" to "service_role";

grant update on table "public"."ManagerAnalysis" to "service_role";

grant delete on table "public"."business_contacts" to "anon";

grant insert on table "public"."business_contacts" to "anon";

grant references on table "public"."business_contacts" to "anon";

grant select on table "public"."business_contacts" to "anon";

grant trigger on table "public"."business_contacts" to "anon";

grant truncate on table "public"."business_contacts" to "anon";

grant update on table "public"."business_contacts" to "anon";

grant delete on table "public"."business_contacts" to "authenticated";

grant insert on table "public"."business_contacts" to "authenticated";

grant references on table "public"."business_contacts" to "authenticated";

grant select on table "public"."business_contacts" to "authenticated";

grant trigger on table "public"."business_contacts" to "authenticated";

grant truncate on table "public"."business_contacts" to "authenticated";

grant update on table "public"."business_contacts" to "authenticated";

grant delete on table "public"."business_contacts" to "service_role";

grant insert on table "public"."business_contacts" to "service_role";

grant references on table "public"."business_contacts" to "service_role";

grant select on table "public"."business_contacts" to "service_role";

grant trigger on table "public"."business_contacts" to "service_role";

grant truncate on table "public"."business_contacts" to "service_role";

grant update on table "public"."business_contacts" to "service_role";

grant delete on table "public"."business_conversions" to "anon";

grant insert on table "public"."business_conversions" to "anon";

grant references on table "public"."business_conversions" to "anon";

grant select on table "public"."business_conversions" to "anon";

grant trigger on table "public"."business_conversions" to "anon";

grant truncate on table "public"."business_conversions" to "anon";

grant update on table "public"."business_conversions" to "anon";

grant delete on table "public"."business_conversions" to "authenticated";

grant insert on table "public"."business_conversions" to "authenticated";

grant references on table "public"."business_conversions" to "authenticated";

grant select on table "public"."business_conversions" to "authenticated";

grant trigger on table "public"."business_conversions" to "authenticated";

grant truncate on table "public"."business_conversions" to "authenticated";

grant update on table "public"."business_conversions" to "authenticated";

grant delete on table "public"."business_conversions" to "service_role";

grant insert on table "public"."business_conversions" to "service_role";

grant references on table "public"."business_conversions" to "service_role";

grant select on table "public"."business_conversions" to "service_role";

grant trigger on table "public"."business_conversions" to "service_role";

grant truncate on table "public"."business_conversions" to "service_role";

grant update on table "public"."business_conversions" to "service_role";

grant delete on table "public"."contact_recovery_items" to "anon";

grant insert on table "public"."contact_recovery_items" to "anon";

grant references on table "public"."contact_recovery_items" to "anon";

grant select on table "public"."contact_recovery_items" to "anon";

grant trigger on table "public"."contact_recovery_items" to "anon";

grant truncate on table "public"."contact_recovery_items" to "anon";

grant update on table "public"."contact_recovery_items" to "anon";

grant delete on table "public"."contact_recovery_items" to "authenticated";

grant insert on table "public"."contact_recovery_items" to "authenticated";

grant references on table "public"."contact_recovery_items" to "authenticated";

grant select on table "public"."contact_recovery_items" to "authenticated";

grant trigger on table "public"."contact_recovery_items" to "authenticated";

grant truncate on table "public"."contact_recovery_items" to "authenticated";

grant update on table "public"."contact_recovery_items" to "authenticated";

grant delete on table "public"."contact_recovery_items" to "service_role";

grant insert on table "public"."contact_recovery_items" to "service_role";

grant references on table "public"."contact_recovery_items" to "service_role";

grant select on table "public"."contact_recovery_items" to "service_role";

grant trigger on table "public"."contact_recovery_items" to "service_role";

grant truncate on table "public"."contact_recovery_items" to "service_role";

grant update on table "public"."contact_recovery_items" to "service_role";

grant delete on table "public"."discovery_cost_events" to "anon";

grant insert on table "public"."discovery_cost_events" to "anon";

grant references on table "public"."discovery_cost_events" to "anon";

grant select on table "public"."discovery_cost_events" to "anon";

grant trigger on table "public"."discovery_cost_events" to "anon";

grant truncate on table "public"."discovery_cost_events" to "anon";

grant update on table "public"."discovery_cost_events" to "anon";

grant delete on table "public"."discovery_cost_events" to "authenticated";

grant insert on table "public"."discovery_cost_events" to "authenticated";

grant references on table "public"."discovery_cost_events" to "authenticated";

grant select on table "public"."discovery_cost_events" to "authenticated";

grant trigger on table "public"."discovery_cost_events" to "authenticated";

grant truncate on table "public"."discovery_cost_events" to "authenticated";

grant update on table "public"."discovery_cost_events" to "authenticated";

grant delete on table "public"."discovery_cost_events" to "service_role";

grant insert on table "public"."discovery_cost_events" to "service_role";

grant references on table "public"."discovery_cost_events" to "service_role";

grant select on table "public"."discovery_cost_events" to "service_role";

grant trigger on table "public"."discovery_cost_events" to "service_role";

grant truncate on table "public"."discovery_cost_events" to "service_role";

grant update on table "public"."discovery_cost_events" to "service_role";

grant delete on table "public"."lead_pipeline_events" to "anon";

grant insert on table "public"."lead_pipeline_events" to "anon";

grant references on table "public"."lead_pipeline_events" to "anon";

grant select on table "public"."lead_pipeline_events" to "anon";

grant trigger on table "public"."lead_pipeline_events" to "anon";

grant truncate on table "public"."lead_pipeline_events" to "anon";

grant update on table "public"."lead_pipeline_events" to "anon";

grant delete on table "public"."lead_pipeline_events" to "authenticated";

grant insert on table "public"."lead_pipeline_events" to "authenticated";

grant references on table "public"."lead_pipeline_events" to "authenticated";

grant select on table "public"."lead_pipeline_events" to "authenticated";

grant trigger on table "public"."lead_pipeline_events" to "authenticated";

grant truncate on table "public"."lead_pipeline_events" to "authenticated";

grant update on table "public"."lead_pipeline_events" to "authenticated";

grant delete on table "public"."lead_pipeline_events" to "service_role";

grant insert on table "public"."lead_pipeline_events" to "service_role";

grant references on table "public"."lead_pipeline_events" to "service_role";

grant select on table "public"."lead_pipeline_events" to "service_role";

grant trigger on table "public"."lead_pipeline_events" to "service_role";

grant truncate on table "public"."lead_pipeline_events" to "service_role";

grant update on table "public"."lead_pipeline_events" to "service_role";

grant delete on table "public"."lead_rejections" to "anon";

grant insert on table "public"."lead_rejections" to "anon";

grant references on table "public"."lead_rejections" to "anon";

grant select on table "public"."lead_rejections" to "anon";

grant trigger on table "public"."lead_rejections" to "anon";

grant truncate on table "public"."lead_rejections" to "anon";

grant update on table "public"."lead_rejections" to "anon";

grant delete on table "public"."lead_rejections" to "authenticated";

grant insert on table "public"."lead_rejections" to "authenticated";

grant references on table "public"."lead_rejections" to "authenticated";

grant select on table "public"."lead_rejections" to "authenticated";

grant trigger on table "public"."lead_rejections" to "authenticated";

grant truncate on table "public"."lead_rejections" to "authenticated";

grant update on table "public"."lead_rejections" to "authenticated";

grant delete on table "public"."lead_rejections" to "service_role";

grant insert on table "public"."lead_rejections" to "service_role";

grant references on table "public"."lead_rejections" to "service_role";

grant select on table "public"."lead_rejections" to "service_role";

grant trigger on table "public"."lead_rejections" to "service_role";

grant truncate on table "public"."lead_rejections" to "service_role";

grant update on table "public"."lead_rejections" to "service_role";

grant delete on table "public"."manager_recommendation_records" to "anon";

grant insert on table "public"."manager_recommendation_records" to "anon";

grant references on table "public"."manager_recommendation_records" to "anon";

grant select on table "public"."manager_recommendation_records" to "anon";

grant trigger on table "public"."manager_recommendation_records" to "anon";

grant truncate on table "public"."manager_recommendation_records" to "anon";

grant update on table "public"."manager_recommendation_records" to "anon";

grant delete on table "public"."manager_recommendation_records" to "authenticated";

grant insert on table "public"."manager_recommendation_records" to "authenticated";

grant references on table "public"."manager_recommendation_records" to "authenticated";

grant select on table "public"."manager_recommendation_records" to "authenticated";

grant trigger on table "public"."manager_recommendation_records" to "authenticated";

grant truncate on table "public"."manager_recommendation_records" to "authenticated";

grant update on table "public"."manager_recommendation_records" to "authenticated";

grant delete on table "public"."manager_recommendation_records" to "service_role";

grant insert on table "public"."manager_recommendation_records" to "service_role";

grant references on table "public"."manager_recommendation_records" to "service_role";

grant select on table "public"."manager_recommendation_records" to "service_role";

grant trigger on table "public"."manager_recommendation_records" to "service_role";

grant truncate on table "public"."manager_recommendation_records" to "service_role";

grant update on table "public"."manager_recommendation_records" to "service_role";

grant delete on table "public"."pipeline_settings" to "anon";

grant insert on table "public"."pipeline_settings" to "anon";

grant references on table "public"."pipeline_settings" to "anon";

grant select on table "public"."pipeline_settings" to "anon";

grant trigger on table "public"."pipeline_settings" to "anon";

grant truncate on table "public"."pipeline_settings" to "anon";

grant update on table "public"."pipeline_settings" to "anon";

grant delete on table "public"."pipeline_settings" to "authenticated";

grant insert on table "public"."pipeline_settings" to "authenticated";

grant references on table "public"."pipeline_settings" to "authenticated";

grant select on table "public"."pipeline_settings" to "authenticated";

grant trigger on table "public"."pipeline_settings" to "authenticated";

grant truncate on table "public"."pipeline_settings" to "authenticated";

grant update on table "public"."pipeline_settings" to "authenticated";

grant delete on table "public"."pipeline_settings" to "service_role";

grant insert on table "public"."pipeline_settings" to "service_role";

grant references on table "public"."pipeline_settings" to "service_role";

grant select on table "public"."pipeline_settings" to "service_role";

grant trigger on table "public"."pipeline_settings" to "service_role";

grant truncate on table "public"."pipeline_settings" to "service_role";

grant update on table "public"."pipeline_settings" to "service_role";


  create policy "manager_analysis_admin_select"
  on "public"."ManagerAnalysis"
  as permissive
  for select
  to public
using (((auth.uid())::text IN ( SELECT (app_admins.user_id)::text AS user_id
   FROM public.app_admins)));



  create policy "business_contacts_admin_select"
  on "public"."business_contacts"
  as permissive
  for select
  to authenticated
using (public.is_app_admin());



  create policy "business_conversions_admin_select"
  on "public"."business_conversions"
  as permissive
  for select
  to authenticated
using (public.is_app_admin());



  create policy "contact_recovery_items_admin_select"
  on "public"."contact_recovery_items"
  as permissive
  for select
  to authenticated
using (public.is_app_admin());



  create policy "discovery_cost_events_admin_select"
  on "public"."discovery_cost_events"
  as permissive
  for select
  to authenticated
using (public.is_app_admin());



  create policy "lead_pipeline_events_admin_select"
  on "public"."lead_pipeline_events"
  as permissive
  for select
  to authenticated
using (public.is_app_admin());



  create policy "lead_rejections_admin_select"
  on "public"."lead_rejections"
  as permissive
  for select
  to authenticated
using (public.is_app_admin());



  create policy "manager_recommendation_records_admin_select"
  on "public"."manager_recommendation_records"
  as permissive
  for select
  to authenticated
using (public.is_app_admin());



  create policy "pipeline_settings_admin_select"
  on "public"."pipeline_settings"
  as permissive
  for select
  to authenticated
using (public.is_app_admin());


drop trigger if exists "objects_delete_delete_prefix" on "storage"."objects";

drop trigger if exists "objects_insert_create_prefix" on "storage"."objects";

drop trigger if exists "objects_update_create_prefix" on "storage"."objects";

drop trigger if exists "prefixes_create_hierarchy" on "storage"."prefixes";

drop trigger if exists "prefixes_delete_hierarchy" on "storage"."prefixes";

CREATE TRIGGER protect_buckets_delete BEFORE DELETE ON storage.buckets FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();

CREATE TRIGGER protect_objects_delete BEFORE DELETE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();


