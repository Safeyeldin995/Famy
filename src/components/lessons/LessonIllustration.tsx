import type { LessonIllustrationKey } from "@/lib/tutoring/lessonIllustrations";
import {
  LESSON_BRAND,
  LESSON_BRAND_TINT,
  LESSON_BRAND_TINT_STRONG,
  lessonIllustrationKeyForService,
  lessonIllustrationKeyForSubject,
} from "@/lib/tutoring/lessonIllustrations";

type Props = {
  className?: string;
  /** Accessible name; decorative when omitted with aria-hidden. */
  label?: string;
  illustrationKey?: LessonIllustrationKey | null;
  subjectCode?: string | null;
  serviceSlug?: string | null;
};

export function LessonIllustration({
  className = "h-12 w-12",
  label,
  illustrationKey,
  subjectCode,
  serviceSlug,
}: Props) {
  const key =
    illustrationKey ??
    lessonIllustrationKeyForSubject(subjectCode) ??
    lessonIllustrationKeyForService(serviceSlug);
  if (!key) return null;

  const aria = label ? { role: "img" as const, "aria-label": label } : { "aria-hidden": true };

  return (
    <svg viewBox="0 0 64 64" className={className} {...aria}>
      <LessonArt keyId={key} />
    </svg>
  );
}

function LessonArt({ keyId }: { keyId: LessonIllustrationKey }) {
  switch (keyId) {
    case "quran_lessons_tile":
    case "quran_memorization":
      return <QuranMushafRehal />;
    case "quran_tajweed":
      return <QuranMushafSound />;
    case "quran_recitation_review":
      return <QuranMushafBookmark />;
    case "music_lessons_tile":
      return <MusicGeneric />;
    case "music_piano_keyboard":
      return <MusicPiano />;
    case "music_guitar":
      return <MusicGuitar />;
    case "music_oud":
      return <MusicOud />;
    case "music_violin":
      return <MusicViolin />;
    default:
      return null;
  }
}

function QuranMushafRehal() {
  return (
    <>
      <rect width="64" height="64" rx="16" fill={LESSON_BRAND_TINT} />
      <path d="M18 46 L32 38 L46 46 V52 H18 Z" fill={LESSON_BRAND_TINT_STRONG} />
      <path d="M24 46 L32 42 L40 46" stroke={LESSON_BRAND} strokeWidth="2" fill="none" />
      <rect x="20" y="18" width="24" height="22" rx="4" fill="#fff" />
      <rect x="31" y="18" width="2" height="22" fill={LESSON_BRAND_TINT_STRONG} />
      <path
        d="M24 24 H30 M24 28 H30 M36 24 H42 M36 28 H40"
        stroke={LESSON_BRAND}
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.55"
      />
    </>
  );
}

function QuranMushafSound() {
  return (
    <>
      <rect width="64" height="64" rx="16" fill={LESSON_BRAND_TINT} />
      <rect x="16" y="20" width="26" height="28" rx="5" fill="#fff" />
      <rect x="28" y="20" width="2" height="28" fill={LESSON_BRAND_TINT_STRONG} />
      <path
        d="M20 26 H24 M20 30 H24 M32 26 H36 M32 30 H34"
        stroke={LESSON_BRAND}
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.5"
      />
      <path
        d="M46 26 C52 26 52 32 46 32 M46 32 C52 32 52 38 46 38 M46 38 C52 38 52 44 46 44"
        stroke={LESSON_BRAND}
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="44" cy="44" r="3" fill={LESSON_BRAND} />
    </>
  );
}

function QuranMushafBookmark() {
  return (
    <>
      <rect width="64" height="64" rx="16" fill={LESSON_BRAND_TINT} />
      <rect x="18" y="18" width="28" height="32" rx="5" fill="#fff" />
      <rect x="31" y="18" width="2" height="32" fill={LESSON_BRAND_TINT_STRONG} />
      <path d="M38 18 V34 L42 31 L46 34 V18 Z" fill={LESSON_BRAND} />
      <path
        d="M22 26 H28 M22 30 H28 M34 26 H40 M34 30 H38"
        stroke={LESSON_BRAND}
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.45"
      />
    </>
  );
}

