-- Codex round 3: sum session intervals per participant; admin cancellation bucket (#421).

CREATE OR REPLACE FUNCTION public.admin_online_lessons_report_metrics(
  p_from timestamptz,
  p_to timestamptz,
  p_service_id uuid DEFAULT NULL,
  p_provider_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requests bigint := 0;
  v_confirmed bigint := 0;
  v_paid bigint := 0;
  v_joined bigint := 0;
  v_funnel_completed bigint := 0;
  v_completed bigint := 0;
  v_gross numeric := 0;
  v_commission numeric := 0;
  v_teacher_earnings numeric := 0;
  v_wallet_refund_credits numeric := 0;
  v_wallet_used numeric := 0;
  v_join_rate numeric := 0;
  v_avg_duration_min numeric := 0;
  v_no_show_reports bigint := 0;
  v_open_issue_reports bigint := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN
    RAISE EXCEPTION 'Invalid report period' USING ERRCODE = '23514';
  END IF;

  WITH scoped AS (
    SELECT b.*
    FROM public.bookings b
    WHERE b.deleted_at IS NULL
      AND b.service_mode = 'online'
      AND b.created_at >= p_from
      AND b.created_at < p_to
      AND (p_service_id IS NULL OR b.service_id = p_service_id)
      AND (p_provider_id IS NULL OR b.provider_id = p_provider_id)
  ),
  confirmed_booking AS (
    SELECT DISTINCT s.id AS booking_id
    FROM scoped s
    WHERE EXISTS (
      SELECT 1
      FROM public.booking_status_history h
      WHERE h.booking_id = s.id
        AND h.to_status = 'confirmed'
    )
  ),
  paid_booking AS (
    SELECT DISTINCT s.id AS booking_id
    FROM scoped s
    WHERE EXISTS (
      SELECT 1 FROM public.payments p
      WHERE p.booking_id = s.id
        AND p.status = 'captured'
        AND COALESCE(p.payment_method_type, '') IN ('online', 'manual_transfer')
    )
  ),
  joined_booking AS (
    SELECT s.id AS booking_id
    FROM scoped s
    WHERE public.online_session_participant_present(s.id, 'customer')
      AND public.online_session_participant_present(s.id, 'provider')
  )
  SELECT
    count(*)::bigint,
    count(*) FILTER (WHERE cb.booking_id IS NOT NULL)::bigint,
    count(*) FILTER (WHERE pb.booking_id IS NOT NULL)::bigint,
    count(*) FILTER (WHERE jb.booking_id IS NOT NULL)::bigint,
    count(*) FILTER (WHERE s.status = 'completed')::bigint
  INTO v_requests, v_confirmed, v_paid, v_joined, v_funnel_completed
  FROM scoped s
  LEFT JOIN confirmed_booking cb ON cb.booking_id = s.id
  LEFT JOIN paid_booking pb ON pb.booking_id = s.id
  LEFT JOIN joined_booking jb ON jb.booking_id = s.id;

  SELECT
    count(*)::bigint,
    COALESCE(sum(b.price_total), 0),
    COALESCE(sum(COALESCE(b.price_commission_amount, 0)), 0),
    COALESCE(sum(COALESCE(b.price_provider_net, 0)), 0)
  INTO v_completed, v_gross, v_commission, v_teacher_earnings
  FROM public.bookings b
  WHERE b.deleted_at IS NULL
    AND b.service_mode = 'online'
    AND b.status = 'completed'
    AND b.completed_at >= p_from
    AND b.completed_at < p_to
    AND (p_service_id IS NULL OR b.service_id = p_service_id)
    AND (p_provider_id IS NULL OR b.provider_id = p_provider_id);

  SELECT COALESCE(sum(e.amount), 0)
  INTO v_wallet_refund_credits
  FROM public.customer_wallet_entries e
  JOIN public.bookings b ON b.id = e.booking_id
  WHERE e.direction = 'credit'
    AND e.reason IN ('provider_cancelled', 'customer_cancelled_refund')
    AND e.created_at >= p_from
    AND e.created_at < p_to
    AND b.service_mode = 'online'
    AND (p_service_id IS NULL OR b.service_id = p_service_id)
    AND (p_provider_id IS NULL OR b.provider_id = p_provider_id);

  SELECT COALESCE(sum(
    CASE
      WHEN e.direction = 'debit' AND e.reason = 'checkout_spend' THEN e.amount
      WHEN e.direction = 'credit' AND e.reason = 'checkout_release' THEN -e.amount
      ELSE 0
    END
  ), 0)
  INTO v_wallet_used
  FROM public.customer_wallet_entries e
  JOIN public.bookings b ON b.id = e.booking_id
  WHERE e.reason IN ('checkout_spend', 'checkout_release')
    AND e.created_at >= p_from
    AND e.created_at < p_to
    AND b.service_mode = 'online'
    AND (p_service_id IS NULL OR b.service_id = p_service_id)
    AND (p_provider_id IS NULL OR b.provider_id = p_provider_id);

  WITH lesson_window AS (
    SELECT b.id
    FROM public.bookings b
    WHERE b.deleted_at IS NULL
      AND b.service_mode = 'online'
      AND b.start_at >= p_from
      AND b.start_at < p_to
      AND b.status IN ('completed', 'confirmed', 'cancelled', 'no_show')
      AND (p_service_id IS NULL OR b.service_id = p_service_id)
      AND (p_provider_id IS NULL OR b.provider_id = p_provider_id)
  ),
  joined_flags AS (
    SELECT
      lw.id,
      public.online_session_participant_present(lw.id, 'customer') AS customer_joined,
      public.online_session_participant_present(lw.id, 'provider') AS provider_joined
    FROM lesson_window lw
  ),
  duration_stats AS (
    SELECT avg(participant_minutes) AS avg_min
    FROM (
      SELECT
        SUM(
          GREATEST(
            EXTRACT(
              epoch FROM (
                COALESCE(se.left_at, LEAST(now(), b.end_at)) - se.joined_at
              )
            ),
            0
          )
        ) / 60.0 AS participant_minutes
      FROM public.session_events se
      JOIN public.bookings b ON b.id = se.booking_id
      WHERE b.deleted_at IS NULL
        AND b.service_mode = 'online'
        AND b.start_at >= p_from
        AND b.start_at < p_to
        AND (p_service_id IS NULL OR b.service_id = p_service_id)
        AND (p_provider_id IS NULL OR b.provider_id = p_provider_id)
      GROUP BY se.booking_id, se.participant
    ) per_participant
  )
  SELECT
    CASE WHEN count(*) = 0 THEN 0
      ELSE round(
        (count(*) FILTER (WHERE customer_joined AND provider_joined))::numeric / count(*)::numeric,
        4
      )
    END,
    COALESCE((SELECT avg_min FROM duration_stats), 0)
  INTO v_join_rate, v_avg_duration_min
  FROM joined_flags;

  SELECT count(*)::bigint
  INTO v_no_show_reports
  FROM public.no_show_reports r
  JOIN public.bookings b ON b.id = r.booking_id
  WHERE r.created_at >= p_from
    AND r.created_at < p_to
    AND b.service_mode = 'online'
    AND (p_service_id IS NULL OR b.service_id = p_service_id)
    AND (p_provider_id IS NULL OR b.provider_id = p_provider_id);

  SELECT count(*)::bigint
  INTO v_open_issue_reports
  FROM public.online_lesson_issue_reports r
  JOIN public.bookings b ON b.id = r.booking_id
  WHERE r.status = 'open'
    AND b.service_mode = 'online'
    AND r.created_at >= p_from
    AND r.created_at < p_to
    AND (p_service_id IS NULL OR b.service_id = p_service_id)
    AND (p_provider_id IS NULL OR b.provider_id = p_provider_id);

  RETURN jsonb_build_object(
    'requests', v_requests,
    'confirmed', v_confirmed,
    'paid', v_paid,
    'joined', v_joined,
    'funnel_completed', v_funnel_completed,
    'completed', v_completed,
    'gross_lesson_value', v_gross,
    'famy_commission', v_commission,
    'teacher_earnings', v_teacher_earnings,
    'wallet_refund_credits', v_wallet_refund_credits,
    'wallet_credit_used', v_wallet_used,
    'confirmation_rate', CASE WHEN v_requests = 0 THEN NULL ELSE round(v_confirmed::numeric / v_requests::numeric, 4) END,
    'paid_rate', CASE WHEN v_confirmed = 0 THEN NULL ELSE round(v_paid::numeric / v_confirmed::numeric, 4) END,
    'join_rate', v_join_rate,
    'avg_attended_minutes', round(v_avg_duration_min, 2),
    'no_show_reports', v_no_show_reports,
    'open_issue_reports', v_open_issue_reports
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_online_lessons_report(
  p_from timestamptz,
  p_to timestamptz,
  p_subject uuid DEFAULT NULL,
  p_provider uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_span interval;
  v_prev_from timestamptz;
  v_prev_to timestamptz;
  v_current jsonb;
  v_previous jsonb;
  v_kpis jsonb;
  v_funnel jsonb;
  v_cancellations jsonb;
  v_quality jsonb;
  v_top_teachers jsonb;
  v_top_subjects jsonb;
  v_heatmap jsonb;
  v_export jsonb;
  v_key text;
  v_cur numeric;
  v_prev numeric;
  v_delta jsonb := '{}'::jsonb;
  v_has_activity boolean := false;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN
    RAISE EXCEPTION 'Invalid report period' USING ERRCODE = '23514';
  END IF;

  v_span := p_to - p_from;
  v_prev_from := p_from - v_span;
  v_prev_to := p_from;

  v_current := public.admin_online_lessons_report_metrics(p_from, p_to, p_subject, p_provider);
  v_previous := public.admin_online_lessons_report_metrics(v_prev_from, v_prev_to, p_subject, p_provider);

  FOR v_key IN SELECT unnest(ARRAY[
    'requests', 'confirmation_rate', 'paid_rate', 'completed',
    'gross_lesson_value', 'famy_commission', 'teacher_earnings',
    'wallet_refund_credits', 'wallet_credit_used'
  ])
  LOOP
    v_cur := (v_current ->> v_key)::numeric;
    v_prev := (v_previous ->> v_key)::numeric;
    v_delta := v_delta || jsonb_build_object(
      v_key,
      jsonb_build_object(
        'current', v_cur,
        'previous', v_prev,
        'change', CASE
          WHEN v_prev IS NULL OR v_prev = 0 THEN NULL
          ELSE round((v_cur - v_prev) / v_prev, 4)
        END,
        'change_abs', CASE WHEN v_cur IS NULL OR v_prev IS NULL THEN NULL ELSE v_cur - v_prev END
      )
    );
  END LOOP;

  v_kpis := jsonb_build_object('period', v_delta, 'totals', v_current);

  v_funnel := jsonb_build_object(
    'request', (v_current ->> 'requests')::bigint,
    'confirmed', (v_current ->> 'confirmed')::bigint,
    'paid', (v_current ->> 'paid')::bigint,
    'joined', (v_current ->> 'joined')::bigint,
    'completed', COALESCE((v_current ->> 'funnel_completed')::bigint, 0),
    'drop_off', jsonb_build_object(
      'request_to_confirmed', GREATEST((v_current ->> 'requests')::bigint - (v_current ->> 'confirmed')::bigint, 0),
      'confirmed_to_paid', GREATEST((v_current ->> 'confirmed')::bigint - (v_current ->> 'paid')::bigint, 0),
      'paid_to_joined', GREATEST((v_current ->> 'paid')::bigint - (v_current ->> 'joined')::bigint, 0),
      'joined_to_completed', GREATEST(
        (v_current ->> 'joined')::bigint - COALESCE((v_current ->> 'funnel_completed')::bigint, 0),
        0
      )
    )
  );

  WITH cancelled AS (
    SELECT
      b.id,
      c.cancelled_at,
      c.cancelled_by_role,
      c.cancellation_fee,
      b.cancellation_reason,
      b.status_changed_by
    FROM public.bookings b
    LEFT JOIN LATERAL (
      SELECT bc.*
      FROM public.booking_cancellations bc
      WHERE bc.booking_id = b.id
      ORDER BY bc.cancelled_at DESC
      LIMIT 1
    ) c ON true
    WHERE b.deleted_at IS NULL
      AND b.service_mode = 'online'
      AND b.status = 'cancelled'
      AND COALESCE(c.cancelled_at, b.status_changed_at, b.updated_at) >= p_from
      AND COALESCE(c.cancelled_at, b.status_changed_at, b.updated_at) < p_to
      AND (p_subject IS NULL OR b.service_id = p_subject)
      AND (p_provider IS NULL OR b.provider_id = p_provider)
  )
  SELECT jsonb_build_object(
    'student_free', jsonb_build_object(
      'count', count(*) FILTER (WHERE cancelled_by_role = 'customer' AND COALESCE(cancellation_fee, 0) = 0),
      'amount', COALESCE(sum(cancellation_fee) FILTER (WHERE cancelled_by_role = 'customer' AND COALESCE(cancellation_fee, 0) = 0), 0)
    ),
    'student_late', jsonb_build_object(
      'count', count(*) FILTER (WHERE cancelled_by_role = 'customer' AND COALESCE(cancellation_fee, 0) > 0),
      'amount', COALESCE(sum(cancellation_fee) FILTER (WHERE cancelled_by_role = 'customer' AND COALESCE(cancellation_fee, 0) > 0), 0)
    ),
    'teacher', jsonb_build_object(
      'count', count(*) FILTER (WHERE cancelled_by_role = 'provider'),
      'amount', COALESCE(sum(COALESCE(cancellation_fee, 0)) FILTER (WHERE cancelled_by_role = 'provider'), 0)
    ),
    'admin', jsonb_build_object(
      'count', count(*) FILTER (WHERE cancelled_by_role = 'admin'),
      'amount', COALESCE(sum(COALESCE(cancellation_fee, 0)) FILTER (WHERE cancelled_by_role = 'admin'), 0)
    ),
    'system', jsonb_build_object(
      'count', count(*) FILTER (
        WHERE (
          cancelled_by_role IS NULL
          OR (status_changed_by IS NULL AND COALESCE(cancellation_reason, '') ILIKE '%payment deadline%')
        )
        AND cancelled_by_role IS DISTINCT FROM 'admin'
      ),
      'amount', COALESCE(sum(COALESCE(cancellation_fee, 0)) FILTER (
        WHERE (
          cancelled_by_role IS NULL
          OR (status_changed_by IS NULL AND COALESCE(cancellation_reason, '') ILIKE '%payment deadline%')
        )
        AND cancelled_by_role IS DISTINCT FROM 'admin'
      ), 0)
    )
  )
  INTO v_cancellations
  FROM cancelled;

  v_quality := jsonb_build_object(
    'join_rate', v_current -> 'join_rate',
    'avg_attended_minutes', v_current -> 'avg_attended_minutes',
    'no_show_reports', v_current -> 'no_show_reports',
    'open_issue_reports', v_current -> 'open_issue_reports'
  );

  SELECT COALESCE(jsonb_agg(row ORDER BY lessons DESC, earnings DESC), '[]'::jsonb)
  INTO v_top_teachers
  FROM (
    SELECT jsonb_build_object(
      'provider_id', p.id,
      'provider_name', pr.full_name,
      'lessons', count(*)::bigint,
      'completion_rate', NULL,
      'earnings', COALESCE(sum(b.price_provider_net), 0),
      'rating_avg', COALESCE(rs.rating_avg, 0)
    ) AS row,
    count(*)::bigint AS lessons,
    COALESCE(sum(b.price_provider_net), 0) AS earnings
    FROM public.bookings b
    JOIN public.providers p ON p.id = b.provider_id
    JOIN public.profiles pr ON pr.id = p.profile_id
    LEFT JOIN public.ratings_summary rs ON rs.provider_id = p.id
    WHERE b.deleted_at IS NULL
      AND b.service_mode = 'online'
      AND b.status = 'completed'
      AND b.completed_at >= p_from
      AND b.completed_at < p_to
      AND (p_subject IS NULL OR b.service_id = p_subject)
      AND (p_provider IS NULL OR b.provider_id = p_provider)
    GROUP BY p.id, pr.full_name, rs.rating_avg
    ORDER BY lessons DESC, earnings DESC
    LIMIT 10
  ) t;

  SELECT COALESCE(jsonb_agg(row ORDER BY lessons DESC), '[]'::jsonb)
  INTO v_top_subjects
  FROM (
    SELECT jsonb_build_object(
      'service_id', s.id,
      'subject_name_en', s.name_en,
      'subject_name_ar', s.name_ar,
      'lessons', count(*)::bigint,
      'revenue', COALESCE(sum(b.price_total), 0)
    ) AS row,
    count(*)::bigint AS lessons
    FROM public.bookings b
    JOIN public.services s ON s.id = b.service_id
    WHERE b.deleted_at IS NULL
      AND b.service_mode = 'online'
      AND b.status = 'completed'
      AND b.completed_at >= p_from
      AND b.completed_at < p_to
      AND (p_subject IS NULL OR b.service_id = p_subject)
      AND (p_provider IS NULL OR b.provider_id = p_provider)
    GROUP BY s.id, s.name_en, s.name_ar
    ORDER BY lessons DESC
    LIMIT 10
  ) t;

  WITH cells AS (
    SELECT
      EXTRACT(dow FROM timezone('Africa/Cairo', b.start_at))::int AS dow,
      EXTRACT(hour FROM timezone('Africa/Cairo', b.start_at))::int AS hour,
      count(*)::bigint AS lessons
    FROM public.bookings b
    WHERE b.deleted_at IS NULL
      AND b.service_mode = 'online'
      AND b.start_at >= p_from
      AND b.start_at < p_to
      AND (p_subject IS NULL OR b.service_id = p_subject)
      AND (p_provider IS NULL OR b.provider_id = p_provider)
    GROUP BY 1, 2
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('dow', dow, 'hour', hour, 'lessons', lessons) ORDER BY dow, hour), '[]'::jsonb)
  INTO v_heatmap
  FROM cells;

  SELECT COALESCE(jsonb_agg(row ORDER BY start_at DESC), '[]'::jsonb)
  INTO v_export
  FROM (
    SELECT jsonb_build_object(
      'booking_id', b.id,
      'start_at', b.start_at,
      'subject_en', s.name_en,
      'subject_ar', s.name_ar,
      'teacher_name', pr.full_name,
      'student_phone_masked', public.admin_mask_phone(cp.phone),
      'status', b.status::text,
      'price_total', b.price_total,
      'price_commission_amount', b.price_commission_amount,
      'price_provider_net', b.price_provider_net,
      'payment_method', (
        SELECT COALESCE(
          NULLIF(pay.payment_method_type, ''),
          pay.method::text
        )
        FROM public.payments pay
        WHERE pay.booking_id = b.id AND pay.status = 'captured'
        ORDER BY COALESCE(pay.captured_at, pay.created_at) DESC
        LIMIT 1
      )
    ) AS row,
    b.start_at
    FROM public.bookings b
    JOIN public.services s ON s.id = b.service_id
    JOIN public.providers pv ON pv.id = b.provider_id
    JOIN public.profiles pr ON pr.id = pv.profile_id
    JOIN public.profiles cp ON cp.id = b.customer_id
    WHERE b.deleted_at IS NULL
      AND b.service_mode = 'online'
      AND b.start_at >= p_from
      AND b.start_at < p_to
      AND (p_subject IS NULL OR b.service_id = p_subject)
      AND (p_provider IS NULL OR b.provider_id = p_provider)
    ORDER BY b.start_at DESC
    LIMIT 5000
  ) x;

  v_has_activity :=
    (v_current ->> 'requests')::bigint > 0
    OR (v_current ->> 'completed')::bigint > 0
    OR COALESCE((v_current ->> 'wallet_refund_credits')::numeric, 0) > 0
    OR COALESCE((v_current ->> 'wallet_credit_used')::numeric, 0) > 0
    OR COALESCE((v_current ->> 'gross_lesson_value')::numeric, 0) > 0
    OR COALESCE((v_current ->> 'no_show_reports')::bigint, 0) > 0
    OR COALESCE((v_cancellations -> 'student_free' ->> 'count')::bigint, 0) > 0
    OR COALESCE((v_cancellations -> 'student_late' ->> 'count')::bigint, 0) > 0
    OR COALESCE((v_cancellations -> 'teacher' ->> 'count')::bigint, 0) > 0
    OR COALESCE((v_cancellations -> 'system' ->> 'count')::bigint, 0) > 0
    OR COALESCE((v_cancellations -> 'admin' ->> 'count')::bigint, 0) > 0
    OR jsonb_array_length(v_export) > 0
    OR jsonb_array_length(v_top_teachers) > 0;

  RETURN jsonb_build_object(
    'period_from', p_from,
    'period_to', p_to,
    'previous_from', v_prev_from,
    'previous_to', v_prev_to,
    'filters', jsonb_build_object('subject_id', p_subject, 'provider_id', p_provider),
    'timezone', 'Africa/Cairo',
    'has_activity', v_has_activity,
    'kpis', v_kpis,
    'funnel', v_funnel,
    'cancellations', v_cancellations,
    'quality', v_quality,
    'top_teachers', v_top_teachers,
    'top_subjects', v_top_subjects,
    'heatmap', v_heatmap,
    'export_rows', v_export
  );
END;
$$;

NOTIFY pgrst, 'reload schema';