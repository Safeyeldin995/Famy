import { describe, expect, it } from "vitest";
import { rewriteIncomingAppLinkPath } from "@/lib/redirectSystemPath";

describe("rewriteIncomingAppLinkPath", () => {
  it("rewrites provider share links", () => {
    expect(rewriteIncomingAppLinkPath("/p/abc-123")).toBe("/provider/abc-123");
    expect(rewriteIncomingAppLinkPath("https://famy-chi.vercel.app/p/abc-123")).toBe(
      "/provider/abc-123",
    );
  });

  it("rewrites online lesson links to booking routes", () => {
    expect(rewriteIncomingAppLinkPath("/online/lessons/b1")).toBe("/booking/b1");
    expect(rewriteIncomingAppLinkPath("/online/lessons/b1/room")).toBe("/lesson-link/b1");
    expect(rewriteIncomingAppLinkPath("https://famy-chi.vercel.app/online/lessons/b1/room")).toBe(
      "/lesson-link/b1",
    );
  });

  it("keeps booking paths including query", () => {
    expect(rewriteIncomingAppLinkPath("/booking/b1")).toBe("/booking/b1");
    expect(rewriteIncomingAppLinkPath("/booking/b1?review=1")).toBe("/booking/b1?review=1");
  });

  it("sends unknown universal-host paths home", () => {
    expect(rewriteIncomingAppLinkPath("https://famy-chi.vercel.app/unknown/page")).toBe("/");
  });

  it("passes through non-universal custom scheme paths", () => {
    expect(rewriteIncomingAppLinkPath("famy://wallet")).toBe("/wallet");
  });
});