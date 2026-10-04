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
    expect(response.headers.get("Content-Security-Policy")).toBe("frame-ancestors 'none'");
    expect(await response.text()).toBe("<html><body>ok</body></html>");
  });
});
