import { test, expect, type Locator, type Page } from "@playwright/test";
import { installIssue68Mocks } from "./mock-supabase.mjs";

async function gotoCatalog(page: Page, lang: "en" | "ar" = "en") {
  const mocks = await installIssue68Mocks(page, {
    scenario: "admin-services-catalog",
    lang,
  });
  await page.goto("/admin-services-catalog");
  await expect(page.getByTestId("issue68-admin-services-catalog")).toBeVisible();
  const launchTab =
    lang === "ar"
      ? page.getByRole("tab", { name: "خدمات الإطلاق" })
      : page.getByRole("tab", { name: "Launch services" });
  await expect(launchTab).toHaveAttribute("aria-selected", "true");
  return mocks;
}

async function expectInViewport(locator: Locator, page: Page) {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box, "element should have a layout box").toBeTruthy();
  expect(viewport, "viewport should be set").toBeTruthy();
  if (!box || !viewport) return;
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 2);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 2);
}

test.describe("admin services catalogue views", () => {
  test("default launch view shows babysitting/tutoring only, including inactive launch rows", async ({
    page,
  }) => {
    const mocks = await gotoCatalog(page);
    await expect(page.getByRole("listitem").filter({ hasText: "Babysitting" })).toBeVisible();
    await expect(
      page.getByRole("listitem").filter({ hasText: "Tutoring (inactive)" }),
    ).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Deep Home Cleaning" })).toHaveCount(
      0,
    );
    await expect(page.getByRole("listitem").filter({ hasText: "QA Booking Service" })).toHaveCount(
      0,
    );
    expect((await mocks.getCalls()).servicePatches).toEqual([]);
    await mocks.assertIsolated();
  });

  test("secondary views partition QA and outside-launch rows without writes", async ({ page }) => {
    const mocks = await gotoCatalog(page);
    await page.getByRole("tab", { name: "Outside launch" }).click();
    await expect(
      page.getByRole("listitem").filter({ hasText: "Deep Home Cleaning" }),
    ).toBeVisible();
    await expect(page.getByText("Outside closed beta")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "QA Booking Service" })).toHaveCount(
      0,
    );
    await expect(page.getByRole("listitem").filter({ hasText: "Babysitting" })).toHaveCount(0);

    await page.getByRole("tab", { name: "Test data" }).click();
    await expect(
      page.getByRole("listitem").filter({ hasText: "QA Booking Service" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /activate for launch|deactivate for launch/i }),
    ).toHaveCount(0);
    await expect(page.getByRole("listitem").filter({ hasText: "Deep Home Cleaning" })).toHaveCount(
      0,
    );

    expect((await mocks.getCalls()).servicePatches).toEqual([]);
    await mocks.assertIsolated();
  });

  test("activates inactive launch service through existing mutation path", async ({ page }) => {
    const mocks = await gotoCatalog(page);
    const row = page.getByRole("listitem").filter({ hasText: "Tutoring (inactive)" });
    await row.getByRole("button", { name: "Activate for launch" }).click();
    await expect.poll(async () => (await mocks.getCalls()).servicePatches.length).toBe(1);
    expect((await mocks.getCalls()).servicePatches[0]).toMatchObject({
      id: "svc-tutor",
      patch: { is_active: true },
    });
    await expect.poll(async () => row.getByText("Active", { exact: true }).isVisible()).toBe(true);
    await mocks.assertIsolated();
  });

  test("shows translated error and keeps saved inactive state when toggle fails", async ({
    page,
  }) => {
    const mocks = await installIssue68Mocks(page, {
      scenario: "admin-services-catalog",
      adminCatalogToggleFail: true,
    });
    await page.goto("/admin-services-catalog");
    const row = page.getByRole("listitem").filter({ hasText: "Tutoring (inactive)" });
    await row.getByRole("button", { name: "Activate for launch" }).click();
    await expect(page.getByText("Could not update service active status.")).toBeVisible();
    await expect(row.getByText("Inactive", { exact: true })).toBeVisible();
    expect((await mocks.getCalls()).servicePatches).toHaveLength(1);
    await mocks.assertIsolated();
  });

  test("lazy-loads requirement details only after expand", async ({ page }) => {
    const mocks = await gotoCatalog(page);
    expect((await mocks.getCalls()).serviceRequirementQueries).toBe(0);
    const row = page.getByRole("listitem").filter({ hasText: "Babysitting" }).first();
    await row.getByText("Requirements and provider flags").click();
    await expect
      .poll(async () => (await mocks.getCalls()).serviceRequirementQueries)
      .toBeGreaterThan(0);
    await mocks.assertIsolated();
  });

  test("controls fit common viewports in EN and AR without clipping", async ({ page }) => {
    const viewports = [
      { width: 360, height: 740 },
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1280, height: 800 },
    ] as const;

    for (const lang of ["en", "ar"] as const) {
      const mocks = await installIssue68Mocks(page, { scenario: "admin-services-catalog", lang });
      await page.goto("/admin-services-catalog");
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        const tabs = page.getByRole("tablist");
        await expectInViewport(tabs, page);
        const toggle = page
          .getByRole("listitem")
          .filter({ hasText: lang === "ar" ? "مجالسة" : "Babysitting" })
          .getByRole("button", { name: lang === "ar" ? "تعطيل للإطلاق" : "Deactivate for launch" });
        await expectInViewport(toggle, page);
      }
      await mocks.assertIsolated();
    }
  });
});
