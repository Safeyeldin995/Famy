import { afterEach, describe, expect, it, vi } from "vitest";
import { installPreviewFetchGuard, uninstallPreviewFetchGuard } from "../createPreviewQueryClient";

describe("preview fetch guard", () => {
  afterEach(() => {
    uninstallPreviewFetchGuard();
    vi.unstubAllGlobals();
  });

  it("is a no-op without window", () => {
    expect(() => installPreviewFetchGuard()).not.toThrow();
    expect(() => uninstallPreviewFetchGuard()).not.toThrow();
  });

  it("restores fetch and only intercepts supabase on /preview paths", async () => {
    const real = vi.fn().mockResolvedValue(new Response("real"));
    const fakeWindow = {
      fetch: real,
      location: { pathname: "/preview/login" },
      history: { pushState() {} },
    };
    vi.stubGlobal("window", fakeWindow);
    installPreviewFetchGuard();
    expect(fakeWindow.fetch).not.toBe(real);
    const res = await fakeWindow.fetch("https://example.supabase.co/rest/v1/profiles");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    expect(real).not.toHaveBeenCalled();

    fakeWindow.location.pathname = "/home";
    await fakeWindow.fetch("https://example.supabase.co/rest/v1/profiles");
    expect(real).toHaveBeenCalled();

    uninstallPreviewFetchGuard();
    await fakeWindow.fetch("https://example.supabase.co/rest/v1/profiles");
    expect(real).toHaveBeenCalledTimes(2);
  });
});
