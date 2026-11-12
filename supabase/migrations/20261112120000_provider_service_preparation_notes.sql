-- Customer-facing preparation instructions per provider service offering.
-- Review-only migration: do not apply to Production from this PR.

ALTER TABLE public.provider_services
  ADD COLUMN IF NOT EXISTS preparation_notes text;

COMMENT ON COLUMN public.provider_services.preparation_notes IS
  'Plain-text instructions from the provider for what the customer should prepare before a session.';

ALTER TABLE public.provider_services
  DROP CONSTRAINT IF EXISTS provider_services_preparation_notes_len;

ALTER TABLE public.provider_services
  ADD CONSTRAINT provider_services_preparation_notes_len
  CHECK (preparation_notes IS NULL OR char_length(preparation_notes) <= 1000);

CREATE OR REPLACE FUNCTION public.tg_normalize_provider_service_preparation_notes()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.preparation_notes IS NOT NULL THEN
    NEW.preparation_notes := NULLIF(btrim(NEW.preparation_notes), '');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_provider_service_preparation_notes ON public.provider_services;
CREATE TRIGGER trg_normalize_provider_service_preparation_notes
  BEFORE INSERT OR UPDATE OF preparation_notes ON public.provider_services
  FOR EACH ROW EXECUTE FUNCTION public.tg_normalize_provider_service_preparation_notes();
