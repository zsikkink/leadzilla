CREATE TABLE IF NOT EXISTS "public"."discovery_attribution_assignments" (
    "id" "text" NOT NULL,
    "discovery_run_id" "text" NOT NULL,
    "icp_profile_id" "text" NOT NULL,
    "business_id" "text" NOT NULL,
    "search_task_id" "text" NOT NULL,
    "assignment_mode" "text" NOT NULL,
    "assigned_at" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "created_at" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" timestamp(3) without time zone NOT NULL,
    CONSTRAINT "discovery_attribution_assignments_assignment_mode_chk"
      CHECK (("assignment_mode" = 'SEARCH_TASK_FIRST_TOUCH'::"text"))
);

ALTER TABLE "public"."discovery_attribution_assignments" OWNER TO "postgres";

ALTER TABLE ONLY "public"."discovery_attribution_assignments"
    ADD CONSTRAINT "discovery_attribution_assignments_pkey" PRIMARY KEY ("id");

CREATE UNIQUE INDEX "discovery_attribution_assignments_run_icp_business_key"
ON "public"."discovery_attribution_assignments" USING "btree" ("discovery_run_id", "icp_profile_id", "business_id");

CREATE INDEX "discovery_attribution_assignments_search_task_id_idx"
ON "public"."discovery_attribution_assignments" USING "btree" ("search_task_id");

ALTER TABLE ONLY "public"."discovery_attribution_assignments"
    ADD CONSTRAINT "discovery_attribution_assignments_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY "public"."discovery_attribution_assignments"
    ADD CONSTRAINT "discovery_attribution_assignments_icp_profile_id_fkey"
    FOREIGN KEY ("icp_profile_id") REFERENCES "public"."IcpProfile"("id") ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY "public"."discovery_attribution_assignments"
    ADD CONSTRAINT "discovery_attribution_assignments_search_task_id_fkey"
    FOREIGN KEY ("search_task_id") REFERENCES "public"."search_tasks"("id") ON UPDATE CASCADE ON DELETE CASCADE;

REVOKE ALL PRIVILEGES ON TABLE "public"."discovery_attribution_assignments" FROM "anon", "authenticated";
