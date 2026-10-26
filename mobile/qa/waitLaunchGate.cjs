/** Wait until LaunchGate removes the intro overlay from the DOM (web export). */
async function waitForLaunchGateGone(page, timeoutMs = 20_000) {
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="launch-overlay"]'),
    null,
    { timeout: timeoutMs },
  );
}

module.exports = { waitForLaunchGateGone };
