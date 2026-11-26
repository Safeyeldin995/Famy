import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  emailAuthErrorCode,
  emailAuthErrorKey,
  isValidEmail,
  onlineAuthCallbackUrl,
  onlineResetPasswordUrl,
  resolveOnlinePostAuthTarget,
} from "../onlineWebAuth";

describe("resolveOnlinePostAuthTarget", () => {
  it("sends students without a phone or a name to the profile step", () => {
    expect(
      resolveOnlinePostAuthTarget({ profilePhone: null, profileFullName: "Mona", returnTo: "/online/tutors" }),
    ).toBe("/online/complete-profile");
    expect(
      resolveOnlinePostAuthTarget({ profilePhone: "201005522352", profileFullName: " ", returnTo: "/online/tutors" }),
    ).toBe("/online/complete-profile");
  });

  it("continues to returnTo when the profile is complete", () => {
    expect(
      resolveOnlinePostAuthTarget({
        profilePhone: "201005522352",
        profileFullName: "Mona",
        returnTo: "/online/lessons/abc",
      }),
    ).toBe("/online/lessons/abc");
  });
});

describe("emailAuthErrorCode", () => {
  it("maps Supabase auth errors to our codes", () => {
    expect(emailAuthErrorCode({ code: "invalid_credentials" })).toBe("invalid_credentials");
    expect(emailAuthErrorCode({ message: "Invalid login credentials" })).toBe("invalid_credentials");
    expect(emailAuthErrorCode({ message: "Email not confirmed" })).toBe("email_not_confirmed");
    expect(emailAuthErrorCode({ code: "user_already_exists" })).toBe("already_registered");
    expect(emailAuthErrorCode({ code: "weak_password" })).toBe("weak_password");
    expect(emailAuthErrorCode({ status: 429 })).toBe("rate_limited");
    expect(emailAuthErrorCode({ code: "over_email_send_rate_limit" })).toBe("rate_limited");
    expect(emailAuthErrorCode(null)).toBe("failed");
    expect(emailAuthErrorKey("failed")).toBe("onlineWeb.auth.errors.failed");
  });
});

describe("helpers", () => {
  it("validates emails", () => {
    expect(isValidEmail("mona@example.com")).toBe(true);
    expect(isValidEmail(" mona@example.co ")).toBe(true);
    expect(isValidEmail("mona@example")).toBe(false);
    expect(isValidEmail("mona example.com")).toBe(false);
  });

  it("builds the online redirect URLs", () => {
    expect(onlineAuthCallbackUrl("https://famy-chi.vercel.app")).toBe(
      "https://famy-chi.vercel.app/online/auth/callback",
    );
    expect(onlineResetPasswordUrl("https://famy-chi.vercel.app")).toBe(
      "https://famy-chi.vercel.app/online/reset-password",
    );
  });
});
