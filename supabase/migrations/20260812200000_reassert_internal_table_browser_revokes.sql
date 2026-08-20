DO $$
DECLARE
  internal_table text;
BEGIN
  FOREACH internal_table IN ARRAY ARRAY[
    'LeadFeatureSnapshot',
    'LeadScorePrediction',
    'MessageDraft',
    'MessageVariant',
    'MessageSend',
    'FeedbackEvent',
    'Lead',
    'JobExecution',
    'LeadDiscoveryRecord',
    'LeadEnrichmentRecord',
    'OutboxEvent',
    'TrainingRun',
    'TrainingLabel',
    'ModelVersion',
    'ModelEvaluation',
    'AnalyticsDailyRollup',
    'IcpProfile',
    'QualificationRule',
    'app_admins',
    'businesses',
    'business_contacts',
    'business_conversions',
    'business_evidence',
    'contact_recovery_items',
    'discovery_attribution_assignments',
    'discovery_cost_events',
    'job_runs',
    'lead_pipeline_events',
    'lead_rejections',
    'manager_recommendation_records',
    'pipeline_settings',
    'public_demo_discovery_admissions',
    'search_tasks',
    'sources',
    'job_requests',
    'ManagerAnalysis',
    'Session',
    'User'
  ]
  LOOP
    IF to_regclass(format('%I.%I', 'public', internal_table)) IS NOT NULL THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon, authenticated',
        internal_table
      );
    END IF;
  END LOOP;
END;
$$;

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"
  REVOKE ALL ON FUNCTIONS FROM "anon", "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"
  REVOKE ALL ON TABLES FROM "anon", "authenticated";
