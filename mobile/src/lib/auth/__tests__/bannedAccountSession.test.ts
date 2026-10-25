import { describe, expect, it } from "vitest";
import { isUserBannedAuthError } from "../bannedAccountSession";

describe("isUserBannedAuthError", () => {
  it("detects Supabase user_banned code", () => {
    expect(isUserBannedAuthError({ code: "user_banned", message: "User banned" })).toBe(true);
  });

  it("detects user_banned in message text", () => {
    expect(isUserBannedAuthError({ message: "AuthApiError: user_banned" })).toBe(true);
  });

  it("ignores unrelated auth errors", () => {
    expect(isUserBannedAuthError({ code: "invalid_credentials", message: "Invalid login" })).toBe(
      false,
    );
  });
});
