import { test, expect } from "@playwright/test";

test.describe("Splash Playwright browser launch", () => {
  test("launches installed Chrome without downloading browsers", async ({
    page,
    request,
    browserName,
  }) => {
    await page.goto("about:blank");
    await expect(page).toHaveURL("about:blank");
    expect(browserName).toBe("chromium");
    const network = await request.get("/__splash/network").then((res) => res.json());
    expect(network.unexpected, network.unexpected.join("\n")).toEqual([]);
    expect(network.unexpectedWrites, network.unexpectedWrites.join("\n")).toEqual([]);
  });
});
