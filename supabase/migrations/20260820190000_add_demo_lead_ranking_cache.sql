CREATE TABLE IF NOT EXISTS public.leadzilla_demo_lead_rankings (
  lead_id text PRIMARY KEY REFERENCES public."Lead" (id) ON DELETE CASCADE,
  status public."LeadStatus" NOT NULL,
  display_score double precision,
  score_band public."ScoreBand",
  created_at timestamp(3) without time zone NOT NULL,
  search_text text NOT NULL,
  refreshed_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.leadzilla_demo_lead_rankings OWNER TO postgres;

CREATE INDEX IF NOT EXISTS leadzilla_demo_lead_rankings_score_desc_idx
  ON public.leadzilla_demo_lead_rankings
  (display_score DESC NULLS LAST, created_at DESC, lead_id DESC);

CREATE INDEX IF NOT EXISTS leadzilla_demo_lead_rankings_score_asc_idx
  ON public.leadzilla_demo_lead_rankings
  (display_score ASC NULLS LAST, created_at DESC, lead_id DESC);

CREATE INDEX IF NOT EXISTS leadzilla_demo_lead_rankings_status_idx
  ON public.leadzilla_demo_lead_rankings (status);

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
    now()
  FROM public."Lead" AS lead
  LEFT JOIN public.businesses AS business ON business.id = lead."businessId"
  LEFT JOIN LATERAL (
    SELECT prediction."blendedScore", prediction."scoreBand"
    FROM public."LeadScorePrediction" AS prediction
    WHERE prediction."leadId" = lead.id
    ORDER BY prediction."predictedAt" DESC, prediction."createdAt" DESC, prediction.id DESC
    LIMIT 1
  ) AS score ON true
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
BEGIN
  INSERT INTO public.leadzilla_demo_lead_rankings (
    lead_id,
    status,
    display_score,
    score_band,
    created_at,
    search_text,
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
    now()
  FROM public."Lead" AS lead
  LEFT JOIN public.businesses AS business ON business.id = lead."businessId"
  LEFT JOIN LATERAL (
    SELECT prediction."blendedScore", prediction."scoreBand"
    FROM public."LeadScorePrediction" AS prediction
    WHERE prediction."leadId" = lead.id
    ORDER BY prediction."predictedAt" DESC, prediction."createdAt" DESC, prediction.id DESC
    LIMIT 1
  ) AS score ON true
  WHERE lead."deletedAt" IS NULL
  ON CONFLICT (lead_id) DO UPDATE SET
    status = EXCLUDED.status,
    display_score = EXCLUDED.display_score,
    score_band = EXCLUDED.score_band,
    created_at = EXCLUDED.created_at,
    search_text = EXCLUDED.search_text,
    refreshed_at = EXCLUDED.refreshed_at;

  DELETE FROM public.leadzilla_demo_lead_rankings AS ranking
  WHERE NOT EXISTS (
    SELECT 1
    FROM public."Lead" AS lead
    WHERE lead.id = ranking.lead_id
      AND lead."deletedAt" IS NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_leadzilla_demo_lead_ranking_from_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.refresh_leadzilla_demo_lead_ranking(COALESCE(NEW.id, OLD.id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_leadzilla_demo_lead_ranking_from_score()
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

CREATE OR REPLACE FUNCTION public.sync_leadzilla_demo_lead_rankings_from_business()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  affected_lead record;
BEGIN
  FOR affected_lead IN
    SELECT lead.id
    FROM public."Lead" AS lead
    WHERE lead."businessId" = COALESCE(NEW.id, OLD.id)
  LOOP
    PERFORM public.refresh_leadzilla_demo_lead_ranking(affected_lead.id);
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS leadzilla_demo_lead_ranking_lead_sync ON public."Lead";
CREATE TRIGGER leadzilla_demo_lead_ranking_lead_sync
AFTER INSERT OR UPDATE OR DELETE ON public."Lead"
FOR EACH ROW EXECUTE FUNCTION public.sync_leadzilla_demo_lead_ranking_from_lead();

DROP TRIGGER IF EXISTS leadzilla_demo_lead_ranking_score_sync ON public."LeadScorePrediction";
CREATE TRIGGER leadzilla_demo_lead_ranking_score_sync
AFTER INSERT OR UPDATE OR DELETE ON public."LeadScorePrediction"
FOR EACH ROW EXECUTE FUNCTION public.sync_leadzilla_demo_lead_ranking_from_score();

DROP TRIGGER IF EXISTS leadzilla_demo_lead_ranking_business_sync ON public.businesses;
CREATE TRIGGER leadzilla_demo_lead_ranking_business_sync
AFTER UPDATE OF name, category, deterministic_score, score_band ON public.businesses
FOR EACH ROW EXECUTE FUNCTION public.sync_leadzilla_demo_lead_rankings_from_business();

REVOKE ALL ON TABLE public.leadzilla_demo_lead_rankings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_leadzilla_demo_lead_ranking(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_leadzilla_demo_lead_rankings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_leadzilla_demo_lead_ranking_from_lead() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_leadzilla_demo_lead_ranking_from_score() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_leadzilla_demo_lead_rankings_from_business() FROM PUBLIC, anon, authenticated;

SELECT public.refresh_leadzilla_demo_lead_rankings();
