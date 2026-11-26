-- Append store-aligned privacy disclosures (Issue #521) when content exists in settings.

DO $$
DECLARE
  v_row public.settings%ROWTYPE;
  v_en text;
  v_ar text;
BEGIN
  SELECT * INTO v_row FROM public.settings WHERE key = 'content_privacy';
  IF NOT FOUND OR jsonb_typeof(v_row.value) IS DISTINCT FROM 'object' THEN
    RETURN;
  END IF;

  v_en := COALESCE(v_row.value->>'body_en', '');
  v_ar := COALESCE(v_row.value->>'body_ar', '');

  IF v_en <> '' AND position('Firebase Analytics' in v_en) = 0 THEN
    v_en := rtrim(v_en) || E'\n\n'
      || 'Product analytics: Famy uses Firebase Analytics (Google) to measure app usage, such as sign-up and booking steps. Events do not include your name or phone number, advertising ID collection is off, and data is not used for cross-app advertising.';
  END IF;

  IF v_en <> '' AND position('guardian' in v_en) = 0 AND position('12 to 17' in v_en) = 0 THEN
    v_en := rtrim(v_en) || E'\n\n'
      || 'Students aged 12 to 17: we collect your date of birth to confirm eligibility for online lessons. When required, we also collect a parent or guardian phone number and email to link and contact them about your account and bookings.';
  END IF;

  IF v_ar <> '' AND position('Firebase Analytics' in v_ar) = 0 THEN
    v_ar := rtrim(v_ar) || E'\n\n'
      || 'تحليلات المنتج: فامي تستخدم Firebase Analytics (Google) لقياس استخدام التطبيق، مثل التسجيل وخطوات الحجز. الأحداث لا تتضمن اسمك أو رقم هاتفك، وجمع معرف الإعلانات معطل، والبيانات لا تستخدم للإعلان عبر التطبيقات.';
  END IF;

  IF v_ar <> '' AND position('ولي الأمر' in v_ar) = 0 AND position('12' in v_ar) = 0 THEN
    v_ar := rtrim(v_ar) || E'\n\n'
      || 'للطلاب من 12 إلى 17 سنة: نجمع تاريخ الميلاد للتأكد من الأهلية للحصص الأونلاين. عند الحاجة نجمع هاتف وإيميل ولي الأمر للربط والتواصل بخصوص الحساب والحجوزات.';
  END IF;

  UPDATE public.settings
  SET value = jsonb_build_object('body_en', v_en, 'body_ar', v_ar)
  WHERE key = 'content_privacy';
END;
$$;

NOTIFY pgrst, 'reload schema';