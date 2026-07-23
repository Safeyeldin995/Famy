import { describe, expect, it } from "vitest";
import {
  OTP_LENGTH,
  applyOtpBackspace,
  applyOtpDigitInput,
  sanitizeOtpDigits,
} from "@/components/auth/otpCodeInputLogic";

describe("otpCodeInput helpers", () => {
  const empty = Array.from({ length: OTP_LENGTH }, () => "");

  it("sanitizes non-digits and limits to six characters", () => {
    expect(sanitizeOtpDigits("12a34b56c78")).toBe("123456");
  });

  it("supports pasting a full six-digit code", () => {
    const result = applyOtpDigitInput(empty, 0, "123456");
    expect(result.next.join("")).toBe("123456");
    expect(result.complete).toBe(true);
  });

  it("moves focus across fields while typing", () => {
    const result = applyOtpDigitInput(empty, 2, "9");
    expect(result.next).toEqual(["", "", "9", "", "", ""]);
    expect(result.focusIndex).toBe(3);
  });

  it("moves to the previous field on backspace", () => {
    const current = ["1", "2", "", "", "", ""];
    const result = applyOtpBackspace(current, 2);
    expect(result.next).toEqual(["1", "", "", "", "", ""]);
    expect(result.focusIndex).toBe(1);
  });

  it("requires exactly six digits before completion", () => {
    const partial = applyOtpDigitInput(empty, 0, "12345");
    expect(partial.complete).toBe(false);
    const complete = applyOtpDigitInput(partial.next, 5, "6");
    expect(complete.complete).toBe(true);
  });
});
