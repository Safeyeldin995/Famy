import { describe, expect, it } from "vitest";
import ar from "../locales/ar";

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (value && typeof value === "object") {
    for (const nested of Object.values(value)) collectStrings(nested, out);
  }
  return out;
}

/** True when the copy is one sentence (no further sentence after ". "). */
function isSingleSentenceArabicCopy(text: string): boolean {
  if (text.endsWith("...")) return false;
  return !/\.(?!\.)\s+\S/.test(text);
}

describe("Arabic locale punctuation", () => {
  it("does not end single-sentence strings in ar.ts with a trailing period", () => {
    const offenders = collectStrings(ar).filter(
      (s) => isSingleSentenceArabicCopy(s) && s.endsWith(".") && !s.endsWith("..."),
    );
    expect(offenders, offenders.slice(0, 20).join("\n")).toEqual([]);
  });
});
