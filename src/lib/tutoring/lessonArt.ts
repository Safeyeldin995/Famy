import {
  LESSON_BRAND,
  LESSON_BRAND_TINT,
  LESSON_BRAND_TINT_STRONG,
  type LessonIllustrationKey,
} from "./lessonIllustrations";

/**
 * Lesson illustrations as data (64×64 viewBox), so web <svg> and mobile
 * react-native-svg draw the same art from one source.
 */
export type LessonArtColor = "brand" | "tint" | "strong" | "white";
export type LessonArtShape = {
  k: "rect" | "circle" | "ellipse" | "path" | "g";
  a: Record<string, string | number>;
  c?: LessonArtShape[];
};

const B = "brand";
const S = "strong";
const W = "white";

const bg: LessonArtShape = { k: "rect", a: { width: 64, height: 64, rx: 16, fill: "tint" } };

const openBook = (dx = 0, scale = 1): LessonArtShape => ({
  k: "g",
  a: { transform: `translate(${dx} 0) translate(32 24) scale(${scale}) translate(-32 -24)` },
  c: [
    {
      k: "path",
      a: {
        d: "M32 35 C26 31 19 31 12 34 L12 16 C19 13 26 13 32 17 Z",
        fill: W,
        stroke: S,
        strokeWidth: 1.5,
        strokeLinejoin: "round",
      },
    },
    {
      k: "path",
      a: {
        d: "M32 35 C38 31 45 31 52 34 L52 16 C45 13 38 13 32 17 Z",
        fill: W,
        stroke: S,
        strokeWidth: 1.5,
        strokeLinejoin: "round",
      },
    },
    {
      k: "path",
      a: {
        d: "M11 35.5 C18 32.5 26 32.5 32 36.5 C38 32.5 46 32.5 53 35.5",
        fill: "none",
        stroke: B,
        strokeWidth: 2.5,
        strokeLinecap: "round",
      },
    },
    { k: "path", a: { d: "M32 17 V35", stroke: S, strokeWidth: 1.5 } },
    {
      k: "path",
      a: {
        d: "M16 20 C20 18.5 24 18.5 28 20 M16 24.5 C20 23 24 23 28 24.5 M16 29 C20 27.5 23 27.5 26 28.5",
        fill: "none",
        stroke: S,
        strokeWidth: 1.6,
        strokeLinecap: "round",
      },
    },
    {
      k: "path",
      a: {
        d: "M36 20 C40 18.5 44 18.5 48 20 M36 24.5 C40 23 44 23 48 24.5 M38 28.5 C41 27.5 44 27.5 48 29",
        fill: "none",
        stroke: S,
        strokeWidth: 1.6,
        strokeLinecap: "round",
      },
    },
  ],
});

const rehal: LessonArtShape = {
  k: "g",
  a: {},
  c: [
    { k: "path", a: { d: "M19 56 L45 36", stroke: B, strokeWidth: 4.5, strokeLinecap: "round" } },
    { k: "path", a: { d: "M45 56 L19 36", stroke: S, strokeWidth: 4.5, strokeLinecap: "round" } },
    { k: "circle", a: { cx: 32, cy: 46, r: 2.4, fill: W } },
  ],
};

