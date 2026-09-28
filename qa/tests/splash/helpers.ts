import { expect, type Page } from "@playwright/test";
import {
  FAMY_SPLASH_ASSEMBLED,
  famySplashCenteredY,
} from "../../../src/lib/splash/famySplashState";

export const WIDE_VIEWPORT = { width: 1280, height: 720 };
export const NARROW_VIEWPORT = { width: 400, height: 720 };
const ASSEMBLED_MISALIGN_PX = 8;

function isLocalUrl(url: string) {
  return (
    url === "about:blank" ||
    url.startsWith("http://127.0.0.1:") ||
    url.startsWith("http://localhost:") ||
    url.startsWith("https://127.0.0.1:") ||
    url.startsWith("https://localhost:") ||
    url.startsWith("ws://127.0.0.1:") ||
    url.startsWith("ws://localhost:") ||
    url.startsWith("blob:") ||
    url.startsWith("data:")
  );
}

export async function installSplashIsolation(page: Page) {
  const blockedExternal: string[] = [];
  const blockedWrites: string[] = [];

  await page.route("**/*", async (route) => {
    const url = route.request().url();
    const method = route.request().method().toUpperCase();
    if (!isLocalUrl(url)) {
      blockedExternal.push(`${method} ${url}`);
      if (method !== "GET" && method !== "HEAD") blockedWrites.push(`${method} ${url}`);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });

  return {
    getBlockedExternal: () => [...blockedExternal],
    getBlockedWrites: () => [...blockedWrites],
    async getNetwork() {
      return page.request.get("/__splash/network").then((res) => res.json());
    },
    async assertIsolated() {
      const network = await page.request.get("/__splash/network").then((res) => res.json());
      expect(blockedExternal, blockedExternal.join("\n")).toEqual([]);
      expect(blockedWrites, blockedWrites.join("\n")).toEqual([]);
      expect(network.unexpected, network.unexpected.join("\n")).toEqual([]);
      expect(network.unexpectedWrites, network.unexpectedWrites.join("\n")).toEqual([]);
    },
  };
}

export async function openSplash(
  page: Page,
  options: { impl?: "current" | "legacy"; reducedMotion?: boolean } = {},
) {
  const impl = options.impl ?? "current";
  const params = new URLSearchParams({ impl });
  if (options.reducedMotion) params.set("reducedMotion", "1");
  await page.setViewportSize(WIDE_VIEWPORT);
  await page.goto(`/?${params.toString()}`);
  await expect(page.getByTestId("splash-host")).toHaveAttribute("data-impl", impl);
  await expect(page.getByRole("img", { name: "Famy" })).toBeVisible();
}

export async function waitForSplashImages(page: Page) {
  await expect.poll(async () => page.locator('[aria-label="Famy"] img[src]').count()).toBe(3);
}

export async function completeCount(page: Page) {
  return Number(await page.getByTestId("complete-count").innerText());
}

export async function waitForComplete(page: Page) {
  await expect.poll(async () => completeCount(page), { timeout: 12_000 }).toBe(1);
}

export async function rerenderWithNewCallback(page: Page) {
  const before = Number(await page.getByTestId("splash-host").getAttribute("data-generation"));
  await page.getByTestId("rerender").click();
  await expect(page.getByTestId("splash-host")).toHaveAttribute(
    "data-generation",
    String(before + 1),
  );
}

export type SplashLayout = {
  left: number;
  top: number;
  width: number;
  opacity: number;
  logoWidth: number;
  scale: number;
  expectedLeft: number;
  expectedTop: number;
  expectedWidth: number;
  progress: number;
  completeCount: number;
};

export async function readYLayout(page: Page): Promise<SplashLayout> {
  const yBody = page.locator('[aria-label="Famy"] img').nth(1);
  const container = page.locator('[aria-label="Famy"] > div').first();
  const box = await yBody.evaluate((el) => {
    const style = (el as HTMLElement).style;
    return {
      left: parseFloat(style.left) || 0,
      top: parseFloat(style.top) || 0,
      width: parseFloat(style.width) || 0,
      opacity: parseFloat(style.opacity) || 0,
    };
  });
  const logoWidth = await container.evaluate(
    (el) => (el as HTMLElement).getBoundingClientRect().width,
  );
  const scale = logoWidth / FAMY_SPLASH_ASSEMBLED.width;
  const centered = famySplashCenteredY();
  const final = FAMY_SPLASH_ASSEMBLED.y;
  const unscaledX = scale === 0 ? 0 : box.left / scale;
  const progress = (unscaledX - centered.x) / (final.x - centered.x);
  return {
    ...box,
    logoWidth,
    scale,
    expectedLeft: final.x * scale,
    expectedTop: final.y * scale,
    expectedWidth: final.width * scale,
    progress,
    completeCount: await completeCount(page),
  };
}

export function isAssembled(layout: SplashLayout) {
  return (
    Math.abs(layout.left - layout.expectedLeft) <= 1.5 &&
    Math.abs(layout.top - layout.expectedTop) <= 1.5 &&
    Math.abs(layout.width - layout.expectedWidth) <= 1.5 &&
    layout.opacity >= 0.99
  );
}

export function isMisaligned(layout: SplashLayout) {
  return Math.abs(layout.left - layout.expectedLeft) > ASSEMBLED_MISALIGN_PX;
}

export async function waitUntilMoving(page: Page) {
  await expect
    .poll(
      async () => {
        const layout = await readYLayout(page);
        return layout.progress > 0.35 && layout.opacity > 0.9 && layout.completeCount === 0;
      },
      { timeout: 8_000 },
    )
    .toBe(true);
  return readYLayout(page);
}
