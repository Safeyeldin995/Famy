-- Sprint 7: close the gap where a newly-created provider has no trust_scores
-- row at all until their first review/booking/incident event fires. This is
-- the root cause of the application layer previously fabricating a fallback
-- trust score (90) for display. Reuses the existing, already-tested
-- recompute_trust_score() function unchanged — no schema redesign, no
-- changes to the scoring formula itself, just a new trigger to fill the one
-- real gap in when it fires.
CREATE OR REPLACE FUNCTION public.tg_recompute_trust_on_provider_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.recompute_trust_score(NEW.id);
  RETURN NULL;
END $$;

REVOKE EXECUTE ON FUNCTION public.tg_recompute_trust_on_provider_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_trust_on_provider_insert ON public.providers;
CREATE TRIGGER trg_trust_on_provider_insert AFTER INSERT ON public.providers
  FOR EACH ROW EXECUTE FUNCTION public.tg_recompute_trust_on_provider_insert();
