/**
 * Lesson reports and learner progress (migration 20261128140000).
 * Shared by the website and the mobile apps (`@shared/lessonReports/lessonReports`).
 * Pure helpers plus client-agnostic RPC calls; each app wraps them in its own hooks.
 */

export type LessonReportKind = "tutoring" | "quran" | "music";
export type Understanding = "needs_support" | "good" | "excellent";
export type QuranEntryKind = "new" | "review" | "tajweed";
export type MusicInstrument = "guitar" | "oud" | "piano_keyboard" | "violin" | "other";
export type MusicLevel = "beginner" | "intermediate" | "advanced";
export type ViewerRole = "provider" | "customer" | "parent" | "admin";

export const UNDERSTANDING_VALUES: readonly Understanding[] = [
  "needs_support",
  "good",
  "excellent",
];
export const QURAN_ENTRY_KINDS: readonly QuranEntryKind[] = ["new", "review", "tajweed"];
export const MUSIC_INSTRUMENTS: readonly MusicInstrument[] = [
  "piano_keyboard",
  "guitar",
  "oud",
  "violin",
  "other",
];
export const MUSIC_LEVELS: readonly MusicLevel[] = ["beginner", "intermediate", "advanced"];

export const COVERED_MAX = 600;
export const HOMEWORK_MAX = 600;
export const PIECE_MAX = 200;
export const QURAN_ENTRIES_MAX = 4;
/** Days after the first submission during which the tutor can still edit. */
export const REPORT_EDIT_DAYS = 7;

export type QuranEntry = {
  kind: QuranEntryKind;
  from_surah: number;
  from_ayah: number;
  to_surah: number;
  to_ayah: number;
  from_surah_name_ar?: string;
  from_surah_name_en?: string;
  to_surah_name_ar?: string;
  to_surah_name_en?: string;
};

export type LessonReport = {
  id: string;
  booking_id: string;
  kind: LessonReportKind;
  covered: string;
  homework: string | null;
  understanding: Understanding;
  music_instrument: MusicInstrument | null;
  music_level: MusicLevel | null;
  music_piece: string | null;
  created_at: string;
  updated_at: string;
  quran: QuranEntry[];
};

export type LessonReportContext = {
  eligible: boolean;
  kind: LessonReportKind | null;
  viewer_role: ViewerRole;
  status: string;
  subject_code: string | null;
  learner_name: string | null;
  learner_id: string;
  learner_is_child: boolean;
  can_write: boolean;
  report: LessonReport | null;
};

export type ProgressReport = LessonReport & {
  start_at: string;
  service_mode: string | null;
  subject_code: string | null;
  subject_name_ar: string | null;
  subject_name_en: string | null;
  tutor_name: string | null;
};

export type SurahProgress = {
  number: number;
  name_ar: string;
  name_en: string;
  ayah_count: number;
  memorized_ayahs: number;
  reviewed_ayahs: number;
};

export type JuzProgress = { juz: number; total_ayahs: number; memorized_ayahs: number };

export type LearnerProgress = {
  learner: { id: string; mode: "self" | "child" | "student"; name: string | null };
  reports: ProgressReport[];
  quran: {
    has_data: boolean;
    total_ayahs: number;
    memorized_ayahs: number;
    surahs: SurahProgress[];
    juz: JuzProgress[];
  };
  music: {
    booking_id: string;
    start_at: string;
    instrument: MusicInstrument;
    level: MusicLevel;
    piece: string | null;
  }[];
};

export type Surah = { number: number; name_ar: string; name_en: string; ayah_count: number };
export type JuzStart = { juz: number; start_surah: number; start_ayah: number };

export type LessonReportDraft = {
  covered: string;
  homework: string;
  understanding: Understanding | null;
  quran: Pick<QuranEntry, "kind" | "from_surah" | "from_ayah" | "to_surah" | "to_ayah">[];
  musicInstrument: MusicInstrument | null;
  musicLevel: MusicLevel | null;
  musicPiece: string;
};

/** Instrument implied by the booking subject (`music_oud` → `oud`). */
export function instrumentFromSubject(
  subjectCode: string | null | undefined,
): MusicInstrument | null {
  if (!subjectCode?.startsWith("music_")) return null;
  const raw = subjectCode.slice("music_".length);
  return (MUSIC_INSTRUMENTS as readonly string[]).includes(raw) ? (raw as MusicInstrument) : null;
}

/** Quran entry kind implied by the booking subject, as the default first range. */
export function quranKindFromSubject(subjectCode: string | null | undefined): QuranEntryKind {
  if (subjectCode === "quran_recitation_review") return "review";
  if (subjectCode === "quran_tajweed") return "tajweed";
  return "new";
}

