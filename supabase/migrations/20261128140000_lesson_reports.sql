-- Lesson reports and learner progress (PO decision, 28 Nov 2026).
--
-- After a tutoring, Quran or music lesson, the tutor writes a short report:
-- what was covered, homework, and how well the student understood. Quran reports
-- add structured memorization ranges (surah/ayah, from a 114-surah catalog);
-- music reports add the instrument, level and piece. The customer (and the linked
-- parent of a self-booking student, #419) is notified and sees the report on the
-- booking and on a per-learner progress page.
--
-- Access: the report tables have RLS on and no grants to anon/authenticated.
-- Every read and write goes through the SECURITY DEFINER RPCs below, which allow
-- only the booking's tutor (write + read), the booking's customer, the linked
-- parent of a self-booking student, and admins (read).
-- Quran/music are detected from service slug and subject code, never from the
-- category slug (categories are being split separately).

-- ---------------------------------------------------------------------------
-- 1. Quran catalog (public reference data)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.quran_surahs (
  number smallint PRIMARY KEY CHECK (number BETWEEN 1 AND 114),
  name_ar text NOT NULL,
  name_en text NOT NULL,
  ayah_count smallint NOT NULL CHECK (ayah_count > 0)
);

INSERT INTO public.quran_surahs (number, name_ar, name_en, ayah_count) VALUES
  (1, 'الفاتحة', 'Al-Fatihah', 7),
  (2, 'البقرة', 'Al-Baqarah', 286),
  (3, 'آل عمران', 'Al Imran', 200),
  (4, 'النساء', 'An-Nisa', 176),
  (5, 'المائدة', 'Al-Maidah', 120),
  (6, 'الأنعام', 'Al-Anam', 165),
  (7, 'الأعراف', 'Al-Araf', 206),
  (8, 'الأنفال', 'Al-Anfal', 75),
  (9, 'التوبة', 'At-Tawbah', 129),
  (10, 'يونس', 'Yunus', 109),
  (11, 'هود', 'Hud', 123),
  (12, 'يوسف', 'Yusuf', 111),
  (13, 'الرعد', 'Ar-Rad', 43),
  (14, 'إبراهيم', 'Ibrahim', 52),
  (15, 'الحجر', 'Al-Hijr', 99),
  (16, 'النحل', 'An-Nahl', 128),
  (17, 'الإسراء', 'Al-Isra', 111),
  (18, 'الكهف', 'Al-Kahf', 110),
  (19, 'مريم', 'Maryam', 98),
  (20, 'طه', 'Taha', 135),
  (21, 'الأنبياء', 'Al-Anbiya', 112),
  (22, 'الحج', 'Al-Hajj', 78),
  (23, 'المؤمنون', 'Al-Muminun', 118),
  (24, 'النور', 'An-Nur', 64),
  (25, 'الفرقان', 'Al-Furqan', 77),
  (26, 'الشعراء', 'Ash-Shuara', 227),
  (27, 'النمل', 'An-Naml', 93),
  (28, 'القصص', 'Al-Qasas', 88),
  (29, 'العنكبوت', 'Al-Ankabut', 69),
  (30, 'الروم', 'Ar-Rum', 60),
  (31, 'لقمان', 'Luqman', 34),
  (32, 'السجدة', 'As-Sajdah', 30),
  (33, 'الأحزاب', 'Al-Ahzab', 73),
  (34, 'سبأ', 'Saba', 54),
  (35, 'فاطر', 'Fatir', 45),
  (36, 'يس', 'Ya-Sin', 83),
  (37, 'الصافات', 'As-Saffat', 182),
  (38, 'ص', 'Sad', 88),
  (39, 'الزمر', 'Az-Zumar', 75),
  (40, 'غافر', 'Ghafir', 85),
  (41, 'فصلت', 'Fussilat', 54),
  (42, 'الشورى', 'Ash-Shura', 53),
  (43, 'الزخرف', 'Az-Zukhruf', 89),
  (44, 'الدخان', 'Ad-Dukhan', 59),
  (45, 'الجاثية', 'Al-Jathiyah', 37),
  (46, 'الأحقاف', 'Al-Ahqaf', 35),
  (47, 'محمد', 'Muhammad', 38),
  (48, 'الفتح', 'Al-Fath', 29),
  (49, 'الحجرات', 'Al-Hujurat', 18),
  (50, 'ق', 'Qaf', 45),
  (51, 'الذاريات', 'Adh-Dhariyat', 60),
  (52, 'الطور', 'At-Tur', 49),
  (53, 'النجم', 'An-Najm', 62),
  (54, 'القمر', 'Al-Qamar', 55),
  (55, 'الرحمن', 'Ar-Rahman', 78),
  (56, 'الواقعة', 'Al-Waqiah', 96),
  (57, 'الحديد', 'Al-Hadid', 29),
  (58, 'المجادلة', 'Al-Mujadilah', 22),
  (59, 'الحشر', 'Al-Hashr', 24),
  (60, 'الممتحنة', 'Al-Mumtahanah', 13),
  (61, 'الصف', 'As-Saff', 14),
  (62, 'الجمعة', 'Al-Jumuah', 11),
  (63, 'المنافقون', 'Al-Munafiqun', 11),
  (64, 'التغابن', 'At-Taghabun', 18),
  (65, 'الطلاق', 'At-Talaq', 12),
  (66, 'التحريم', 'At-Tahrim', 12),
  (67, 'الملك', 'Al-Mulk', 30),
  (68, 'القلم', 'Al-Qalam', 52),
  (69, 'الحاقة', 'Al-Haqqah', 52),
  (70, 'المعارج', 'Al-Maarij', 44),
  (71, 'نوح', 'Nuh', 28),
  (72, 'الجن', 'Al-Jinn', 28),
  (73, 'المزمل', 'Al-Muzzammil', 20),
  (74, 'المدثر', 'Al-Muddaththir', 56),
  (75, 'القيامة', 'Al-Qiyamah', 40),
  (76, 'الإنسان', 'Al-Insan', 31),
  (77, 'المرسلات', 'Al-Mursalat', 50),
  (78, 'النبأ', 'An-Naba', 40),
  (79, 'النازعات', 'An-Naziat', 46),
  (80, 'عبس', 'Abasa', 42),
  (81, 'التكوير', 'At-Takwir', 29),
  (82, 'الانفطار', 'Al-Infitar', 19),
  (83, 'المطففين', 'Al-Mutaffifin', 36),
  (84, 'الانشقاق', 'Al-Inshiqaq', 25),
  (85, 'البروج', 'Al-Buruj', 22),
  (86, 'الطارق', 'At-Tariq', 17),
  (87, 'الأعلى', 'Al-Ala', 19),
  (88, 'الغاشية', 'Al-Ghashiyah', 26),
  (89, 'الفجر', 'Al-Fajr', 30),
  (90, 'البلد', 'Al-Balad', 20),
  (91, 'الشمس', 'Ash-Shams', 15),
  (92, 'الليل', 'Al-Layl', 21),
  (93, 'الضحى', 'Ad-Duha', 11),
  (94, 'الشرح', 'Ash-Sharh', 8),
  (95, 'التين', 'At-Tin', 8),
  (96, 'العلق', 'Al-Alaq', 19),
  (97, 'القدر', 'Al-Qadr', 5),
  (98, 'البينة', 'Al-Bayyinah', 8),
  (99, 'الزلزلة', 'Az-Zalzalah', 8),
  (100, 'العاديات', 'Al-Adiyat', 11),
  (101, 'القارعة', 'Al-Qariah', 11),
  (102, 'التكاثر', 'At-Takathur', 8),
  (103, 'العصر', 'Al-Asr', 3),
  (104, 'الهمزة', 'Al-Humazah', 9),
  (105, 'الفيل', 'Al-Fil', 5),
  (106, 'قريش', 'Quraysh', 4),
  (107, 'الماعون', 'Al-Maun', 7),
  (108, 'الكوثر', 'Al-Kawthar', 3),
  (109, 'الكافرون', 'Al-Kafirun', 6),
  (110, 'النصر', 'An-Nasr', 3),
  (111, 'المسد', 'Al-Masad', 5),
  (112, 'الإخلاص', 'Al-Ikhlas', 4),
  (113, 'الفلق', 'Al-Falaq', 5),
  (114, 'الناس', 'An-Nas', 6)
ON CONFLICT (number) DO UPDATE SET
  name_ar = EXCLUDED.name_ar,
  name_en = EXCLUDED.name_en,
  ayah_count = EXCLUDED.ayah_count;

-- Where each of the 30 juz starts (Hafs, Madani mushaf).
CREATE TABLE IF NOT EXISTS public.quran_juz (
  juz smallint PRIMARY KEY CHECK (juz BETWEEN 1 AND 30),
  start_surah smallint NOT NULL REFERENCES public.quran_surahs (number),
  start_ayah smallint NOT NULL CHECK (start_ayah >= 1)
);

INSERT INTO public.quran_juz (juz, start_surah, start_ayah) VALUES
  (1, 1, 1),
  (2, 2, 142),
  (3, 2, 253),
  (4, 3, 93),
  (5, 4, 24),
  (6, 4, 148),
  (7, 5, 82),
  (8, 6, 111),
  (9, 7, 88),
  (10, 8, 41),
  (11, 9, 93),
  (12, 11, 6),
  (13, 12, 53),
  (14, 15, 1),
  (15, 17, 1),
  (16, 18, 75),
  (17, 21, 1),
  (18, 23, 1),
  (19, 25, 21),
  (20, 27, 56),
  (21, 29, 46),
  (22, 33, 31),
  (23, 36, 28),
  (24, 39, 32),
  (25, 41, 47),
  (26, 46, 1),
  (27, 51, 31),
  (28, 58, 1),
  (29, 67, 1),
  (30, 78, 1)
ON CONFLICT (juz) DO UPDATE SET
  start_surah = EXCLUDED.start_surah,
  start_ayah = EXCLUDED.start_ayah;

ALTER TABLE public.quran_surahs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quran_juz ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quran_surahs_public_read ON public.quran_surahs;
CREATE POLICY quran_surahs_public_read ON public.quran_surahs FOR SELECT USING (true);
DROP POLICY IF EXISTS quran_juz_public_read ON public.quran_juz;
CREATE POLICY quran_juz_public_read ON public.quran_juz FOR SELECT USING (true);

REVOKE ALL ON public.quran_surahs, public.quran_juz FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.quran_surahs, public.quran_juz TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Report tables (RPC-only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lesson_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE REFERENCES public.bookings (id) ON DELETE CASCADE,
  report_kind text NOT NULL CHECK (report_kind IN ('tutoring', 'quran', 'music')),
  covered text NOT NULL CHECK (char_length(covered) BETWEEN 2 AND 600),
  homework text CHECK (homework IS NULL OR char_length(homework) BETWEEN 1 AND 600),
  understanding text NOT NULL
    CHECK (understanding IN ('needs_support', 'good', 'excellent')),
  music_instrument text
    CHECK (music_instrument IS NULL OR music_instrument IN ('guitar', 'oud', 'piano_keyboard', 'violin', 'other')),
  music_level text
    CHECK (music_level IS NULL OR music_level IN ('beginner', 'intermediate', 'advanced')),
  music_piece text CHECK (music_piece IS NULL OR char_length(music_piece) BETWEEN 1 AND 200),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lesson_reports_music_fields CHECK (
    (report_kind = 'music' AND music_instrument IS NOT NULL AND music_level IS NOT NULL)
    OR (report_kind <> 'music' AND music_instrument IS NULL AND music_level IS NULL AND music_piece IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.lesson_report_quran_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.lesson_reports (id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 4),
  entry_kind text NOT NULL CHECK (entry_kind IN ('new', 'review', 'tajweed')),
  from_surah smallint NOT NULL REFERENCES public.quran_surahs (number),
  from_ayah smallint NOT NULL CHECK (from_ayah >= 1),
  to_surah smallint NOT NULL REFERENCES public.quran_surahs (number),
  to_ayah smallint NOT NULL CHECK (to_ayah >= 1),
  CONSTRAINT lesson_report_quran_entries_order CHECK (
    from_surah < to_surah OR (from_surah = to_surah AND from_ayah <= to_ayah)
  ),
  UNIQUE (report_id, position)
);

CREATE TABLE IF NOT EXISTS public.lesson_report_reminders (
  booking_id uuid PRIMARY KEY REFERENCES public.bookings (id) ON DELETE CASCADE,
  sent_count smallint NOT NULL DEFAULT 0,
  last_sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lesson_report_quran_entries_report_idx
  ON public.lesson_report_quran_entries (report_id);

ALTER TABLE public.lesson_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_report_quran_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_report_reminders ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.lesson_reports, public.lesson_report_quran_entries, public.lesson_report_reminders
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.lesson_reports, public.lesson_report_quran_entries, public.lesson_report_reminders
  TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Internal helpers (not executable by anon/authenticated)
-- ---------------------------------------------------------------------------

-- Which report a booking takes: 'quran', 'music', 'tutoring', or NULL when the
-- service is not a teaching service (babysitting and the rest).
CREATE OR REPLACE FUNCTION public.lesson_report_kind(p_service_id uuid, p_subject_code text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN coalesce(p_subject_code, '') LIKE 'quran\_%' OR s.slug = 'quran-lessons' THEN 'quran'
    WHEN coalesce(p_subject_code, '') LIKE 'music\_%' OR s.slug = 'music-lessons' THEN 'music'
    WHEN p_subject_code IS NOT NULL
      OR EXISTS (SELECT 1 FROM public.teaching_subject_services ts WHERE ts.service_id = s.id)
      THEN 'tutoring'
    ELSE NULL
  END
  FROM (SELECT p_service_id AS id) x
  LEFT JOIN public.services s ON s.id = x.id;
$$;

-- The caller's relation to a booking's report: 'provider', 'customer', 'parent',
-- 'admin', or NULL. 'parent' is a linked parent (#419) of a self-booking student.
CREATE OR REPLACE FUNCTION public.lesson_report_viewer_role(p_booking_id uuid, p_uid uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_uid IS NULL THEN NULL
    WHEN EXISTS (
      SELECT 1 FROM public.providers p WHERE p.id = b.provider_id AND p.profile_id = p_uid
    ) THEN 'provider'
    WHEN b.customer_id = p_uid THEN 'customer'
    WHEN b.family_member_id IS NULL AND EXISTS (
      SELECT 1 FROM public.student_parent_links l
      WHERE l.parent_id = p_uid
        AND l.student_id = b.customer_id
        AND l.status = 'linked'
        AND l.decided_at IS NOT NULL
    ) THEN 'parent'
    WHEN public.has_role(p_uid, 'admin') THEN 'admin'
    ELSE NULL
  END
  FROM public.bookings b
  WHERE b.id = p_booking_id AND b.deleted_at IS NULL;
$$;

-- First name for notification copy.
CREATE OR REPLACE FUNCTION public.lesson_report_first_name(p_full_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT nullif(split_part(btrim(coalesce(p_full_name, '')), ' ', 1), '');
$$;

-- Report JSON shared by get_lesson_report and learner_progress.
CREATE OR REPLACE FUNCTION public.lesson_report_json(p_report_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', r.id,
    'booking_id', r.booking_id,
    'kind', r.report_kind,
    'covered', r.covered,
    'homework', r.homework,
    'understanding', r.understanding,
    'music_instrument', r.music_instrument,
    'music_level', r.music_level,
    'music_piece', r.music_piece,
    'created_at', r.created_at,
    'updated_at', r.updated_at,
    'quran', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'kind', e.entry_kind,
        'from_surah', e.from_surah,
        'from_surah_name_ar', fs.name_ar,
        'from_surah_name_en', fs.name_en,
        'from_ayah', e.from_ayah,
        'to_surah', e.to_surah,
        'to_surah_name_ar', ts.name_ar,
        'to_surah_name_en', ts.name_en,
        'to_ayah', e.to_ayah
      ) ORDER BY e.position)
      FROM public.lesson_report_quran_entries e
      JOIN public.quran_surahs fs ON fs.number = e.from_surah
      JOIN public.quran_surahs ts ON ts.number = e.to_surah
      WHERE e.report_id = r.id
    ), '[]'::jsonb)
  )
  FROM public.lesson_reports r
  WHERE r.id = p_report_id;
$$;

REVOKE ALL ON FUNCTION public.lesson_report_kind(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lesson_report_viewer_role(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lesson_report_first_name(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lesson_report_json(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Tutor writes the report
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_lesson_report(
  p_booking_id uuid,
  p_covered text,
  p_understanding text,
  p_homework text DEFAULT NULL,
  p_quran jsonb DEFAULT '[]'::jsonb,
  p_music_instrument text DEFAULT NULL,
  p_music_level text DEFAULT NULL,
  p_music_piece text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_b public.bookings%ROWTYPE;
  v_kind text;
  v_existing public.lesson_reports%ROWTYPE;
  v_first boolean;
  v_report_id uuid;
  v_covered text := nullif(btrim(coalesce(p_covered, '')), '');
  v_homework text := nullif(btrim(coalesce(p_homework, '')), '');
  v_instrument text;
  v_level text;
  v_piece text;
  v_entries jsonb := coalesce(p_quran, '[]'::jsonb);
  v_entry jsonb;
  v_pos integer := 0;
  v_kind_entry text;
  v_fs integer;
  v_fa integer;
  v_ts integer;
  v_ta integer;
  v_fs_count integer;
  v_ts_count integer;
  v_learner text;
  v_is_child boolean;
  v_link text;
  v_parent record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'LESSON_REPORT_AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_b FROM public.bookings WHERE id = p_booking_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'LESSON_REPORT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.providers p WHERE p.id = v_b.provider_id AND p.profile_id = v_uid
  ) THEN
    RAISE EXCEPTION 'LESSON_REPORT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  -- An online lesson the attendance check found nobody (or one side) attended has no report.
  IF v_b.status::text NOT IN ('completed', 'completion_requested')
     OR coalesce(v_b.online_session_outcome, '') IN ('provider_absent', 'customer_absent', 'both_absent') THEN
    RAISE EXCEPTION 'LESSON_REPORT_NOT_COMPLETED' USING ERRCODE = '22023';
  END IF;

  v_kind := public.lesson_report_kind(v_b.service_id, v_b.teaching_subject_code);
  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'LESSON_REPORT_NOT_TEACHING' USING ERRCODE = '22023';
  END IF;

  IF v_covered IS NULL OR char_length(v_covered) < 2 OR char_length(v_covered) > 600 THEN
    RAISE EXCEPTION 'LESSON_REPORT_COVERED_INVALID' USING ERRCODE = '22023';
  END IF;
  IF v_homework IS NOT NULL AND char_length(v_homework) > 600 THEN
    RAISE EXCEPTION 'LESSON_REPORT_HOMEWORK_INVALID' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_understanding, '') NOT IN ('needs_support', 'good', 'excellent') THEN
    RAISE EXCEPTION 'LESSON_REPORT_UNDERSTANDING_INVALID' USING ERRCODE = '22023';
  END IF;

  IF v_kind = 'music' THEN
    v_instrument := coalesce(
      nullif(btrim(coalesce(p_music_instrument, '')), ''),
      CASE WHEN v_b.teaching_subject_code LIKE 'music\_%'
        THEN substr(v_b.teaching_subject_code, 7) END
    );
    v_level := nullif(btrim(coalesce(p_music_level, '')), '');
    v_piece := nullif(btrim(coalesce(p_music_piece, '')), '');
    IF v_instrument IS NULL
       OR v_instrument NOT IN ('guitar', 'oud', 'piano_keyboard', 'violin', 'other') THEN
      RAISE EXCEPTION 'LESSON_REPORT_MUSIC_INSTRUMENT_INVALID' USING ERRCODE = '22023';
    END IF;
    IF v_level IS NULL OR v_level NOT IN ('beginner', 'intermediate', 'advanced') THEN
      RAISE EXCEPTION 'LESSON_REPORT_MUSIC_LEVEL_INVALID' USING ERRCODE = '22023';
    END IF;
    IF v_piece IS NOT NULL AND char_length(v_piece) > 200 THEN
      RAISE EXCEPTION 'LESSON_REPORT_MUSIC_PIECE_INVALID' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF jsonb_typeof(v_entries) <> 'array' THEN
    RAISE EXCEPTION 'LESSON_REPORT_QURAN_INVALID' USING ERRCODE = '22023';
  END IF;
  IF v_kind = 'quran' THEN
    IF jsonb_array_length(v_entries) < 1 OR jsonb_array_length(v_entries) > 4 THEN
      RAISE EXCEPTION 'LESSON_REPORT_QURAN_REQUIRED' USING ERRCODE = '22023';
    END IF;
  ELSIF jsonb_array_length(v_entries) > 0 THEN
    RAISE EXCEPTION 'LESSON_REPORT_QURAN_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing FROM public.lesson_reports WHERE booking_id = v_b.id FOR UPDATE;
  v_first := NOT FOUND;
  IF NOT v_first AND v_existing.created_at < now() - interval '7 days' THEN
    RAISE EXCEPTION 'LESSON_REPORT_EDIT_WINDOW_CLOSED' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.lesson_reports AS r (
    booking_id, report_kind, covered, homework, understanding,
    music_instrument, music_level, music_piece, created_by
  ) VALUES (
    v_b.id, v_kind, v_covered, v_homework, p_understanding,
    v_instrument, v_level, v_piece, v_uid
  )
  ON CONFLICT (booking_id) DO UPDATE SET
    report_kind = EXCLUDED.report_kind,
    covered = EXCLUDED.covered,
    homework = EXCLUDED.homework,
    understanding = EXCLUDED.understanding,
    music_instrument = EXCLUDED.music_instrument,
    music_level = EXCLUDED.music_level,
    music_piece = EXCLUDED.music_piece,
    updated_at = now()
  RETURNING r.id INTO v_report_id;

  DELETE FROM public.lesson_report_quran_entries WHERE report_id = v_report_id;

  IF v_kind = 'quran' THEN
    FOR v_entry IN SELECT value FROM jsonb_array_elements(v_entries)
    LOOP
      v_pos := v_pos + 1;
      IF jsonb_typeof(v_entry) <> 'object' THEN
        RAISE EXCEPTION 'LESSON_REPORT_QURAN_INVALID' USING ERRCODE = '22023';
      END IF;
      v_kind_entry := v_entry ->> 'kind';
      IF coalesce(v_kind_entry, '') NOT IN ('new', 'review', 'tajweed') THEN
        RAISE EXCEPTION 'LESSON_REPORT_QURAN_INVALID' USING ERRCODE = '22023';
      END IF;
      BEGIN
        v_fs := (v_entry ->> 'from_surah')::integer;
        v_fa := (v_entry ->> 'from_ayah')::integer;
        v_ts := (v_entry ->> 'to_surah')::integer;
        v_ta := (v_entry ->> 'to_ayah')::integer;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'LESSON_REPORT_QURAN_INVALID' USING ERRCODE = '22023';
      END;
      SELECT ayah_count INTO v_fs_count FROM public.quran_surahs WHERE number = v_fs;
      SELECT ayah_count INTO v_ts_count FROM public.quran_surahs WHERE number = v_ts;
      IF v_fs_count IS NULL OR v_ts_count IS NULL
         OR v_fa IS NULL OR v_ta IS NULL
         OR v_fa < 1 OR v_fa > v_fs_count
         OR v_ta < 1 OR v_ta > v_ts_count
         OR NOT (v_fs < v_ts OR (v_fs = v_ts AND v_fa <= v_ta)) THEN
        RAISE EXCEPTION 'LESSON_REPORT_QURAN_RANGE_INVALID' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.lesson_report_quran_entries (
        report_id, position, entry_kind, from_surah, from_ayah, to_surah, to_ayah
      ) VALUES (v_report_id, v_pos, v_kind_entry, v_fs, v_fa, v_ts, v_ta);
    END LOOP;
  END IF;

  DELETE FROM public.lesson_report_reminders WHERE booking_id = v_b.id;

  IF v_first THEN
    v_is_child := v_b.family_member_id IS NOT NULL;
    IF v_is_child THEN
      SELECT public.lesson_report_first_name(fm.full_name) INTO v_learner
      FROM public.family_members fm WHERE fm.id = v_b.family_member_id;
    ELSE
      SELECT public.lesson_report_first_name(pr.full_name) INTO v_learner
      FROM public.profiles pr WHERE pr.id = v_b.customer_id;
    END IF;

    v_link := CASE WHEN v_b.service_mode = 'online'
      THEN '/online/lessons/' || v_b.id::text
      ELSE '/booking/' || v_b.id::text END;

    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar,
      payload, deep_link, booking_id
    ) VALUES (
      v_b.customer_id,
      'lesson_report_ready',
      'booking',
      CASE WHEN v_is_child AND v_learner IS NOT NULL
        THEN v_learner || '''s lesson report is here' ELSE 'Your lesson report is here' END,
      'See what the tutor covered and the homework.',
      CASE WHEN v_is_child AND v_learner IS NOT NULL
        THEN v_learner || '''s lesson report is here' ELSE 'Your lesson report is here' END,
      CASE WHEN v_is_child AND v_learner IS NOT NULL
        THEN 'تقرير حصة ' || v_learner || ' وصل' ELSE 'تقرير حصتك وصل' END,
      'See what the tutor covered and the homework.',
      'شوف المدرس كتب إيه عن الحصة والواجب.',
      jsonb_build_object('booking_id', v_b.id, 'report_id', v_report_id),
      v_link,
      v_b.id
    );

    -- A self-booking student's linked parent (#419) gets the same news.
    IF NOT v_is_child THEN
      FOR v_parent IN
        SELECT DISTINCT l.parent_id
        FROM public.student_parent_links l
        WHERE l.student_id = v_b.customer_id
          AND l.status = 'linked'
          AND l.decided_at IS NOT NULL
          AND l.parent_id IS NOT NULL
      LOOP
        INSERT INTO public.notifications (
          user_id, type, category, title, body, title_en, title_ar, body_en, body_ar,
          payload, deep_link, booking_id
        ) VALUES (
          v_parent.parent_id,
          'lesson_report_ready_parent',
          'booking',
          coalesce(v_learner, 'Your child') || '''s lesson report is here',
          'See what the tutor covered and the homework.',
          coalesce(v_learner, 'Your child') || '''s lesson report is here',
          'تقرير حصة ' || coalesce(v_learner, 'ابنك') || ' وصل',
          'See what the tutor covered and the homework.',
          'شوف المدرس كتب إيه عن الحصة والواجب.',
          jsonb_build_object('booking_id', v_b.id, 'report_id', v_report_id, 'student_id', v_b.customer_id),
          '/account/students/' || v_b.customer_id::text,
          NULL
        );
      END LOOP;
    END IF;
  END IF;

  RETURN v_report_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_lesson_report(uuid, text, text, text, jsonb, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_lesson_report(uuid, text, text, text, jsonb, text, text, text)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Read one booking's report (tutor, customer, linked parent, admin)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_lesson_report(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_b public.bookings%ROWTYPE;
  v_kind text;
  v_report public.lesson_reports%ROWTYPE;
  v_has_report boolean;
  v_learner text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'LESSON_REPORT_AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;
  v_role := public.lesson_report_viewer_role(p_booking_id, v_uid);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'LESSON_REPORT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_b FROM public.bookings WHERE id = p_booking_id;
  v_kind := public.lesson_report_kind(v_b.service_id, v_b.teaching_subject_code);
  SELECT * INTO v_report FROM public.lesson_reports WHERE booking_id = p_booking_id;
  v_has_report := FOUND;

  IF v_b.family_member_id IS NOT NULL THEN
    SELECT fm.full_name INTO v_learner FROM public.family_members fm WHERE fm.id = v_b.family_member_id;
  ELSE
    SELECT pr.full_name INTO v_learner FROM public.profiles pr WHERE pr.id = v_b.customer_id;
  END IF;

  RETURN jsonb_build_object(
    'eligible', v_kind IS NOT NULL,
    'kind', v_kind,
    'viewer_role', v_role,
    'status', v_b.status::text,
    'subject_code', v_b.teaching_subject_code,
    'learner_name', public.lesson_report_first_name(v_learner),
    'learner_id', coalesce(v_b.family_member_id, v_b.customer_id),
    'learner_is_child', v_b.family_member_id IS NOT NULL,
    'can_write', v_role = 'provider'
      AND v_kind IS NOT NULL
      AND v_b.status::text IN ('completed', 'completion_requested')
      AND coalesce(v_b.online_session_outcome, '') NOT IN ('provider_absent', 'customer_absent', 'both_absent')
      AND (NOT v_has_report OR v_report.created_at >= now() - interval '7 days'),
    'report', CASE WHEN v_has_report THEN public.lesson_report_json(v_report.id) ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_lesson_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_lesson_report(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Learner progress: all reports for one learner + Quran and music progress
--    p_learner_id NULL = the caller; a family member of the caller; a linked
--    student of the caller (#419); admins may read any learner.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.learner_progress(p_learner_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_mode text;
  v_customer uuid;
  v_member uuid;
  v_name text;
  v_reports jsonb;
  v_surahs jsonb;
  v_juz jsonb;
  v_total integer;
  v_music jsonb;
  v_ids uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'LESSON_REPORT_AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF p_learner_id IS NULL OR p_learner_id = v_uid THEN
    v_mode := 'self';
    v_customer := v_uid;
  ELSIF EXISTS (
    SELECT 1 FROM public.family_members fm WHERE fm.id = p_learner_id AND fm.customer_id = v_uid
  ) THEN
    v_mode := 'child';
    v_customer := v_uid;
    v_member := p_learner_id;
  ELSIF EXISTS (
    SELECT 1 FROM public.student_parent_links l
    WHERE l.parent_id = v_uid
      AND l.student_id = p_learner_id
      AND l.status = 'linked'
      AND l.decided_at IS NOT NULL
  ) THEN
    v_mode := 'student';
    v_customer := p_learner_id;
  ELSIF public.has_role(v_uid, 'admin') THEN
    SELECT fm.customer_id INTO v_customer FROM public.family_members fm WHERE fm.id = p_learner_id;
    IF FOUND THEN
      v_mode := 'child';
      v_member := p_learner_id;
    ELSE
      v_mode := 'student';
      v_customer := p_learner_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'LESSON_REPORT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF v_member IS NOT NULL THEN
    SELECT fm.full_name INTO v_name FROM public.family_members fm WHERE fm.id = v_member;
  ELSE
    SELECT pr.full_name INTO v_name FROM public.profiles pr WHERE pr.id = v_customer;
  END IF;

  SELECT coalesce(array_agg(t.id ORDER BY t.start_at DESC), ARRAY[]::uuid[])
  INTO v_ids
  FROM (
    SELECT r.id, b.start_at
    FROM public.lesson_reports r
    JOIN public.bookings b ON b.id = r.booking_id
    WHERE b.deleted_at IS NULL
      AND b.customer_id = v_customer
      AND (
        (v_member IS NOT NULL AND b.family_member_id = v_member)
        OR (v_member IS NULL AND b.family_member_id IS NULL)
      )
    ORDER BY b.start_at DESC
    LIMIT 200
  ) t;

  SELECT coalesce(jsonb_agg(
    public.lesson_report_json(x.id) || jsonb_build_object(
      'start_at', b.start_at,
      'service_mode', b.service_mode,
      'subject_code', b.teaching_subject_code,
      'subject_name_ar', b.teaching_subject_name_ar,
      'subject_name_en', b.teaching_subject_name_en,
      'tutor_name', tp.full_name
    ) ORDER BY b.start_at DESC
  ), '[]'::jsonb)
  INTO v_reports
  FROM public.lesson_reports x
  JOIN public.bookings b ON b.id = x.booking_id
  LEFT JOIN public.providers p ON p.id = b.provider_id
  LEFT JOIN public.profiles tp ON tp.id = p.profile_id
  WHERE x.id = ANY (v_ids);

  -- Quran: expand every range to ayahs. 'new' = memorized; 'review'/'tajweed' = reviewed.
  WITH ent AS (
    SELECT e.*
    FROM public.lesson_report_quran_entries e
    WHERE e.report_id = ANY (v_ids)
  ),
  ayahs AS (
    SELECT DISTINCT e.entry_kind = 'new' AS memorized, s.number AS surah, gs.ayah
    FROM ent e
    JOIN public.quran_surahs s ON s.number BETWEEN e.from_surah AND e.to_surah
    CROSS JOIN LATERAL generate_series(
      CASE WHEN s.number = e.from_surah THEN e.from_ayah ELSE 1 END::integer,
      CASE WHEN s.number = e.to_surah THEN e.to_ayah ELSE s.ayah_count END::integer
    ) AS gs(ayah)
  ),
  per_surah AS (
    SELECT surah,
      count(DISTINCT ayah) FILTER (WHERE memorized) AS memorized_ayahs,
      count(DISTINCT ayah) FILTER (WHERE NOT memorized) AS reviewed_ayahs
    FROM ayahs GROUP BY surah
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'number', s.number,
      'name_ar', s.name_ar,
      'name_en', s.name_en,
      'ayah_count', s.ayah_count,
      'memorized_ayahs', ps.memorized_ayahs,
      'reviewed_ayahs', ps.reviewed_ayahs
    ) ORDER BY s.number), '[]'::jsonb),
    coalesce(sum(ps.memorized_ayahs), 0)::integer
  INTO v_surahs, v_total
  FROM per_surah ps
  JOIN public.quran_surahs s ON s.number = ps.surah;

  WITH offs AS (
    SELECT number, ayah_count,
      (sum(ayah_count) OVER (ORDER BY number) - ayah_count)::integer AS before
    FROM public.quran_surahs
  ),
  bounds AS (
    SELECT j.juz, o.before + j.start_ayah AS g_start
    FROM public.quran_juz j JOIN offs o ON o.number = j.start_surah
  ),
  juz AS (
    SELECT juz, g_start,
      coalesce(lead(g_start) OVER (ORDER BY juz) - 1,
               (SELECT sum(ayah_count)::integer FROM public.quran_surahs)) AS g_end
    FROM bounds
  ),
  mem AS (
    SELECT DISTINCT o.before + gs.ayah AS g
    FROM public.lesson_report_quran_entries e
    JOIN offs o ON o.number BETWEEN e.from_surah AND e.to_surah
    CROSS JOIN LATERAL generate_series(
      CASE WHEN o.number = e.from_surah THEN e.from_ayah ELSE 1 END::integer,
      CASE WHEN o.number = e.to_surah THEN e.to_ayah ELSE o.ayah_count END::integer
    ) AS gs(ayah)
    WHERE e.report_id = ANY (v_ids) AND e.entry_kind = 'new'
  )
  SELECT jsonb_agg(jsonb_build_object(
    'juz', j.juz,
    'total_ayahs', j.g_end - j.g_start + 1,
    'memorized_ayahs', (SELECT count(*) FROM mem m WHERE m.g BETWEEN j.g_start AND j.g_end)
  ) ORDER BY j.juz)
  INTO v_juz
  FROM juz j;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'booking_id', r.booking_id,
      'start_at', b.start_at,
      'instrument', r.music_instrument,
      'level', r.music_level,
      'piece', r.music_piece
    ) ORDER BY b.start_at), '[]'::jsonb)
  INTO v_music
  FROM public.lesson_reports r
  JOIN public.bookings b ON b.id = r.booking_id
  WHERE r.id = ANY (v_ids) AND r.report_kind = 'music';

  RETURN jsonb_build_object(
    'learner', jsonb_build_object(
      'id', coalesce(v_member, v_customer),
      'mode', v_mode,
      'name', v_name
    ),
    'reports', v_reports,
    'quran', jsonb_build_object(
      'has_data', EXISTS (
        SELECT 1 FROM public.lesson_reports r WHERE r.id = ANY (v_ids) AND r.report_kind = 'quran'
      ),
      'total_ayahs', (SELECT sum(ayah_count)::integer FROM public.quran_surahs),
      'memorized_ayahs', v_total,
      'surahs', v_surahs,
      'juz', coalesce(v_juz, '[]'::jsonb)
    ),
    'music', v_music
  );
END;
$$;

REVOKE ALL ON FUNCTION public.learner_progress(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.learner_progress(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Reminders: the tutor is reminded until the report is written
--    (1 hour after the lesson, then every 24 hours, at most 3 times, for 7 days).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_lesson_report_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_count integer := 0;
  v_link text;
BEGIN
  FOR v_row IN
    SELECT b.id, b.service_mode, p.profile_id,
      CASE WHEN b.family_member_id IS NOT NULL THEN fm.full_name ELSE cp.full_name END AS learner
    FROM public.bookings b
    JOIN public.providers p ON p.id = b.provider_id
    LEFT JOIN public.family_members fm ON fm.id = b.family_member_id
    LEFT JOIN public.profiles cp ON cp.id = b.customer_id
    LEFT JOIN public.lesson_report_reminders rr ON rr.booking_id = b.id
    WHERE b.deleted_at IS NULL
      AND b.status::text IN ('completed', 'completion_requested')
      AND coalesce(b.online_session_outcome, '') NOT IN ('provider_absent', 'customer_absent', 'both_absent')
      AND coalesce(b.session_ended_at, b.completed_at, b.end_at) <= now() - interval '1 hour'
      AND coalesce(b.session_ended_at, b.completed_at, b.end_at) >= now() - interval '7 days'
      AND public.lesson_report_kind(b.service_id, b.teaching_subject_code) IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.lesson_reports r WHERE r.booking_id = b.id)
      AND (rr.booking_id IS NULL OR (rr.sent_count < 3 AND rr.last_sent_at <= now() - interval '24 hours'))
    ORDER BY b.end_at
    LIMIT 200
  LOOP
    v_link := CASE WHEN v_row.service_mode = 'online'
      THEN '/online/lessons/' || v_row.id::text
      ELSE '/pro/booking/' || v_row.id::text END;

    INSERT INTO public.notifications (
      user_id, type, category, title, body, title_en, title_ar, body_en, body_ar,
      payload, deep_link, booking_id
    ) VALUES (
      v_row.profile_id,
      'lesson_report_reminder',
      'booking',
      'Write the lesson report',
      'The family is waiting for what you covered and the homework.',
      'Write the lesson report',
      'اكتب تقرير حصة ' || coalesce(public.lesson_report_first_name(v_row.learner), 'الطالب'),
      'The family is waiting for what you covered and the homework.',
      'الأهل مستنيين تعرفهم اتعلمتوا إيه والواجب.',
      jsonb_build_object('booking_id', v_row.id),
      v_link,
      v_row.id
    );

    INSERT INTO public.lesson_report_reminders (booking_id, sent_count, last_sent_at)
    VALUES (v_row.id, 1, now())
    ON CONFLICT (booking_id) DO UPDATE SET
      sent_count = public.lesson_report_reminders.sent_count + 1,
      last_sent_at = now();

    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.process_lesson_report_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_lesson_report_reminders() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'famy-lesson-report-reminders') THEN
      PERFORM cron.unschedule('famy-lesson-report-reminders');
    END IF;
    PERFORM cron.schedule(
      'famy-lesson-report-reminders',
      '17 * * * *',
      'SELECT public.process_lesson_report_reminders();'
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron scheduling skipped (%); run process_lesson_report_reminders() hourly externally.', SQLERRM;
END
$$;

NOTIFY pgrst, 'reload schema';
