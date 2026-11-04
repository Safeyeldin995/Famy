import type { ReactNode } from "react";
import Svg, { Circle, Ellipse, G, Path, Rect } from "react-native-svg";
import { LESSON_ART, lessonArtProps, type LessonArtShape } from "@shared/tutoring/lessonArt";
import {
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
      {LESSON_ART[key].map(drawShape)}
    </Svg>
  );
}

const ELEMENTS = { rect: Rect, circle: Circle, ellipse: Ellipse, path: Path, g: G } as const;

function drawShape(shape: LessonArtShape, index: number): ReactNode {
  const Element = ELEMENTS[shape.k] as unknown as (props: Record<string, unknown>) => ReactNode;
  return (
    <Element key={index} {...lessonArtProps(shape)}>
      {shape.c?.map(drawShape)}
    </Element>
  );
}
