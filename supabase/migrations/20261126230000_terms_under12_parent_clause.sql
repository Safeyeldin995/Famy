-- Terms and Privacy: PO-approved legal updates (26 Nov 2026).
--  1. Terms 3.1.1: a parent may book online lessons for a child under 12 with supervision.
--  2. Terms 6.6: automatic online no-show settlement.
--  3. Wallet balance forfeited on account deletion after a warning and confirmation (Terms 9.2, Privacy 7).
--  4. Parent auto-link only to a parent phone verified by code (Terms 3.3, Privacy 3.6).
--  5. Online lessons in every governorate; Famy may suspend a governorate (Terms 4.6).
--  6. Privacy 2.d: birth date used for online eligibility (no longer "12 or older").
--  7. Privacy 5.2: Google Maps replaces OpenStreetMap.
--  8. "Last updated" dates set to 26 November 2026.
-- Idempotent: each pair is applied only when the new text is absent and the old anchor exists.

DO $$
DECLARE
  v_terms public.settings%ROWTYPE;
  v_priv  public.settings%ROWTYPE;
  v_text  text;
  i int;

  t_ar_old text[] := ARRAY[
    E'\n3.2 في غير الدروس الأونلاين',
    'ترسل فامي إلى ولي الأمر إشعارا بذلك، ويمكن لولي الأمر ربط حسابه',
    'لا تسجل فامي الحصص ولا تحتفظ بالصوت أو الصورة.',
    '6.6 في حالة عدم حضور أحد الطرفين لحصة أونلاين، يراجع فريق فامي البلاغ ويقرر التعويض المناسب عن طريق المحفظة.',
    'لا يؤثر إغلاق الحساب على الحجوزات أو المدفوعات التي تمت قبله.',
    'آخر تحديث: 25 نوفمبر 2026'
  ];
  t_ar_new text[] := ARRAY[
    E'\n3.1.1 يجوز لولي الأمر حجز الدروس الأونلاين لأبنائه أقل من 12 عاما من حسابه، بشرط أن يتعهد بالتواجد مع الطفل أو متابعته طوال الحصة، ويكون ولي الأمر مسؤولا عن استخدام الطفل للمنصة.\n3.2 في غير الدروس الأونلاين',
    'ترسل فامي إلى ولي الأمر إشعارا بذلك، ولا يتم ربط الحسابين تلقائيا إلا برقم هاتف ولي أمر تم التحقق منه بكود، ويمكن لولي الأمر ربط حسابه',
    'لا تسجل فامي الحصص ولا تحتفظ بالصوت أو الصورة. تتاح الدروس الأونلاين في جميع محافظات جمهورية مصر العربية، ويجوز لفامي إيقافها في محافظة معينة.',
    '6.6 في حالة عدم حضور المدرس لحصة أونلاين، يضاف المبلغ المدفوع كاملا إلى محفظة الطالب على فامي. وفي حالة عدم حضور الطالب، تحتسب عليه رسوم الإلغاء المتأخر المطبقة على الدروس الأونلاين. وإذا لم تتوفر بيانات حضور واضحة، يراجع فريق فامي الحصة ويقرر التسوية المناسبة.',
    'لا يؤثر إغلاق الحساب على الحجوزات أو المدفوعات التي تمت قبله. إذا كان في محفظة فامي رصيد عند حذف الحساب، يسقط هذا الرصيد ولا يمكن استرداده، وذلك بعد تنبيه صريح بقيمته وتأكيد المستخدم.',
    'آخر تحديث: 26 نوفمبر 2026'
  ];

  t_en_old text[] := ARRAY[
    E'\n3.2 Outside online lessons',
    'Famy sends the parent a notice of this, and the parent can link',
    'Famy does not record lessons and does not keep any audio or video.',
    '6.6 If either party does not show up for an online lesson, the Famy team reviews the report and decides the appropriate compensation through the wallet.',
    'Closing your account does not affect bookings or payments made before it was closed.',
    'Last updated: 25 November 2026'
  ];
  t_en_new text[] := ARRAY[
    E'\n3.1.1 A parent may book online lessons for their children under 12 from the parent''s own account, provided the parent undertakes to be with the child or supervise them for the whole lesson. The parent is responsible for the child''s use of the platform.\n3.2 Outside online lessons',
    'Famy sends the parent a notice of this. Accounts are linked automatically only to a parent phone number verified by code, and the parent can link',
    'Famy does not record lessons and does not keep any audio or video. Online lessons are available in every governorate of Egypt, and Famy may suspend them in a specific governorate.',
    '6.6 If the teacher does not show up for an online lesson, the full amount paid is added to the student''s Famy wallet. If the student does not show up, the late-cancellation fee for online lessons applies. If there is no clear attendance data, the Famy team reviews the lesson and decides the appropriate settlement.',
    'Closing your account does not affect bookings or payments made before it was closed. If your Famy wallet has a balance when you delete your account, that balance is forfeited and cannot be refunded, after you are clearly warned of the amount and confirm.',
    'Last updated: 26 November 2026'
  ];

  p_ar_old text[] := ARRAY[
    'تاريخ ميلاد الطالب للتأكد من أن سنه 12 عاما أو أكثر',
    'ولا يظهران للمدرس إطلاقا.',
    '- OpenStreetMap: عرض الخرائط.',
    'عند طلب حذف الحساب نحذف بياناتك أو نجعلها مجهولة خلال 30 يوما.',
    'آخر تحديث: 25 نوفمبر 2026'
  ];
  p_ar_new text[] := ARRAY[
    'تاريخ ميلاد الطالب للتأكد من أهلية الطالب للحصص الأونلاين',
    'ولا يظهران للمدرس إطلاقا. ولا يتم ربط الحسابين تلقائيا إلا برقم هاتف ولي أمر تم التحقق منه بكود.',
    '- Google Maps: عرض الخرائط واختيار العنوان.',
    'عند طلب حذف الحساب نحذف بياناتك أو نجعلها مجهولة خلال 30 يوما. إذا كان في محفظة فامي رصيد عند حذف الحساب، يسقط هذا الرصيد بعد تنبيهك بقيمته وتأكيدك.',
    'آخر تحديث: 26 نوفمبر 2026'
  ];

  p_en_old text[] := ARRAY[
    'the student''s date of birth, to confirm they are at least 12 years old,',
    'and they are never shown to the teacher.',
    '- OpenStreetMap: map display.',
    'we delete your data or make it anonymous within 30 days.',
    'Last updated: 25 November 2026'
  ];
  p_en_new text[] := ARRAY[
    'the student''s date of birth, to confirm the student''s eligibility for online lessons,',
    'and they are never shown to the teacher. Accounts are linked automatically only to a parent phone number verified by code.',
    '- Google Maps: map display and address selection.',
    'we delete your data or make it anonymous within 30 days. If your Famy wallet has a balance when you delete your account, that balance is forfeited after you are warned of the amount and confirm.',
    'Last updated: 26 November 2026'
  ];
