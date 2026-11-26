/**
 * Pure helpers for the online web tutor directory, tutor profile and the
 * signed-in home: summarise a tutor's approved teaching capabilities, filter
 * by curriculum or track (Quran / music), sort, and pick the next lesson.
 * No data access here, so it is unit-tested directly.
 */

export type DirectoryCapability = {
  providerId: string;
  subjectCode: string;
  subjectNameAr: string;
  subjectNameEn: string;
  curriculumCode: string;
  curriculumNameAr: string;
  curriculumNameEn: string;
  levelCode: string;
  levelNameAr: string;
  levelNameEn: string;
  durationMin: number;
  price: number;
};

/** Tracks with no school curriculum, matched by subject code prefix. */
export type DirectoryTrack = "quran" | "music";

export const DIRECTORY_TRACKS: readonly DirectoryTrack[] = ["quran", "music"] as const;

/** Curriculum code used for subjects with no school curriculum. */
export const NO_CURRICULUM_CODE = "na";

/**
 * The active curricula as stored in `teaching_curricula` (same codes and names).
 * Signed-out visitors can't read that table, so the landing grid uses this list
 * for them and as a fallback while the live list loads or fails.
 */
export const ONLINE_CURRICULA_FALLBACK: readonly { code: string; name_ar: string; name_en: string }[] = [
  { code: "eg_national_ar", name_ar: "المنهج المصري (عربي)", name_en: "Egyptian National (Arabic)" },
  { code: "eg_national_lang", name_ar: "المنهج المصري (لغات / تجريبي)", name_en: "Egyptian National (Languages / Experimental)" },
  { code: "eg_azhar", name_ar: "المنهج الأزهري", name_en: "Egyptian Azhar" },
  { code: "british", name_ar: "البريطاني (IGCSE / A Level)", name_en: "British (IGCSE / A Level)" },
  { code: "american", name_ar: "الأمريكي (دبلومة)", name_en: "American (Diploma)" },
  { code: "ib", name_ar: "البكالوريا الدولية (IB)", name_en: "International Baccalaureate (IB)" },
  { code: "french", name_ar: "الفرنسي", name_en: "French" },
  { code: "german", name_ar: "الألماني", name_en: "German" },
];

export function capabilityTrack(subjectCode: string): DirectoryTrack | null {
  if (subjectCode.startsWith("quran_")) return "quran";
  if (subjectCode.startsWith("music_")) return "music";
  return null;
}

export type TutorTeachingSummary = {
  subjects: { code: string; nameAr: string; nameEn: string }[];
  curricula: { code: string; nameAr: string; nameEn: string }[];
  minPrice: number | null;
  durations: number[];
  tracks: DirectoryTrack[];
};

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

export function summarizeTutorTeaching(caps: DirectoryCapability[]): TutorTeachingSummary {
  const prices = caps.map((c) => Number(c.price)).filter((p) => Number.isFinite(p) && p > 0);
  return {
    subjects: uniqueBy(
      caps.map((c) => ({ code: c.subjectCode, nameAr: c.subjectNameAr, nameEn: c.subjectNameEn })),
      (s) => s.code,
    ),
    curricula: uniqueBy(
      caps
        .filter((c) => c.curriculumCode && c.curriculumCode !== NO_CURRICULUM_CODE)
        .map((c) => ({ code: c.curriculumCode, nameAr: c.curriculumNameAr, nameEn: c.curriculumNameEn })),
      (s) => s.code,
    ),
    minPrice: prices.length ? Math.min(...prices) : null,
    durations: [...new Set(caps.map((c) => c.durationMin).filter((d) => d > 0))].sort((a, b) => a - b),
    tracks: uniqueBy(
      caps.map((c) => capabilityTrack(c.subjectCode)).filter((t): t is DirectoryTrack => t !== null),
      (t) => t,
    ),
  };
}

export function groupCapabilitiesByProvider(
  caps: DirectoryCapability[],
): Map<string, DirectoryCapability[]> {
  const map = new Map<string, DirectoryCapability[]>();
  for (const cap of caps) {
    const list = map.get(cap.providerId) ?? [];
    list.push(cap);
    map.set(cap.providerId, list);
  }
  return map;
}

export type DirectoryFilter = {
  curriculum?: string | null;
  track?: DirectoryTrack | null;
};

/** A tutor matches when one approved capability fits every active filter. */
export function tutorMatchesFilter(caps: DirectoryCapability[], filter: DirectoryFilter): boolean {
  const curriculum = filter.curriculum?.trim() || null;
  const track = filter.track ?? null;
  if (!curriculum && !track) return true;
  return caps.some((c) => {
    if (curriculum && c.curriculumCode !== curriculum) return false;
    if (track && capabilityTrack(c.subjectCode) !== track) return false;
    return true;
  });
}

export type DirectorySort = "recommended" | "rating" | "priceLow";

export type DirectoryTutor = {
  id: string;
  rating: number;
  reviews: number;
  minPrice: number | null;
};

/**
 * "recommended" keeps the marketplace order. "rating" weighs the review count
 * so one 5-star review does not outrank many good ones. "priceLow" puts tutors
 * without a price last.
 */
export function sortDirectoryTutors<T extends DirectoryTutor>(list: T[], sort: DirectorySort): T[] {
  if (sort === "recommended") return [...list];
  const copy = [...list];
  if (sort === "rating") {
    return copy.sort((a, b) => {
      const sa = a.reviews > 0 ? a.rating : 0;
      const sb = b.reviews > 0 ? b.rating : 0;
      if (sb !== sa) return sb - sa;
      return b.reviews - a.reviews;
    });
  }
  return copy.sort((a, b) => {
    if (a.minPrice === null && b.minPrice === null) return 0;
    if (a.minPrice === null) return 1;
    if (b.minPrice === null) return -1;
    return a.minPrice - b.minPrice;
  });
}

/** Booking statuses that still lead to a lesson. */
export const ONLINE_UPCOMING_STATUSES = new Set([
  "pending",
  "confirmed",
  "on_the_way",
  "arrived",
  "arrival_confirmed",
  "in_progress",
  "completion_requested",
]);

export type HomeBooking = {
  id: string;
  status: string;
  start_at: string;
  end_at: string;
};

/** The next lesson: in progress first, then the earliest that has not ended. */
export function pickNextLesson<T extends HomeBooking>(bookings: T[], now = Date.now()): T | null {
  const live = bookings.filter(
    (b) => ONLINE_UPCOMING_STATUSES.has(b.status) && new Date(b.end_at).getTime() > now,
  );
  if (!live.length) return null;
  const inProgress = live.find((b) => b.status === "in_progress");
  if (inProgress) return inProgress;
  return live.sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())[0];
}

export type CountdownParts = { days: number; hours: number; minutes: number };

/** Whole time left until `target`, never negative. */
export function countdownParts(target: Date, now = Date.now()): CountdownParts {
  const ms = Math.max(0, target.getTime() - now);
  const totalMinutes = Math.floor(ms / 60_000);
  return {
    days: Math.floor(totalMinutes / 1440),
    hours: Math.floor((totalMinutes % 1440) / 60),
    minutes: totalMinutes % 60,
  };
}
