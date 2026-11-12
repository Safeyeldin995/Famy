import { describe, expect, it } from "vitest";
import { interpretSignupSendForLoginPhoneContinue } from "../loginPhoneContinue";

describe("interpretSignupSendForLoginPhoneContinue", () => {
  it("treats successful signup send as OTP path", () => {
    expect(interpretSignupSendForLoginPhoneContinue({ ok: true })).toEqual({
      kind: "proceed_signup_otp",
    });
  });

  it("maps flow_mismatch signin to registered password step", () => {
    expect(
      interpretSignupSendForLoginPhoneContinue({
        ok: false,
        error: "flow_mismatch",
        nextStep: "signin",
      }),
    ).toEqual({ kind: "registered" });
  });

  it("maps flow_mismatch signup separately", () => {
    expect(
      interpretSignupSendForLoginPhoneContinue({
        ok: false,
        error: "flow_mismatch",
        nextStep: "signup",
      }),
    ).toEqual({ kind: "flow_mismatch_signup" });
  });
});
