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

export type AllowedConsoleError = {
  pattern: string | RegExp;
};

/** Attaches console/network error capture to a page. Call readErrors() any time. */
export function captureErrors(
  page: Page,
  options: { allowHttpErrors?: AllowedHttpError[]; allowConsoleErrors?: AllowedConsoleError[] } = {},
): { readErrors: () => CapturedErrors; stopCapture: () => void } {
  const consoleErrors: string[] = [];
  const networkErrors: string[] = [];
  const allowed = options.allowHttpErrors ?? [];
  const allowedConsole = options.allowConsoleErrors ?? [];

  const consoleIsAllowed = (text: string) =>
    allowedConsole.some((entry) =>
      typeof entry.pattern === "string" ? text.includes(entry.pattern) : entry.pattern.test(text),
    );

  const responseIsAllowed = (status: number, method: string, url: string) =>
    allowed.some((entry) => entry.status === status && (!entry.method || entry.method === method) && urlMatches(url, entry.url));

  const onConsole = (msg: { type: () => string; text: () => string; location: () => { url: string } }) => {
    if (msg.type() !== "error") return;
    const locationUrl = msg.location().url;
    const allowedResourceError = allowed.some((entry) =>
      msg.text().includes(String(entry.status)) && !!locationUrl && urlMatches(locationUrl, entry.url),
    );
    if (!allowedResourceError && !consoleIsAllowed(msg.text())) consoleErrors.push(msg.text());
  };
  const onPageError = (err: Error) => consoleErrors.push(`pageerror: ${err.message}`);
  const onRequestFailed = (request: { method: () => string; url: () => string; failure: () => { errorText?: string } | null }) => {
    const errorText = request.failure()?.errorText ?? "unknown transport error";
    if (errorText === "net::ERR_ABORTED") return;
    networkErrors.push(`FAILED ${request.method()} ${request.url()} ${errorText}`);
  };
  const onResponse = (res: { status: () => number; request: () => { method: () => string; url: () => string } }) => {
    const status = res.status();
    const request = res.request();
    if (status >= 400 && !responseIsAllowed(status, request.method(), request.url())) {
      networkErrors.push(`${status} ${request.method()} ${request.url()}`);
    }
  };

  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("requestfailed", onRequestFailed);
  page.on("response", onResponse);

  return {
    readErrors: () => ({ console: [...consoleErrors], network: [...networkErrors] }),
    stopCapture: () => {
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
      page.off("requestfailed", onRequestFailed);
      page.off("response", onResponse);
    },
  };
}
