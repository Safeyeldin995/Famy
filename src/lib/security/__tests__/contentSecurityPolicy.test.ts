import { afterEach, describe, expect, it, vi } from "vitest";
import { buildContentSecurityPolicy } from "../contentSecurityPolicy";

describe("buildContentSecurityPolicy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const fullEnv: NodeJS.ProcessEnv = {
    VITE_SUPABASE_URL: "https://abc123.supabase.co",
    LIVEKIT_URL: "wss://famylive.example.com",
    VITE_FIREBASE_AUTH_DOMAIN: "famy-test.firebaseapp.com",
    VITE_SENTRY_DSN: "https://sentry.example.com/123",
  };

  it("allows Supabase storage (public + signed avatars) and Firebase phone auth hosts", () => {
    const csp = buildContentSecurityPolicy(fullEnv);

    expect(csp).toContain("img-src");
    expect(csp).toContain("https://abc123.supabase.co");
    expect(csp).toContain("https://abc123.supabase.co/storage/v1/object/");

    expect(csp).toContain("script-src");
    expect(csp).toContain("https://www.gstatic.com");
    expect(csp).toContain("https://apis.google.com");

    expect(csp).toContain("frame-src");
    expect(csp).toContain("https://recaptcha.google.com");
    expect(csp).toContain("https://famy-test.firebaseapp.com");

    expect(csp).toContain("connect-src");
    expect(csp).toContain("https://identitytoolkit.googleapis.com");
    expect(csp).toContain("https://securetoken.googleapis.com");
    expect(csp).toContain("wss://abc123.supabase.co");
    expect(csp).toContain("https://famylive.example.com");
  });

  it("warns when Supabase or LiveKit env is missing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    buildContentSecurityPolicy({});

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("VITE_SUPABASE_URL"),
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("LIVEKIT_URL"));
  });
});