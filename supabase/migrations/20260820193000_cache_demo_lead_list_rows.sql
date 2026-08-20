ALTER TABLE public.leadzilla_demo_lead_rankings
ADD COLUMN IF NOT EXISTS response_json jsonb;

CREATE OR REPLACE FUNCTION public.refresh_leadzilla_demo_lead_ranking(target_lead_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.leadzilla_demo_lead_rankings
  WHERE lead_id = target_lead_id;

  INSERT INTO public.leadzilla_demo_lead_rankings (
    lead_id,
    status,
    display_score,
    score_band,
    created_at,
    search_text,
    response_json,
    refreshed_at
  )
  SELECT
    lead.id,
    lead.status,
    COALESCE(score."blendedScore", business.deterministic_score),
    COALESCE(score."scoreBand", business.score_band),
    lead."createdAt",
    lower(concat_ws(
      ' ',
      lead."firstName",
      lead."lastName",
      lead.email,
      lead."decisionMakerTitle",
      business.name,
      business.category
    )),
    jsonb_build_object(
      'id', lead.id,
      'firstName', lead."firstName",
      'lastName', lead."lastName",
      'email', lead.email,
      'source', lead.source,
      'status', lead.status,
      'error', NULL,
      'createdAt', lead."createdAt" AT TIME ZONE 'UTC',
      'updatedAt', lead."updatedAt" AT TIME ZONE 'UTC',
      'latestIcpProfileId', COALESCE(score."icpProfileId", discovery."icpProfileId"),
      'latestScoreBand', COALESCE(score."scoreBand", business.score_band),
      'latestBlendedScore', score."blendedScore",
      'latestScorePredictionId', score.id,
      'displayScore', COALESCE(score."blendedScore", business.deterministic_score),
      'displayScoreBand', COALESCE(score."scoreBand", business.score_band),
      'displayScoreSource', CASE
        WHEN score."blendedScore" IS NOT NULL THEN 'AI_SCORE'
        WHEN business.deterministic_score IS NOT NULL THEN 'BUSINESS_SCORE'
        ELSE 'NONE'
      END,
      'latestDiscoveryRawPayload', NULL,
      'latestEnrichmentNormalizedPayload', NULL,
      'latestEnrichmentRawPayload', NULL,
      'businessCountryCode', business.country_code,
      'businessCountry', business.country,
      'businessCity', business.city,
      'businessCategory', business.category,
      'businessDeterministicScore', business.deterministic_score,
      'businessScoreBand', business.score_band,
      'businessName', business.name,
      'decisionMakerTitle', lead."decisionMakerTitle",
      'hunterEnrichmentUsed', enrichment.provider::text = 'HUNTER'
        AND COALESCE((enrichment."rawPayload" ->> 'edgeDemo')::boolean, false) = false
    ),
    now()
  FROM public."Lead" AS lead
  LEFT JOIN public.businesses AS business ON business.id = lead."businessId"
  LEFT JOIN LATERAL (
    SELECT prediction.*
    FROM public."LeadScorePrediction" AS prediction
    WHERE prediction."leadId" = lead.id
    ORDER BY prediction."predictedAt" DESC, prediction."createdAt" DESC, prediction.id DESC
    LIMIT 1
  ) AS score ON true
  LEFT JOIN LATERAL (
    SELECT record."icpProfileId"
    FROM public."LeadDiscoveryRecord" AS record
    WHERE record."leadId" = lead.id
    ORDER BY record."discoveredAt" DESC, record."createdAt" DESC, record.id DESC
    LIMIT 1
  ) AS discovery ON true
  LEFT JOIN LATERAL (
    SELECT record.provider, record."rawPayload"
    FROM public."LeadEnrichmentRecord" AS record
    WHERE record."leadId" = lead.id
    ORDER BY record."enrichedAt" DESC NULLS LAST, record."createdAt" DESC, record.id DESC
    LIMIT 1
  ) AS enrichment ON true
  WHERE lead.id = target_lead_id
    AND lead."deletedAt" IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_leadzilla_demo_lead_rankings()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  lead_row record;
BEGIN
  FOR lead_row IN SELECT id FROM public."Lead"
  LOOP
    PERFORM public.refresh_leadzilla_demo_lead_ranking(lead_row.id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_leadzilla_demo_lead_ranking_from_related_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD."leadId" IS DISTINCT FROM NEW."leadId" THEN
    PERFORM public.refresh_leadzilla_demo_lead_ranking(OLD."leadId");
  END IF;
  PERFORM public.refresh_leadzilla_demo_lead_ranking(COALESCE(NEW."leadId", OLD."leadId"));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS leadzilla_demo_lead_ranking_discovery_sync ON public."LeadDiscoveryRecord";
CREATE TRIGGER leadzilla_demo_lead_ranking_discovery_sync
AFTER INSERT OR UPDATE OR DELETE ON public."LeadDiscoveryRecord"
FOR EACH ROW EXECUTE FUNCTION public.sync_leadzilla_demo_lead_ranking_from_related_record();

DROP TRIGGER IF EXISTS leadzilla_demo_lead_ranking_enrichment_sync ON public."LeadEnrichmentRecord";
CREATE TRIGGER leadzilla_demo_lead_ranking_enrichment_sync
AFTER INSERT OR UPDATE OR DELETE ON public."LeadEnrichmentRecord"
FOR EACH ROW EXECUTE FUNCTION public.sync_leadzilla_demo_lead_ranking_from_related_record();

REVOKE ALL ON FUNCTION public.sync_leadzilla_demo_lead_ranking_from_related_record()
FROM PUBLIC, anon, authenticated;

SELECT public.refresh_leadzilla_demo_lead_rankings();

ALTER TABLE public.leadzilla_demo_lead_rankings
ALTER COLUMN response_json SET NOT NULL;
