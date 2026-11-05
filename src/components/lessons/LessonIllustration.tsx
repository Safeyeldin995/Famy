import type { LessonIllustrationKey } from "@/lib/tutoring/lessonIllustrations";
import { createElement, type ReactNode } from "react";
import { LESSON_ART, lessonArtProps, type LessonArtShape } from "@/lib/tutoring/lessonArt";
import {
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
      {LESSON_ART[key].map(drawShape)}
    </svg>
  );
}

function drawShape(shape: LessonArtShape, index: number): ReactNode {
  return createElement(shape.k, { key: index, ...lessonArtProps(shape) }, shape.c?.map(drawShape));
}
