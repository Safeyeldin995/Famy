
CREATE OR REPLACE FUNCTION public.tg_audit_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_id uuid;
  v_diff jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW); v_id := NEW.id;
  ELSIF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD); v_new := to_jsonb(NEW); v_id := NEW.id;
    IF v_old = v_new THEN RETURN NEW; END IF;
    SELECT jsonb_object_agg(k, v_new->k) INTO v_diff
    FROM jsonb_object_keys(v_new) k
    WHERE v_old->k IS DISTINCT FROM v_new->k;
  ELSE
    v_old := to_jsonb(OLD); v_id := OLD.id;
  END IF;
  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, old_values, new_values, diff)
  VALUES (auth.uid(), TG_OP, TG_TABLE_NAME, v_id, v_old, v_new, v_diff);
  RETURN COALESCE(NEW, OLD);
END $$;
REVOKE EXECUTE ON FUNCTION public.tg_audit_changes() FROM PUBLIC, anon, authenticated;
