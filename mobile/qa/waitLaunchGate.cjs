const LAUNCH_OVERLAY_SELECTOR = '[data-testid="launch-overlay"]';

/** Wait until LaunchGate removes the intro overlay from the DOM (web export). */
async function waitForLaunchGateGone(page, timeoutMs = 20_000) {
  await page.waitForFunction(
    (selector) => !document.querySelector(selector),
    LAUNCH_OVERLAY_SELECTOR,
    { timeout: timeoutMs },
  );
}

async function assertLaunchOverlayAbsent(page, context = "screenshot") {
  const count = await page.locator(LAUNCH_OVERLAY_SELECTOR).count();
  if (count > 0) {
    throw new Error(`Launch overlay still present before ${context}`);
  }
}

/** Wait for overlay removal, assert, then capture a viewport screenshot. */
async function screenshotWithoutLaunchOverlay(page, filePath, context) {
  await waitForLaunchGateGone(page);
  await assertLaunchOverlayAbsent(page, context ?? filePath);
  await page.screenshot({ path: filePath, fullPage: false });
}

module.exports = {
  LAUNCH_OVERLAY_SELECTOR,
  waitForLaunchGateGone,
  assertLaunchOverlayAbsent,
  screenshotWithoutLaunchOverlay,
};
