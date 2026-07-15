import type { Page } from "@playwright/test";

export interface CapturedErrors {
  console: string[];
  network: string[];
}

/** Attaches console/network error capture to a page. Call readErrors() any time. */
export function captureErrors(page: Page): { readErrors: () => CapturedErrors } {
  const consoleErrors: string[] = [];
  const networkErrors: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
  page.on("response", (res) => {
    const status = res.status();
    if (status >= 400) {
      networkErrors.push(`${status} ${res.request().method()} ${res.url()}`);
    }
  });

  return {
    readErrors: () => ({ console: [...consoleErrors], network: [...networkErrors] }),
  };
}
