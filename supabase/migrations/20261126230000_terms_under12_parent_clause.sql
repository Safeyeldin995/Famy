-- Terms: add the PO-approved clause (26 Nov 2026) allowing a parent to book online
-- lessons for a child under 12 from the parent's account with supervision.
-- Idempotent: inserts once, right after clause 3.1, and bumps the "last updated" date.

DO $$
DECLARE
  v_row public.settings%ROWTYPE;
  v_en text;
  v_ar text;
  c_ar constant text := 'يجوز لولي الأمر حجز الدروس الأونلاين لأبنائه أقل من 12 عاما من حسابه، بشرط أن يتعهد بالتواجد مع الطفل أو متابعته طوال الحصة، ويكون ولي الأمر مسؤولا عن استخدام الطفل للمنصة.';
  c_en constant text := 'A parent may book online lessons for their children under 12 from the parent''s own account, provided the parent undertakes to be with the child or supervise them for the whole lesson. The parent is responsible for the child''s use of the platform.';
BEGIN
  SELECT * INTO v_row FROM public.settings WHERE key = 'content_terms';
  IF NOT FOUND OR jsonb_typeof(v_row.value) IS DISTINCT FROM 'object' THEN
    RETURN;
  END IF;

  v_en := COALESCE(v_row.value->>'body_en', '');
  v_ar := COALESCE(v_row.value->>'body_ar', '');

  IF v_ar <> '' AND position(c_ar in v_ar) = 0 THEN
    IF position(E'\n3.2 ' in v_ar) > 0 THEN
      v_ar := replace(v_ar, E'\n3.2 ', E'\n3.1.1 ' || c_ar || E'\n3.2 ');
    ELSE
      v_ar := rtrim(v_ar) || E'\n\n' || c_ar;
    END IF;
    v_ar := replace(v_ar, 'آخر تحديث: 25 نوفمبر 2026', 'آخر تحديث: 26 نوفمبر 2026');
  END IF;

  IF v_en <> '' AND position(c_en in v_en) = 0 THEN
    IF position(E'\n3.2 ' in v_en) > 0 THEN
      v_en := replace(v_en, E'\n3.2 ', E'\n3.1.1 ' || c_en || E'\n3.2 ');
    ELSE
      v_en := rtrim(v_en) || E'\n\n' || c_en;
    END IF;
    v_en := replace(v_en, 'Last updated: 25 November 2026', 'Last updated: 26 November 2026');
  END IF;

  UPDATE public.settings
  SET value = v_row.value || jsonb_build_object('body_en', v_en, 'body_ar', v_ar)
  WHERE key = 'content_terms';
END;
$$;

NOTIFY pgrst, 'reload schema';
