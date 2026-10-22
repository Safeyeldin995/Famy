import { describe, expect, it } from "vitest";
import { OTP_LENGTH, applyOtpDigitInput, applyOtpBackspace } from "../otpCodeInputLogic";

describe("mobile otp input logic", () => {
  it("fills digits sequentially and marks complete at six digits", () => {
    let cells = Array.from({ length: OTP_LENGTH }, () => "");
    const first = applyOtpDigitInput(cells, 0, "12");
    cells = first.next;
    expect(cells.slice(0, 2)).toEqual(["1", "2"]);
    expect(first.complete).toBe(false);

    const pasted = applyOtpDigitInput(cells, 2, "345678");
    expect(pasted.complete).toBe(true);
    expect(pasted.next.join("")).toBe("123456");
  });

  it("moves focus back on backspace", () => {
    const cells = ["1", "2", "", "", "", ""];
    const cleared = applyOtpBackspace(cells, 2);
    expect(cleared.next[1]).toBe("");
    expect(cleared.focusIndex).toBe(1);
  });
});
