import { test, expect } from "@playwright/test";

test.describe("Issue #70 Playwright browser launch", () => {
  test("launches the configured browser without downloading browsers", async ({
    page,
    request,
  }) => {
    await page.goto("about:blank");
    await expect(page).toHaveURL("about:blank");
    expect(await page.title()).toBe("");
    const network = await request.get("/__issue70/network").then((res) => res.json());
    expect(network.unexpected, network.unexpected.join("\n")).toEqual([]);
  });
});
