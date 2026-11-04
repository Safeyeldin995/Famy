import { describe, expect, it } from "vitest";
import { LESSON_ART, lessonArtProps, type LessonArtShape } from "../lessonArt";
import { LESSON_BRAND } from "../lessonIllustrations";

const walk = (shapes: LessonArtShape[]): LessonArtShape[] =>
  shapes.flatMap((shape) => [shape, ...walk(shape.c ?? [])]);

describe("lessonArt", () => {
  it("has art for every illustration key, starting with the tinted tile", () => {
    for (const [key, shapes] of Object.entries(LESSON_ART)) {
      expect(shapes.length, key).toBeGreaterThanOrEqual(2);
      expect(shapes[0].k).toBe("rect");
    }
  });

  it("resolves palette tokens to colours and keeps other attributes", () => {
    const props = lessonArtProps({ k: "path", a: { d: "M0 0", fill: "brand", stroke: "none" } });
    expect(props).toEqual({ d: "M0 0", fill: LESSON_BRAND, stroke: "none" });
  });

  it("only uses palette tokens or none for colours", () => {
    const allowed = new Set(["brand", "tint", "strong", "white", "none"]);
    for (const shape of walk(Object.values(LESSON_ART).flat())) {
      for (const key of ["fill", "stroke"]) {
        if (key in shape.a) expect(allowed.has(String(shape.a[key]))).toBe(true);
      }
    }
  });
});