BEGIN
  SELECT * INTO v_terms FROM public.settings WHERE key = 'content_terms';
  IF FOUND AND jsonb_typeof(v_terms.value) = 'object' THEN
    v_text := COALESCE(v_terms.value->>'body_ar', '');
    FOR i IN 1 .. array_length(t_ar_old, 1) LOOP
      IF v_text <> '' AND position(t_ar_new[i] in v_text) = 0 AND position(t_ar_old[i] in v_text) > 0 THEN
        v_text := replace(v_text, t_ar_old[i], t_ar_new[i]);
      END IF;
    END LOOP;
    v_terms.value := v_terms.value || jsonb_build_object('body_ar', v_text);

    v_text := COALESCE(v_terms.value->>'body_en', '');
    FOR i IN 1 .. array_length(t_en_old, 1) LOOP
      IF v_text <> '' AND position(t_en_new[i] in v_text) = 0 AND position(t_en_old[i] in v_text) > 0 THEN
        v_text := replace(v_text, t_en_old[i], t_en_new[i]);
      END IF;
    END LOOP;
    v_terms.value := v_terms.value || jsonb_build_object('body_en', v_text);

    UPDATE public.settings SET value = v_terms.value WHERE key = 'content_terms';
  END IF;

  SELECT * INTO v_priv FROM public.settings WHERE key = 'content_privacy';
  IF FOUND AND jsonb_typeof(v_priv.value) = 'object' THEN
    v_text := COALESCE(v_priv.value->>'body_ar', '');
    FOR i IN 1 .. array_length(p_ar_old, 1) LOOP
      IF v_text <> '' AND position(p_ar_new[i] in v_text) = 0 AND position(p_ar_old[i] in v_text) > 0 THEN
        v_text := replace(v_text, p_ar_old[i], p_ar_new[i]);
      END IF;
    END LOOP;
    v_priv.value := v_priv.value || jsonb_build_object('body_ar', v_text);

    v_text := COALESCE(v_priv.value->>'body_en', '');
    FOR i IN 1 .. array_length(p_en_old, 1) LOOP
      IF v_text <> '' AND position(p_en_new[i] in v_text) = 0 AND position(p_en_old[i] in v_text) > 0 THEN
        v_text := replace(v_text, p_en_old[i], p_en_new[i]);
      END IF;
    END LOOP;
    v_priv.value := v_priv.value || jsonb_build_object('body_en', v_text);

    UPDATE public.settings SET value = v_priv.value WHERE key = 'content_privacy';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
