import { test, expect } from "@playwright/test";
import {
  NARROW_VIEWPORT,
  completeCount,
  installSplashIsolation,
  isAssembled,
  isMisaligned,
  openSplash,
  readYLayout,
  rerenderWithNewCallback,
  waitForComplete,
  waitForSplashImages,
  waitUntilMoving,
} from "./helpers";

test.describe("FamySplashScreen isolated browser regression", () => {
  test("current: parent rerender with a new callback does not rewind the y", async ({ page }) => {
    const isolation = await installSplashIsolation(page);
    await openSplash(page, { impl: "current" });
    await waitForSplashImages(page);
    const before = await waitUntilMoving(page);

    await rerenderWithNewCallback(page);
    const afterClick = await readYLayout(page);
    expect(afterClick.completeCount).toBe(0);
    expect(afterClick.progress).toBeGreaterThan(before.progress - 0.08);

    await page.waitForTimeout(280);
    const later = await readYLayout(page);
    expect(later.completeCount).toBe(0);
    expect(later.progress).toBeGreaterThan(afterClick.progress - 0.02);
    await isolation.assertIsolated();
  });

  test("current: resize during animation rescales without rewinding", async ({ page }) => {
    const isolation = await installSplashIsolation(page);
    await openSplash(page, { impl: "current" });
    await waitForSplashImages(page);
    const before = await waitUntilMoving(page);

    await page.setViewportSize(NARROW_VIEWPORT);
    await expect
      .poll(async () => (await readYLayout(page)).logoWidth)
      .toBeLessThan(before.logoWidth - 20);

    const after = await readYLayout(page);
    expect(after.completeCount).toBe(0);
    expect(after.progress).toBeGreaterThan(before.progress - 0.08);
    expect(after.left).not.toBeCloseTo(before.left, 0);
    await isolation.assertIsolated();
  });

  test("legacy: resize after complete leaves the y off the assembled mark", async ({ page }) => {
    const isolation = await installSplashIsolation(page);
    await openSplash(page, { impl: "legacy" });
    await waitForSplashImages(page);
    await waitForComplete(page);

    await rerenderWithNewCallback(page);
    await page.setViewportSize(NARROW_VIEWPORT);
    await expect.poll(async () => (await readYLayout(page)).logoWidth).toBeLessThan(300);

    const after = await readYLayout(page);
    expect(after.completeCount).toBe(1);
    expect(isMisaligned(after)).toBe(true);
    await isolation.assertIsolated();
  });

  test("current: resize after complete keeps the y assembled at the new scale", async ({
    page,
  }) => {
    const isolation = await installSplashIsolation(page);
    await openSplash(page, { impl: "current" });
    await waitForSplashImages(page);
    await waitForComplete(page);
    expect(isAssembled(await readYLayout(page))).toBe(true);

    await rerenderWithNewCallback(page);
    await page.setViewportSize(NARROW_VIEWPORT);
    await expect.poll(async () => isAssembled(await readYLayout(page))).toBe(true);

    const after = await readYLayout(page);
    expect(after.completeCount).toBe(1);
    expect(after.logoWidth).toBeLessThan(300);
    await isolation.assertIsolated();
  });

  test("current: reduced motion assembles immediately and completes once", async ({ page }) => {
    const isolation = await installSplashIsolation(page);
    await openSplash(page, { impl: "current", reducedMotion: true });
    await waitForSplashImages(page);
    await waitForComplete(page);
    expect(isAssembled(await readYLayout(page))).toBe(true);

    await rerenderWithNewCallback(page);
    await page.waitForTimeout(200);
    expect(await completeCount(page)).toBe(1);
    expect(isAssembled(await readYLayout(page))).toBe(true);
    await isolation.assertIsolated();
  });

  test("legacy: reduced-motion resize after complete misaligns the y", async ({ page }) => {
    const isolation = await installSplashIsolation(page);
    await openSplash(page, { impl: "legacy", reducedMotion: true });
    await waitForSplashImages(page);
    await waitForComplete(page);

    await page.setViewportSize(NARROW_VIEWPORT);
    await expect.poll(async () => (await readYLayout(page)).logoWidth).toBeLessThan(300);

    const after = await readYLayout(page);
    expect(after.completeCount).toBe(1);
    expect(isMisaligned(after)).toBe(true);
    await isolation.assertIsolated();
  });

  test("current: reduced-motion resize after complete keeps the assembled logo", async ({
    page,
  }) => {
    const isolation = await installSplashIsolation(page);
    await openSplash(page, { impl: "current", reducedMotion: true });
    await waitForSplashImages(page);
    await waitForComplete(page);
    expect(isAssembled(await readYLayout(page))).toBe(true);

    await page.setViewportSize(NARROW_VIEWPORT);
    await expect.poll(async () => isAssembled(await readYLayout(page))).toBe(true);
    expect(await completeCount(page)).toBe(1);
    await isolation.assertIsolated();
  });

  test("current: completion callback stays at one after rerender and post-complete resize", async ({
    page,
  }) => {
    const isolation = await installSplashIsolation(page);
    await openSplash(page, { impl: "current" });
    await waitForSplashImages(page);
    await waitUntilMoving(page);
    await rerenderWithNewCallback(page);
    await waitForComplete(page);
    await rerenderWithNewCallback(page);
    await page.setViewportSize(NARROW_VIEWPORT);
    await expect.poll(async () => isAssembled(await readYLayout(page))).toBe(true);
    await page.waitForTimeout(400);
    expect(await completeCount(page)).toBe(1);
    await isolation.assertIsolated();
  });

  test("records harness identity without using source text as behavior proof", async ({
    request,
  }) => {
    const identity = await request.get("/__splash/identity").then((res) => res.json());
    expect(identity.head).toMatch(/^[a-f0-9]{40}$/);
    expect(identity.legacy.faithful).toBe(true);
    expect(identity.legacy.exportRenamed).toBe(true);
    expect(identity.legacy.unexpectedExport).toBe(false);
    expect(identity.hashes["src/components/famio/FamySplashScreen.tsx"]).toMatch(/^[a-f0-9]{64}$/);
    expect(identity.hashes["qa/tests/splash/fixtures/FamySplashScreen.legacy.tsx"]).toMatch(
      /^[a-f0-9]{64}$/,
    );
    console.log(`[splash-identity] HEAD ${identity.head}`);
    console.log(
      `[splash-identity] legacy ${identity.legacySourceCommit} faithful=${identity.legacy.faithful}`,
    );
  });
});
