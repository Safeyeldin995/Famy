import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

vi.mock("@tanstack/react-start/server-entry", () => ({
  default: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

vi.mock("../lib/qa-meta-endpoint", () => ({
  handleQaMetaRequest: () => null,
}));

vi.mock("../lib/error-logging.server", () => ({
  logCapturedError: vi.fn(),
}));

describe("server HTML security headers", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("sets baseline security headers on an HTML response", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html><body>ok</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );

    const { default: server } = await import("../server");
    const response = await server.fetch(new Request("http://localhost/login"), {}, {});

    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(response.headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(response.headers.get("Permissions-Policy")).toBe(
      "camera=(), microphone=(), geolocation=(self)",
    );
    const csp = response.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(await response.text()).toBe("<html><body>ok</body></html>");
  });

  it.each([
    ["/online/lessons/abc/room", "camera=(self), microphone=(self), geolocation=(self)"],
    ["/online/lessons/abc", "camera=(self), microphone=(self), geolocation=(self)"],
    ["/online", "camera=(self), microphone=(self), geolocation=(self)"],
    ["/onlineX", "camera=(), microphone=(), geolocation=(self)"],
    ["/bookings", "camera=(), microphone=(), geolocation=(self)"],
  ])("Permissions-Policy for %s", async (path, expected) => {
    fetchMock.mockResolvedValue(
      new Response("<html></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
    const { default: server } = await import("../server");
    const response = await server.fetch(new Request(`http://localhost${path}`), {}, {});
    expect(response.headers.get("Permissions-Policy")).toBe(expected);
  });
});
