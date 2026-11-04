import Svg, { Circle, Ellipse, Path, Rect } from "react-native-svg";
import {
  LESSON_BRAND,
  LESSON_BRAND_TINT,
  LESSON_BRAND_TINT_STRONG,
  lessonIllustrationKeyForService,
  lessonIllustrationKeyForSubject,
  type LessonIllustrationKey,
} from "@shared/tutoring/lessonIllustrations";

type Props = {
  width?: number;
  height?: number;
  subjectCode?: string | null;
  serviceSlug?: string | null;
  illustrationKey?: LessonIllustrationKey | null;
  accessibilityLabel?: string;
};

export function LessonIllustration({
  width = 48,
  height = 48,
  subjectCode,
  serviceSlug,
  illustrationKey,
  accessibilityLabel,
}: Props) {
  const key =
    illustrationKey ??
    lessonIllustrationKeyForSubject(subjectCode) ??
    lessonIllustrationKeyForService(serviceSlug);
  if (!key) return null;

  return (
    <Svg
      width={width}
      height={height}
      viewBox="0 0 64 64"
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      <LessonArt keyId={key} />
    </Svg>
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
      <Rect width={64} height={64} rx={16} fill={LESSON_BRAND_TINT} />
      <Path d="M18 46 L32 38 L46 46 V52 H18 Z" fill={LESSON_BRAND_TINT_STRONG} />
      <Path d="M24 46 L32 42 L40 46" stroke={LESSON_BRAND} strokeWidth={2} fill="none" />
      <Rect x={20} y={18} width={24} height={22} rx={4} fill="#fff" />
      <Rect x={31} y={18} width={2} height={22} fill={LESSON_BRAND_TINT_STRONG} />
      <Path
        d="M24 24 H30 M24 28 H30 M36 24 H42 M36 28 H40"
        stroke={LESSON_BRAND}
        strokeWidth={2}
        strokeLinecap="round"
        opacity={0.55}
      />
    </>
  );
}

function QuranMushafSound() {
  return (
    <>
      <Rect width={64} height={64} rx={16} fill={LESSON_BRAND_TINT} />
      <Rect x={16} y={20} width={26} height={28} rx={5} fill="#fff" />
      <Rect x={28} y={20} width={2} height={28} fill={LESSON_BRAND_TINT_STRONG} />
      <Path
        d="M46 26 C52 26 52 32 46 32 M46 32 C52 32 52 38 46 38 M46 38 C52 38 52 44 46 44"
        stroke={LESSON_BRAND}
        strokeWidth={2.5}
        strokeLinecap="round"
        fill="none"
      />
      <Circle cx={44} cy={44} r={3} fill={LESSON_BRAND} />
    </>
  );
}

function QuranMushafBookmark() {
  return (
    <>
      <Rect width={64} height={64} rx={16} fill={LESSON_BRAND_TINT} />
      <Rect x={18} y={18} width={28} height={32} rx={5} fill="#fff" />
      <Rect x={31} y={18} width={2} height={32} fill={LESSON_BRAND_TINT_STRONG} />
      <Path d="M38 18 V34 L42 31 L46 34 V18 Z" fill={LESSON_BRAND} />
    </>
  );
}

function MusicGeneric() {
  return (
    <>
      <Rect width={64} height={64} rx={16} fill={LESSON_BRAND_TINT} />
      <Ellipse cx={26} cy={42} rx={10} ry={8} fill={LESSON_BRAND_TINT_STRONG} />
      <Rect x={24} y={18} width={4} height={26} rx={2} fill={LESSON_BRAND} />
      <Path
        d="M28 22 C36 20 40 24 40 30 C40 36 34 38 28 36"
        stroke={LESSON_BRAND}
        strokeWidth={3}
        fill="none"
        strokeLinecap="round"
      />
      <Circle cx={40} cy={30} r={4} fill={LESSON_BRAND} />
      <Circle cx={46} cy={24} r={3} fill={LESSON_BRAND} opacity={0.7} />
    </>
  );
}

function MusicPiano() {
  return (
    <>
      <Rect width={64} height={64} rx={16} fill={LESSON_BRAND_TINT} />
      <Rect x={12} y={28} width={40} height={18} rx={5} fill="#fff" />
      <Rect x={18} y={30} width={3} height={9} rx={1} fill={LESSON_BRAND} />
      <Rect x={25} y={30} width={3} height={9} rx={1} fill={LESSON_BRAND} />
      <Rect x={39} y={30} width={3} height={9} rx={1} fill={LESSON_BRAND} />
    </>
  );
}

function MusicGuitar() {
  return (
    <>
      <Rect width={64} height={64} rx={16} fill={LESSON_BRAND_TINT} />
      <Ellipse cx={28} cy={40} rx={14} ry={11} fill={LESSON_BRAND_TINT_STRONG} />
      <Circle cx={28} cy={40} r={5} fill="#fff" />
      <Rect x={36} y={16} width={5} height={30} rx={2.5} fill={LESSON_BRAND} />
    </>
  );
}

function MusicOud() {
  return (
    <>
      <Rect width={64} height={64} rx={16} fill={LESSON_BRAND_TINT} />
      <Ellipse cx={30} cy={42} rx={16} ry={12} fill={LESSON_BRAND_TINT_STRONG} />
      <Circle cx={30} cy={42} r={4} fill="#fff" />
      <Rect x={38} y={20} width={4} height={24} rx={2} fill={LESSON_BRAND} />
    </>
  );
}

function MusicViolin() {
  return (
    <>
      <Rect width={64} height={64} rx={16} fill={LESSON_BRAND_TINT} />
      <Path
        d="M24 44 C24 36 28 32 32 28 C36 32 40 36 40 44 C36 48 28 48 24 44 Z"
        fill={LESSON_BRAND_TINT_STRONG}
      />
      <Circle cx={32} cy={40} r={3} fill="#fff" />
      <Rect x={31} y={14} width={2} height={18} rx={1} fill={LESSON_BRAND} />
    </>
  );
}