export function emptyDraft(
  kind: LessonReportKind,
  subjectCode: string | null,
  existing?: LessonReport | null,
): LessonReportDraft {
  if (existing) {
    return {
      covered: existing.covered,
      homework: existing.homework ?? "",
      understanding: existing.understanding,
      quran: existing.quran.map(({ kind: k, from_surah, from_ayah, to_surah, to_ayah }) => ({
        kind: k,
        from_surah,
        from_ayah,
        to_surah,
        to_ayah,
      })),
      musicInstrument: existing.music_instrument,
      musicLevel: existing.music_level,
      musicPiece: existing.music_piece ?? "",
    };
  }
  return {
    covered: "",
    homework: "",
    understanding: null,
    quran:
      kind === "quran"
        ? [
            {
              kind: quranKindFromSubject(subjectCode),
              from_surah: 1,
              from_ayah: 1,
              to_surah: 1,
              to_ayah: 7,
            },
          ]
        : [],
    musicInstrument: kind === "music" ? instrumentFromSubject(subjectCode) : null,
    musicLevel: null,
    musicPiece: "",
  };
}

export type DraftError =
  | "covered"
  | "homework"
  | "understanding"
  | "quranRequired"
  | "quranRange"
  | "musicInstrument"
  | "musicLevel"
  | "musicPiece";

/** Same rules as `submit_lesson_report`; returns the first problem for each field. */
export function validateDraft(
  kind: LessonReportKind,
  draft: LessonReportDraft,
  surahs: readonly Surah[],
): DraftError[] {
  const errors: DraftError[] = [];
  const covered = draft.covered.trim();
  if (covered.length < 2 || covered.length > COVERED_MAX) errors.push("covered");
  if (draft.homework.trim().length > HOMEWORK_MAX) errors.push("homework");
  if (!draft.understanding) errors.push("understanding");
  if (kind === "quran") {
    if (draft.quran.length < 1 || draft.quran.length > QURAN_ENTRIES_MAX)
      errors.push("quranRequired");
    else if (draft.quran.some((e) => !isValidRange(e, surahs))) errors.push("quranRange");
  }
  if (kind === "music") {
    if (!draft.musicInstrument) errors.push("musicInstrument");
    if (!draft.musicLevel) errors.push("musicLevel");
    if (draft.musicPiece.trim().length > PIECE_MAX) errors.push("musicPiece");
  }
  return errors;
}

export function isValidRange(
  e: Pick<QuranEntry, "from_surah" | "from_ayah" | "to_surah" | "to_ayah">,
  surahs: readonly Surah[],
): boolean {
  const from = surahs.find((s) => s.number === e.from_surah);
  const to = surahs.find((s) => s.number === e.to_surah);
  if (!from || !to) return false;
  if (!Number.isInteger(e.from_ayah) || !Number.isInteger(e.to_ayah)) return false;
  if (e.from_ayah < 1 || e.from_ayah > from.ayah_count) return false;
  if (e.to_ayah < 1 || e.to_ayah > to.ayah_count) return false;
  return e.from_surah < e.to_surah || (e.from_surah === e.to_surah && e.from_ayah <= e.to_ayah);
}

/** A whole juz as one range («جزء عم» = 78:1 → 114:6). */
export function juzRange(
  juz: number,
  juzStarts: readonly JuzStart[],
  surahs: readonly Surah[],
): Pick<QuranEntry, "from_surah" | "from_ayah" | "to_surah" | "to_ayah"> | null {
  const start = juzStarts.find((j) => j.juz === juz);
  if (!start) return null;
  const next = juzStarts.find((j) => j.juz === juz + 1);
  if (!next) {
    const last = surahs[surahs.length - 1];
    if (!last) return null;
    return {
      from_surah: start.start_surah,
      from_ayah: start.start_ayah,
      to_surah: last.number,
      to_ayah: last.ayah_count,
    };
  }
  if (next.start_ayah > 1) {
    return {
      from_surah: start.start_surah,
      from_ayah: start.start_ayah,
      to_surah: next.start_surah,
      to_ayah: next.start_ayah - 1,
    };
  }
  const prev = surahs.find((s) => s.number === next.start_surah - 1);
  if (!prev) return null;
  return {
    from_surah: start.start_surah,
    from_ayah: start.start_ayah,
    to_surah: prev.number,
    to_ayah: prev.ayah_count,
  };
}

/** A whole surah as one range. */
export function surahRange(surah: Surah) {
  return {
    from_surah: surah.number,
    from_ayah: 1,
    to_surah: surah.number,
    to_ayah: surah.ayah_count,
  };
}

/** «النبأ 1–40» or «النبأ 1 – الناس 6», in the reader's language. */
export function formatQuranRange(
  e: QuranEntry,
  lang: string,
  surahs?: readonly Surah[],
  formatNumber: (n: number) => string = String,
): string {
  const name = (n: number, ar?: string, en?: string) => {
    const s = surahs?.find((x) => x.number === n);
    return lang === "ar" ? (ar ?? s?.name_ar ?? String(n)) : (en ?? s?.name_en ?? String(n));
  };
  const from = name(e.from_surah, e.from_surah_name_ar, e.from_surah_name_en);
  if (e.from_surah === e.to_surah) {
    return `${from} ${formatNumber(e.from_ayah)}–${formatNumber(e.to_ayah)}`;
  }
  const to = name(e.to_surah, e.to_surah_name_ar, e.to_surah_name_en);
  return `${from} ${formatNumber(e.from_ayah)} – ${to} ${formatNumber(e.to_ayah)}`;
}

