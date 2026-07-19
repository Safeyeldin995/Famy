import type { Page } from "@playwright/test";

export interface CapturedErrors {
  console: string[];
  network: string[];
}

export type AllowedHttpError = {
  status: number;
  url: string | RegExp;
  method?: string;
};

function urlMatches(actual: string, expected: string | RegExp): boolean {
  return typeof expected === "string" ? actual.includes(expected) : expected.test(actual);
}

/** Attaches console/network error capture to a page. Call readErrors() any time. */
export function captureErrors(
  page: Page,
  options: { allowHttpErrors?: AllowedHttpError[] } = {},
): { readErrors: () => CapturedErrors } {
  const consoleErrors: string[] = [];
  const networkErrors: string[] = [];
  const allowed = options.allowHttpErrors ?? [];

  const responseIsAllowed = (status: number, method: string, url: string) =>
    allowed.some((entry) => entry.status === status && (!entry.method || entry.method === method) && urlMatches(url, entry.url));

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const locationUrl = msg.location().url;
    const allowedResourceError = allowed.some((entry) =>
      msg.text().includes(String(entry.status)) && !!locationUrl && urlMatches(locationUrl, entry.url),
    );
    if (!allowedResourceError) consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
  page.on("requestfailed", (request) => {
    const errorText = request.failure()?.errorText ?? "unknown transport error";
    // Chromium reports React Query cancellation and page navigation as
    // ERR_ABORTED. Those requests were intentionally cancelled client-side;
    // DNS, connection, TLS, timeout, and other transport failures still fail.
    if (errorText === "net::ERR_ABORTED") return;
    networkErrors.push(`FAILED ${request.method()} ${request.url()} ${errorText}`);
  });
  page.on("response", (res) => {
    const status = res.status();
    if (status >= 400 && !responseIsAllowed(status, res.request().method(), res.url())) {
      networkErrors.push(`${status} ${res.request().method()} ${res.url()}`);
    }
  });

  return {
    readErrors: () => ({ console: [...consoleErrors], network: [...networkErrors] }),
  };
}
