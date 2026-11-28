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

  it("allows the local Supabase stack's realtime websocket (e2e-local CI)", () => {
    const csp = buildContentSecurityPolicy({ ...fullEnv, VITE_SUPABASE_URL: "http://127.0.0.1:54321" });
    const connect = csp.split("; ").find((d) => d.startsWith("connect-src ")) ?? "";
    expect(connect).toContain("http://127.0.0.1:54321");
    expect(connect).toContain("ws://127.0.0.1:54321");
    expect(connect).not.toContain("wss://127.0.0.1:54321");
  });

  it("allows Google Maps (web address picker and admin zone map)", () => {
    const csp = buildContentSecurityPolicy(fullEnv);
    const directive = (name: string) =>
      csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

    expect(directive("script-src")).toContain("https://maps.googleapis.com");
    expect(directive("img-src")).toContain("https://*.gstatic.com");
    expect(directive("img-src")).toContain("https://*.googleapis.com");
    expect(directive("connect-src")).toContain("https://maps.googleapis.com");
    expect(directive("worker-src")).toContain("blob:");
  });

  it("allows LiveKit Cloud regional hosts when the project is on livekit.cloud", () => {
    const csp = buildContentSecurityPolicy({ ...fullEnv, LIVEKIT_URL: "wss://famy-abc.livekit.cloud" });
    const connect = csp.split("; ").find((d) => d.startsWith("connect-src ")) ?? "";

    expect(connect).toContain("wss://famy-abc.livekit.cloud");
    expect(connect).toContain("https://famy-abc.livekit.cloud");
    expect(connect).toContain("wss://*.livekit.cloud");
    expect(connect).toContain("https://*.livekit.cloud");
  });

  it("does not add livekit.cloud wildcards for a self-hosted LiveKit", () => {
    const csp = buildContentSecurityPolicy(fullEnv);
    expect(csp).not.toContain("*.livekit.cloud");
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