const ART: Record<string, LessonArtShape[]> = {
  quran_mushaf_rehal: [bg, rehal, openBook(0, 0.92)],
  quran_mushaf_sound: [
    bg,
    openBook(-6, 0.78),
    {
      k: "path",
      a: {
        d: "M45 22 C48.5 25 48.5 31 45 34",
        fill: "none",
        stroke: B,
        strokeWidth: 2.6,
        strokeLinecap: "round",
      },
    },
    {
      k: "path",
      a: {
        d: "M49.5 18 C55.5 23 55.5 33 49.5 38",
        fill: "none",
        stroke: B,
        strokeWidth: 2.6,
        strokeLinecap: "round",
        opacity: 0.6,
      },
    },
    { k: "path", a: { d: "M14 46 H50", stroke: S, strokeWidth: 3, strokeLinecap: "round" } },
    {
      k: "path",
      a: {
        d: "M20 46 V43 M26 46 V40 M32 46 V44 M38 46 V41 M44 46 V43",
        stroke: B,
        strokeWidth: 2.4,
        strokeLinecap: "round",
      },
    },
  ],
  quran_mushaf_bookmark: [
    bg,
    { k: "rect", a: { x: 18, y: 11, width: 28, height: 40, rx: 4, fill: B } },
    {
      k: "rect",
      a: {
        x: 21.5,
        y: 14.5,
        width: 21,
        height: 33,
        rx: 2.5,
        fill: "none",
        stroke: W,
        strokeWidth: 1.4,
        opacity: 0.85,
      },
    },
    { k: "path", a: { d: "M32 23 L36.5 31 L32 39 L27.5 31 Z", fill: W } },
    { k: "path", a: { d: "M32 27 L34.2 31 L32 35 L29.8 31 Z", fill: B } },
    { k: "rect", a: { x: 46, y: 13, width: 3, height: 36, rx: 1.5, fill: S } },
    { k: "path", a: { d: "M37 51 V59 L40 56.5 L43 59 V51 Z", fill: S } },
  ],
  music_notes: [
    bg,
    { k: "path", a: { d: "M25 18 L47 13 V20 L25 25 Z", fill: B } },
    { k: "rect", a: { x: 25, y: 18, width: 3.2, height: 28, rx: 1.6, fill: B } },
    { k: "rect", a: { x: 43.8, y: 13, width: 3.2, height: 28, rx: 1.6, fill: B } },
    {
      k: "ellipse",
      a: { cx: 21.5, cy: 46, rx: 6.5, ry: 5, fill: B, transform: "rotate(-20 21.5 46)" },
    },
    {
      k: "ellipse",
      a: { cx: 40.3, cy: 41, rx: 6.5, ry: 5, fill: B, transform: "rotate(-20 40.3 41)" },
    },
    { k: "circle", a: { cx: 14, cy: 20, r: 2.2, fill: S } },
    { k: "circle", a: { cx: 52, cy: 48, r: 2.6, fill: S } },
  ],
  music_piano: [
    bg,
    { k: "path", a: { d: "M10 26 C10 18 18 14 30 14 H48 C51.3 14 54 16.7 54 20 V26 Z", fill: B } },
    {
      k: "rect",
      a: { x: 10, y: 26, width: 44, height: 22, rx: 3, fill: W, stroke: S, strokeWidth: 1.5 },
    },
    {
      k: "path",
      a: {
        d: "M16.3 26 V48 M22.6 26 V48 M28.9 26 V48 M35.1 26 V48 M41.4 26 V48 M47.7 26 V48",
        stroke: S,
        strokeWidth: 1.2,
      },
    },
    { k: "rect", a: { x: 14.6, y: 26, width: 3.4, height: 12, rx: 1, fill: B } },
    { k: "rect", a: { x: 20.9, y: 26, width: 3.4, height: 12, rx: 1, fill: B } },
    { k: "rect", a: { x: 33.4, y: 26, width: 3.4, height: 12, rx: 1, fill: B } },
    { k: "rect", a: { x: 39.7, y: 26, width: 3.4, height: 12, rx: 1, fill: B } },
    { k: "rect", a: { x: 46, y: 26, width: 3.4, height: 12, rx: 1, fill: B } },
    { k: "rect", a: { x: 14, y: 48, width: 3, height: 7, rx: 1.5, fill: B } },
    { k: "rect", a: { x: 47, y: 48, width: 3, height: 7, rx: 1.5, fill: B } },
  ],
  music_guitar: [
    bg,
    {
      k: "g",
      a: { transform: "rotate(35 32 34)" },
      c: [
        { k: "circle", a: { cx: 32, cy: 45, r: 11, fill: S } },
        { k: "circle", a: { cx: 32, cy: 31.5, r: 8, fill: S } },
        { k: "rect", a: { x: 30, y: 4, width: 4, height: 30, rx: 1.5, fill: B } },
        { k: "rect", a: { x: 28.5, y: 1.5, width: 7, height: 7, rx: 2, fill: B } },
        { k: "circle", a: { cx: 32, cy: 38, r: 4, fill: W } },
        { k: "rect", a: { x: 27, y: 47, width: 10, height: 3, rx: 1.5, fill: B } },
        {
          k: "path",
          a: { d: "M31.2 6 V48 M32.8 6 V48", stroke: W, strokeWidth: 0.6, opacity: 0.85 },
        },
      ],
    },
  ],
  music_oud: [
    bg,
    {
      k: "g",
      a: { transform: "rotate(-25 32 36)" },
      c: [
        { k: "rect", a: { x: 30, y: 6, width: 4, height: 22, rx: 1.5, fill: B } },
        { k: "path", a: { d: "M30.5 8 L24 3.5 L26 1 L34 7 Z", fill: B } },
        {
          k: "path",
          a: {
            d: "M18 41 C18 29 26 22 32 21 C38 22 46 29 46 41 C46 51 39 57 32 57 C25 57 18 51 18 41 Z",
            fill: S,
          },
        },
        { k: "circle", a: { cx: 32, cy: 34, r: 4.5, fill: W } },
        { k: "circle", a: { cx: 32, cy: 34, r: 2.6, fill: "none", stroke: S, strokeWidth: 1.2 } },
        { k: "path", a: { d: "M31 8 V50 M33 8 V50", stroke: B, strokeWidth: 0.7, opacity: 0.8 } },
        { k: "rect", a: { x: 26, y: 49, width: 12, height: 2.6, rx: 1.3, fill: B } },
      ],
    },
  ],
  music_violin: [
    bg,
    {
      k: "path",
      a: { d: "M12 50 L50 12", stroke: B, strokeWidth: 2, strokeLinecap: "round", opacity: 0.5 },
    },
    {
      k: "g",
      a: { transform: "rotate(-20 32 34) translate(32 34) scale(1.15) translate(-32 -34)" },
      c: [
        { k: "rect", a: { x: 30.6, y: 10, width: 2.8, height: 28, rx: 1.4, fill: B } },
        { k: "circle", a: { cx: 32, cy: 9, r: 2.6, fill: B } },
        {
          k: "path",
          a: {
            d: "M32 23 C26 23 23 26 24 31 C25 34 27 35 27 37 C27 39 23 40 23 46 C23 53 28 57 32 57 C36 57 41 53 41 46 C41 40 37 39 37 37 C37 35 39 34 40 31 C41 26 38 23 32 23 Z",
            fill: S,
          },
        },
        { k: "rect", a: { x: 30.6, y: 22, width: 2.8, height: 18, rx: 1.4, fill: B } },
        {
          k: "path",
          a: {
            d: "M28 40 C27 42 29 44 28 46 M36 40 C37 42 35 44 36 46",
            fill: "none",
            stroke: B,
            strokeWidth: 1.3,
            strokeLinecap: "round",
          },
        },
        { k: "rect", a: { x: 29.5, y: 48, width: 5, height: 6.5, rx: 2, fill: B } },
      ],
    },
  ],
};

export const LESSON_ART: Record<LessonIllustrationKey, LessonArtShape[]> = {
  quran_lessons_tile: ART.quran_mushaf_rehal,
  quran_memorization: ART.quran_mushaf_rehal,
  quran_tajweed: ART.quran_mushaf_sound,
  quran_recitation_review: ART.quran_mushaf_bookmark,
  music_lessons_tile: ART.music_notes,
  music_piano_keyboard: ART.music_piano,
  music_guitar: ART.music_guitar,
  music_oud: ART.music_oud,
  music_violin: ART.music_violin,
};

const PALETTE: Record<LessonArtColor, string> = {
  brand: LESSON_BRAND,
  tint: LESSON_BRAND_TINT,
  strong: LESSON_BRAND_TINT_STRONG,
  white: "#FFFFFF",
};

/** Shape attributes with palette tokens resolved to colours. */
export function lessonArtProps(shape: LessonArtShape): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(shape.a)) {
    out[key] =
      (key === "fill" || key === "stroke") && typeof value === "string" && value in PALETTE
        ? PALETTE[value as LessonArtColor]
        : value;
  }
  return out;
}
