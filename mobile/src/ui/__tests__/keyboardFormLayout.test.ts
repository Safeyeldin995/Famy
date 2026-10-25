import { describe, expect, it } from "vitest";
import { KEYBOARD_FOCUS_GAP, KEYBOARD_PRIMARY_STICKY_RESERVE } from "../keyboardFormConstants";
import {
  keyboardInlineBottomOffset,
  keyboardStickyBottomOffset,
  keyboardStickyScrollPaddingBottom,
} from "../keyboardFormLayout";

describe("keyboardFormLayout", () => {
  it("uses measured footer height plus focus gap for sticky bottom offset", () => {
    expect(keyboardStickyBottomOffset(96)).toBe(96 + KEYBOARD_FOCUS_GAP);
  });

  it("falls back to sticky reserve before footer layout", () => {
    expect(keyboardStickyBottomOffset(0)).toBe(
      KEYBOARD_PRIMARY_STICKY_RESERVE + KEYBOARD_FOCUS_GAP,
    );
    expect(keyboardStickyScrollPaddingBottom(0)).toBe(KEYBOARD_PRIMARY_STICKY_RESERVE);
  });

  it("matches scroll padding to footer height when measured", () => {
    expect(keyboardStickyScrollPaddingBottom(112)).toBe(112);
  });

  it("keeps inline forms on the legacy inline offset", () => {
    expect(keyboardInlineBottomOffset()).toBeGreaterThanOrEqual(KEYBOARD_FOCUS_GAP);
  });
});
