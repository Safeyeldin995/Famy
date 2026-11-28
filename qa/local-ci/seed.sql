-- Local CI seed: deterministic data for the e2e-local Playwright journeys.
-- Runs only against the throwaway `supabase start` database (seed.mjs checks
-- the URL is loopback before calling psql). User actions go through the same
-- RPCs and RLS the app uses, by acting as that user (request.jwt.claims +
-- role authenticated). Only fixture plumbing that has no app path runs as
-- the database owner.
--
-- psql variables: admin_id, customer_id, tutor_id, customer_phone, customer_dob,
-- tutor_phone, parent2_id, parent2_phone, child2_name, child2_dob,
-- child_name, child_dob, child_curriculum, child_level, service_slug,
-- subject_code, duration_min, in_person_price, online_price, promo_code,
-- promo_percent, wallet_credit.

\set ON_ERROR_STOP on
SET client_min_messages = warning;

-- ---------------------------------------------------------------------------
-- 0. Environment: nothing scheduled, nothing leaves the runner.
-- ---------------------------------------------------------------------------
-- pg_cron jobs would expire/auto-complete fixtures mid-run and the presence
-- poller would POST to the URL stored in settings (the Production site).
SELECT cron.unschedule(jobid) FROM cron.job;
UPDATE public.settings SET value = '{}'::jsonb WHERE key = 'online_presence_poll';
-- Production has online lessons on and the Paymob method active; the local
-- replay starts from the migration defaults. Paymob itself is never called:
-- the wallet covers every payment in these journeys and the browser stubs
-- every non-local host.
UPDATE public.settings
SET value = jsonb_set(value, '{online_lessons_enabled}', 'true'::jsonb)
WHERE key = 'release_features';
UPDATE public.payment_methods SET is_active = true WHERE code = 'paymob';

-- Helper: act as a signed-in user for the next statements.
CREATE OR REPLACE FUNCTION pg_temp.act_as(p_uid uuid, p_aal text DEFAULT 'aal1')
RETURNS void LANGUAGE sql AS $$
  SELECT
    set_config('request.jwt.claims',
      json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal)::text, false),
    set_config('request.jwt.claim.sub', p_uid::text, false),
    set_config('request.jwt.claim.role', 'authenticated', false);
$$;

-- Helper: back to "no signed-in user" (what pg_cron and the poller run as).
CREATE OR REPLACE FUNCTION pg_temp.act_as_system()
RETURNS void LANGUAGE sql AS $$
  SELECT
    set_config('request.jwt.claims', '', false),
    set_config('request.jwt.claim.sub', '', false),
    set_config('request.jwt.claim.role', '', false);
$$;

