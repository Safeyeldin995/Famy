// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

const signInWithOAuth = vi.hoisted(() => vi.fn(async () => ({ data: {}, error: null })));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { signInWithOAuth } },
}));

import { contactPhoneErrorKey, oauthRedirectUrl, signInWithOAuthProvider } from "../oauth";
import { oauthErrorInUrl } from "@/routes/auth.callback";

describe("Google sign-in", () => {
  it("returns users to the app's own callback route", async () => {
    expect(oauthRedirectUrl("https://famy-chi.vercel.app")).toBe(
      "https://famy-chi.vercel.app/auth/callback",
    );
    await signInWithOAuthProvider("google");
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  });

  it("detects a provider error in the query or the hash", () => {
    expect(oauthErrorInUrl("https://x.test/auth/callback?error=access_denied")).toBe(true);
    expect(oauthErrorInUrl("https://x.test/auth/callback#error=server_error")).toBe(true);
    expect(oauthErrorInUrl("https://x.test/auth/callback#access_token=abc")).toBe(false);
  });

  it("maps contact phone RPC errors to messages", () => {
    expect(contactPhoneErrorKey("PHONE_TAKEN")).toBe("oauth.phoneTaken");
    expect(contactPhoneErrorKey("INVALID_PHONE")).toBe("oauth.phoneInvalid");
    expect(contactPhoneErrorKey("anything else")).toBe("oauth.phoneSaveFailed");
    expect(contactPhoneErrorKey(undefined)).toBe("oauth.phoneSaveFailed");
  });
});