export function surahStatus(s: SurahProgress): "memorized" | "in_progress" | "reviewed" {
  if (s.memorized_ayahs >= s.ayah_count) return "memorized";
  if (s.memorized_ayahs > 0) return "in_progress";
  return "reviewed";
}

export function percent(part: number, whole: number): number {
  if (!whole || whole <= 0) return 0;
  const p = Math.floor((part / whole) * 100);
  return part > 0 && p === 0 ? 1 : Math.min(100, p);
}

/** The juz with any memorized ayah, in mushaf order. */
export function juzWithProgress(juz: readonly JuzProgress[]): JuzProgress[] {
  return juz.filter((j) => j.memorized_ayahs > 0);
}

/** Error code from the RPC → i18n key under `lessonReport.errors`. */
export function lessonReportErrorKey(error: unknown): string {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error ?? "");
  const known = [
    "LESSON_REPORT_NOT_COMPLETED",
    "LESSON_REPORT_NOT_TEACHING",
    "LESSON_REPORT_FORBIDDEN",
    "LESSON_REPORT_COVERED_INVALID",
    "LESSON_REPORT_HOMEWORK_INVALID",
    "LESSON_REPORT_UNDERSTANDING_INVALID",
    "LESSON_REPORT_QURAN_REQUIRED",
    "LESSON_REPORT_QURAN_RANGE_INVALID",
    "LESSON_REPORT_MUSIC_LEVEL_INVALID",
    "LESSON_REPORT_MUSIC_INSTRUMENT_INVALID",
    "LESSON_REPORT_EDIT_WINDOW_CLOSED",
  ] as const;
  const hit = known.find((code) => message.includes(code));
  return hit ? `lessonReport.errors.${hit}` : "lessonReport.errors.generic";
}

// ---------------------------------------------------------------------------
// RPC calls (any Supabase client; the generated types don't list these yet)
// ---------------------------------------------------------------------------

type RpcResult = PromiseLike<{ data: unknown; error: { message: string } | null }>;
type RpcClient = { rpc: (fn: string, args?: Record<string, unknown>) => RpcResult };
type FromClient = {
  from: (table: string) => {
    select: (cols: string) => {
      order: (col: string, opts: { ascending: boolean }) => RpcResult;
    };
  };
};

function asRpc(client: unknown): RpcClient {
  return client as RpcClient;
}

export async function fetchLessonReport(
  client: unknown,
  bookingId: string,
): Promise<LessonReportContext> {
  const { data, error } = await asRpc(client).rpc("get_lesson_report", { p_booking_id: bookingId });
  if (error) throw error;
  return data as LessonReportContext;
}

export async function fetchLearnerProgress(
  client: unknown,
  learnerId: string | null,
): Promise<LearnerProgress> {
  const { data, error } = await asRpc(client).rpc("learner_progress", { p_learner_id: learnerId });
  if (error) throw error;
  return data as LearnerProgress;
}

export async function submitLessonReport(
  client: unknown,
  bookingId: string,
  kind: LessonReportKind,
  draft: LessonReportDraft,
): Promise<string> {
  const { data, error } = await asRpc(client).rpc("submit_lesson_report", {
    p_booking_id: bookingId,
    p_covered: draft.covered.trim(),
    p_understanding: draft.understanding,
    p_homework: draft.homework.trim() || null,
    p_quran: kind === "quran" ? draft.quran : [],
    p_music_instrument: kind === "music" ? draft.musicInstrument : null,
    p_music_level: kind === "music" ? draft.musicLevel : null,
    p_music_piece: kind === "music" ? draft.musicPiece.trim() || null : null,
  });
  if (error) throw error;
  return data as string;
}

export async function fetchQuranCatalog(
  client: unknown,
): Promise<{ surahs: Surah[]; juz: JuzStart[] }> {
  const c = client as FromClient;
  const [s, j] = await Promise.all([
    c
      .from("quran_surahs")
      .select("number, name_ar, name_en, ayah_count")
      .order("number", { ascending: true }),
    c.from("quran_juz").select("juz, start_surah, start_ayah").order("juz", { ascending: true }),
  ]);
  if (s.error) throw s.error;
  if (j.error) throw j.error;
  return { surahs: (s.data ?? []) as Surah[], juz: (j.data ?? []) as JuzStart[] };
}

export const lessonReportQueryKeys = {
  report: (bookingId: string) => ["lesson-report", bookingId] as const,
  progress: (learnerId: string | null) => ["learner-progress", learnerId ?? "self"] as const,
  catalog: ["quran-catalog"] as const,
};