-- ---------------------------------------------------------------------------
-- 1. Roles: the admin account is admin only.
-- ---------------------------------------------------------------------------
DELETE FROM public.user_roles WHERE user_id = :'admin_id' AND role <> 'admin';
INSERT INTO public.user_roles (user_id, role) VALUES (:'admin_id', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Contact phones (bookings need one). The customer uses the app's RPC.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as(:'customer_id');
SET ROLE authenticated;
SELECT public.set_my_contact_phone(:'customer_phone');
UPDATE public.profiles SET date_of_birth = :'customer_dob'::date WHERE id = :'customer_id';
RESET ROLE;

SELECT pg_temp.act_as(:'parent2_id');
SET ROLE authenticated;
SELECT public.set_my_contact_phone(:'parent2_phone');
RESET ROLE;

SELECT set_config('famy.allow_phone_write', 'on', false);
UPDATE public.profiles SET phone = :'tutor_phone', phone_verified = true WHERE id = :'tutor_id';

-- ---------------------------------------------------------------------------
-- 3. Approved tutor: online + in person, one zone, open every day.
-- ---------------------------------------------------------------------------
INSERT INTO public.providers (
  profile_id, bio_ar, bio_en, years_experience, languages, hourly_rate, city,
  is_active, onboarding_status, offering_mode, governorate,
  min_notice_hours, max_advance_days, buffer_minutes
) VALUES (
  :'tutor_id', 'مدرس رياضيات لطلبة الإعدادي، تجربة محلية.', 'Maths tutor (local CI fixture).',
  6, ARRAY['ar', 'en'], 0, 'Cairo',
  true, 'DRAFT', 'both', 'cairo',
  0, 60, 0
);

CREATE TEMP TABLE fx AS
SELECT
  (SELECT id FROM public.providers WHERE profile_id = :'tutor_id') AS provider_id,
  (SELECT id FROM public.services WHERE slug = :'service_slug') AS service_id,
  (SELECT id FROM public.teaching_subjects WHERE code = :'subject_code') AS subject_id,
  (SELECT id FROM public.teaching_curricula WHERE code = :'child_curriculum') AS curriculum_id,
  (SELECT id FROM public.teaching_levels WHERE code = :'child_level') AS level_id;
GRANT SELECT ON fx TO authenticated;

INSERT INTO public.provider_services (provider_id, service_id, status)
SELECT provider_id, service_id, 'pending' FROM fx;

INSERT INTO public.provider_teaching_capabilities (
  provider_id, service_id, subject_id, curriculum_id, level_id,
  session_duration_min, session_price, online_session_price, status
)
SELECT provider_id, service_id, subject_id, curriculum_id, level_id,
  :duration_min, :in_person_price, :online_price, 'approved'
FROM fx;

INSERT INTO public.availability_rules (provider_id, weekday, start_time, end_time)
SELECT fx.provider_id, d, '08:00'::time, '22:00'::time FROM fx, generate_series(0, 6) AS d;

INSERT INTO public.zones (name_en, name_ar, is_active, boundary_type, center_lat, center_lng, radius_km, travel_fee)
VALUES ('Local CI Zone', 'منطقة التجربة', true, 'circle', 30.05, 31.25, 25, 0);
INSERT INTO public.zone_services (zone_id, service_id)
SELECT z.id, fx.service_id FROM public.zones z, fx WHERE z.name_en = 'Local CI Zone';
INSERT INTO public.zone_providers (zone_id, provider_id)
SELECT z.id, fx.provider_id FROM public.zones z, fx WHERE z.name_en = 'Local CI Zone';

-- The admin approves the service (the same UPDATE the admin page sends).
SELECT pg_temp.act_as(:'admin_id', 'aal2');
SET ROLE authenticated;
UPDATE public.provider_services ps SET status = 'approved'
FROM fx WHERE ps.provider_id = fx.provider_id AND ps.service_id = fx.service_id;
RESET ROLE;

SELECT set_config('app.onboarding_status_transition', '1', false);
UPDATE public.providers p
SET onboarding_status = 'APPROVED', is_verified = true, is_active = true
FROM fx WHERE p.id = fx.provider_id;

-- ---------------------------------------------------------------------------
-- 4. Customer: one child with a learning profile (system + grade), wallet
--    credit, an online-only promo code.
-- ---------------------------------------------------------------------------
INSERT INTO public.family_members (
  customer_id, full_name, relationship, date_of_birth, is_active,
  education_curriculum_id, education_level_id, grade_confirmed_for_year
)
SELECT :'customer_id', :'child_name', 'son', :'child_dob'::date, true,
  fx.curriculum_id, fx.level_id, extract(year FROM now())::int
FROM fx;

INSERT INTO public.family_members (
  customer_id, full_name, relationship, date_of_birth, is_active,
  education_curriculum_id, education_level_id, grade_confirmed_for_year
)
SELECT :'parent2_id', :'child2_name', 'daughter', :'child2_dob'::date, true,
  fx.curriculum_id, fx.level_id, extract(year FROM now())::int
FROM fx;

SELECT pg_temp.act_as(:'admin_id', 'aal2');
SET ROLE authenticated;
SELECT public.admin_wallet_adjust(
  :'customer_id', 'credit', :wallet_credit, 'gift', 'رصيد تجربة محلية', NULL, 'local-ci-seed-credit'
);
RESET ROLE;

INSERT INTO public.promo_codes (
  code, description_ar, description_en, discount_type, discount_value,
  applicable_mode, is_active, created_by
) VALUES (
  :'promo_code', 'خصم الدروس الأونلاين', 'Online lessons discount', 'percentage', :promo_percent,
  'online', true, :'admin_id'
);

-- ---------------------------------------------------------------------------
-- 5. Three paid online lessons for the child, booked and paid through the RPCs.
--    A: upcoming and paid (the admin refunds it to the wallet).
--    B: already held and sent to admin review by the attendance check.
--    C: finished a few hours ago, waiting for the tutor's lesson report.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE seeded_bookings (label text PRIMARY KEY, booking_id uuid, payment_id uuid);
GRANT ALL ON seeded_bookings TO authenticated;

CREATE OR REPLACE FUNCTION pg_temp.book_and_pay(p_label text, p_days int)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_customer uuid := current_setting('fx.customer_id')::uuid;
  v_tutor uuid := current_setting('fx.tutor_id')::uuid;
  v_child uuid;
  v_cap uuid;
  v_fx record;
  v_start timestamptz;
  v_result jsonb;
  v_booking uuid;
  v_payment uuid;
  v_method uuid;
  v_amount numeric;
BEGIN
  SELECT * INTO v_fx FROM fx;
  SELECT id INTO v_child FROM public.family_members WHERE customer_id = v_customer LIMIT 1;
  SELECT id INTO v_cap FROM public.provider_teaching_capabilities WHERE provider_id = v_fx.provider_id LIMIT 1;
  SELECT id INTO v_method FROM public.payment_methods WHERE code = 'paymob';
  v_start := ((now() AT TIME ZONE 'Africa/Cairo')::date + p_days + time '18:00') AT TIME ZONE 'Africa/Cairo';

  PERFORM pg_temp.act_as(v_customer);
  SET LOCAL ROLE authenticated;
  v_result := to_jsonb(public.create_booking(
    v_fx.provider_id, v_fx.service_id, NULL, v_start, v_start + interval '60 minutes',
    gen_random_uuid(), v_child, 'local CI seed', NULL, '[]'::jsonb, v_cap,
    current_setting('fx.subject_code'), current_setting('fx.child_curriculum'),
    current_setting('fx.child_level'), NULL, 'online'
  ));
  RESET ROLE;
  v_booking := COALESCE(v_result->>'booking_id', v_result->>'id')::uuid;

  PERFORM pg_temp.act_as(v_tutor);
  SET LOCAL ROLE authenticated;
  UPDATE public.bookings SET status = 'confirmed' WHERE id = v_booking;
  RESET ROLE;

  PERFORM pg_temp.act_as(v_customer);
  SET LOCAL ROLE authenticated;
  SELECT price_total + COALESCE(carried_fees_amount, 0) INTO v_amount FROM public.bookings WHERE id = v_booking;
  INSERT INTO public.payments (booking_id, customer_id, payment_method_id, amount, currency, status)
  VALUES (v_booking, v_customer, v_method, v_amount, 'EGP', 'pending')
  RETURNING id INTO v_payment;
  PERFORM public.customer_apply_wallet_at_checkout(v_payment);
  RESET ROLE;

  INSERT INTO seeded_bookings VALUES (p_label, v_booking, v_payment);
END;
$$;

SELECT set_config('fx.customer_id', :'customer_id', false),
       set_config('fx.tutor_id', :'tutor_id', false),
       set_config('fx.subject_code', :'subject_code', false),
       set_config('fx.child_curriculum', :'child_curriculum', false),
       set_config('fx.child_level', :'child_level', false);

SELECT pg_temp.book_and_pay('upcoming_paid', 3);
SELECT pg_temp.book_and_pay('held_review', 4);
SELECT pg_temp.book_and_pay('completed_lesson', 5);

-- B happened yesterday and the attendance check flagged it. Moving a booking
-- into the past has no app path, so this is fixture plumbing; the review is
-- opened the way the attendance job opens it (no signed-in user).
SELECT pg_temp.act_as_system();
SET session_replication_role = replica;
UPDATE public.bookings b
SET start_at = now() - interval '26 hours',
    end_at = now() - interval '25 hours',
    status = 'completed'
FROM seeded_bookings s
WHERE s.label = 'held_review' AND b.id = s.booking_id;
-- C finished three hours ago: the tutor writes the lesson report (05-lesson-report).
UPDATE public.bookings b
SET start_at = now() - interval '4 hours',
    end_at = now() - interval '3 hours',
    completed_at = now() - interval '3 hours',
    status = 'completed'
FROM seeded_bookings s
WHERE s.label = 'completed_lesson' AND b.id = s.booking_id;
SET session_replication_role = origin;

SELECT public.open_online_session_admin_review(
  s.booking_id,
  'Online session evidence: admin_review_overlap',
  jsonb_build_object('overlap_minutes', 12, 'required_overlap_minutes', 30, 'outcome', 'admin_review_overlap')
)
FROM seeded_bookings s WHERE s.label = 'held_review';

-- Report for the seed script (parsed as JSON; ids only).
\pset tuples_only on
\pset format unaligned
SELECT json_build_object(
  'providerId', (SELECT provider_id FROM fx),
  'serviceId', (SELECT service_id FROM fx),
  'childId', (SELECT id FROM public.family_members WHERE customer_id = :'customer_id' LIMIT 1),
  'bookings', (SELECT json_object_agg(label, json_build_object('bookingId', booking_id, 'paymentId', payment_id)) FROM seeded_bookings),
  'walletBalance', public.customer_wallet_balance_internal(:'customer_id')
);