function MusicGeneric() {
  return (
    <>
      <rect width="64" height="64" rx="16" fill={LESSON_BRAND_TINT} />
      <ellipse cx="26" cy="42" rx="10" ry="8" fill={LESSON_BRAND_TINT_STRONG} />
      <rect x="24" y="18" width="4" height="26" rx="2" fill={LESSON_BRAND} />
      <path
        d="M28 22 C36 20 40 24 40 30 C40 36 34 38 28 36"
        stroke={LESSON_BRAND}
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="40" cy="30" r="4" fill={LESSON_BRAND} />
      <circle cx="46" cy="24" r="3" fill={LESSON_BRAND} opacity="0.7" />
    </>
  );
}

function MusicPiano() {
  return (
    <>
      <rect width="64" height="64" rx="16" fill={LESSON_BRAND_TINT} />
      <rect x="12" y="28" width="40" height="18" rx="5" fill="#fff" />
      <rect x="14" y="30" width="5" height="14" rx="1" fill={LESSON_BRAND_TINT_STRONG} />
      <rect x="21" y="30" width="5" height="14" rx="1" fill={LESSON_BRAND_TINT_STRONG} />
      <rect x="28" y="30" width="5" height="14" rx="1" fill={LESSON_BRAND_TINT_STRONG} />
      <rect x="35" y="30" width="5" height="14" rx="1" fill={LESSON_BRAND_TINT_STRONG} />
      <rect x="42" y="30" width="5" height="14" rx="1" fill={LESSON_BRAND_TINT_STRONG} />
      <rect x="18" y="30" width="3" height="9" rx="1" fill={LESSON_BRAND} />
      <rect x="25" y="30" width="3" height="9" rx="1" fill={LESSON_BRAND} />
      <rect x="39" y="30" width="3" height="9" rx="1" fill={LESSON_BRAND} />
    </>
  );
}

function MusicGuitar() {
  return (
    <>
      <rect width="64" height="64" rx="16" fill={LESSON_BRAND_TINT} />
      <ellipse cx="28" cy="40" rx="14" ry="11" fill={LESSON_BRAND_TINT_STRONG} />
      <circle cx="28" cy="40" r="5" fill="#fff" />
      <rect x="36" y="16" width="5" height="30" rx="2.5" fill={LESSON_BRAND} />
      <rect x="34" y="14" width="9" height="5" rx="2" fill={LESSON_BRAND_TINT_STRONG} />
    </>
  );
}

function MusicOud() {
  return (
    <>
      <rect width="64" height="64" rx="16" fill={LESSON_BRAND_TINT} />
      <ellipse cx="30" cy="42" rx="16" ry="12" fill={LESSON_BRAND_TINT_STRONG} />
      <circle cx="30" cy="42" r="4" fill="#fff" />
      <rect x="38" y="20" width="4" height="24" rx="2" fill={LESSON_BRAND} />
      <rect x="36" y="16" width="8" height="6" rx="2" fill={LESSON_BRAND} opacity="0.85" />
    </>
  );
}

function MusicViolin() {
  return (
    <>
      <rect width="64" height="64" rx="16" fill={LESSON_BRAND_TINT} />
      <path
        d="M24 44 C24 36 28 32 32 28 C36 32 40 36 40 44 C36 48 28 48 24 44 Z"
        fill={LESSON_BRAND_TINT_STRONG}
      />
      <circle cx="32" cy="40" r="3" fill="#fff" />
      <rect x="31" y="14" width="2" height="18" rx="1" fill={LESSON_BRAND} />
      <path d="M28 16 H36" stroke={LESSON_BRAND} strokeWidth="2" strokeLinecap="round" />
    </>
  );
}
