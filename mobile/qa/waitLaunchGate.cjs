const LAUNCH_OVERLAY_SELECTOR = '[data-testid="launch-overlay"]';

/**
 * Wait until LaunchGate removes the intro overlay from the DOM (web export).
 * LaunchGate only mounts after fonts and i18n load, so an empty page must not
 * count as "overlay gone": require rendered app content with no overlay.
 */
async function waitForLaunchGateGone(page, timeoutMs = 20_000) {
  await page.waitForFunction(
    (selector) => {
      if (document.querySelector(selector)) return false;
      const root = document.getElementById("root");
      return !!root && (root.innerText || "").trim().length > 0;
    },
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
