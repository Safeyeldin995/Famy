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

async function confirmDeactivate(page: Page, confirmLabel: string | RegExp) {
  const dialog = page.locator(".rounded-xl.border.border-coral\\/40").last();
  await dialog.getByRole("button", { name: confirmLabel }).click();
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

  test("secondary views partition rows; active fixtures get Deactivate only (no launch Activate)", async ({
    page,
  }) => {
    const mocks = await gotoCatalog(page);
    await page.getByRole("tab", { name: "Outside launch" }).click();
    await expect(
      page.getByRole("listitem").filter({ hasText: "Deep Home Cleaning" }),
    ).toBeVisible();
    await expect(
      page.getByRole("listitem").filter({ hasText: "Deep Home Cleaning" }).getByText("Outside closed beta"),
    ).toBeVisible();
    await expect(
      page
        .getByRole("listitem")
        .filter({ hasText: "Deep Home Cleaning" })
        .getByRole("button", { name: "Deactivate" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Activate for launch" })).toHaveCount(0);

    await page.getByRole("tab", { name: "Test data" }).click();
    await expect(
      page.getByRole("listitem").filter({ hasText: "QA Booking Service" }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("listitem")
        .filter({ hasText: "QA Booking Service" })
        .getByRole("button", { name: "Deactivate" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /activate for launch/i })).toHaveCount(0);

    expect((await mocks.getCalls()).servicePatches).toEqual([]);
    await mocks.assertIsolated();
  });

  test("deactivates active QA fixture after confirmation (exact service id patch)", async ({
    page,
  }) => {
    const mocks = await gotoCatalog(page);
    await page.getByRole("tab", { name: "Test data" }).click();
    const row = page.getByRole("listitem").filter({ hasText: "QA Booking Service" });
    await row.getByRole("button", { name: "Deactivate" }).click();
    await confirmDeactivate(page, "Deactivate");
    await expect.poll(async () => (await mocks.getCalls()).servicePatches.length).toBe(1);
    expect((await mocks.getCalls()).servicePatches[0]).toEqual({
      id: "svc-qa",
      patch: { is_active: false },
    });
    await expect(row.getByText("Inactive", { exact: true })).toBeVisible();
    await mocks.assertIsolated();
  });

  test("deactivates active outside-launch service after confirmation", async ({ page }) => {
    const mocks = await gotoCatalog(page);
    await page.getByRole("tab", { name: "Outside launch" }).click();
    const row = page.getByRole("listitem").filter({ hasText: "Deep Home Cleaning" });
    await row.getByRole("button", { name: "Deactivate" }).click();
    await confirmDeactivate(page, "Deactivate");
    await expect.poll(async () => (await mocks.getCalls()).servicePatches.length).toBe(1);
    expect((await mocks.getCalls()).servicePatches[0]).toMatchObject({
      id: "svc-clean",
      patch: { is_active: false },
    });
    await mocks.assertIsolated();
  });

  test("cancelling deactivation confirmation performs no write", async ({ page }) => {
    const mocks = await gotoCatalog(page);
    await page.getByRole("tab", { name: "Test data" }).click();
    const row = page.getByRole("listitem").filter({ hasText: "QA Booking Service" });
    await row.getByRole("button", { name: "Deactivate" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();
    expect((await mocks.getCalls()).servicePatches).toEqual([]);
    await expect(row.getByText("Active", { exact: true })).toBeVisible();
    await mocks.assertIsolated();
  });

  test("inactive secondary-view rows stay visible without any activation control", async ({
    page,
  }) => {
    const mocks = await gotoCatalog(page);
    await page.getByRole("tab", { name: "Outside launch" }).click();
    const row = page.getByRole("listitem").filter({ hasText: "Standard Cleaning (inactive)" });
    await expect(row).toBeVisible();
    await expect(row.getByRole("button", { name: "Deactivate" })).toHaveCount(0);
    await expect(row.getByRole("button", { name: /activate for launch/i })).toHaveCount(0);
    await expect(row.getByRole("button", { name: "Activate" })).toHaveCount(0);
    await mocks.assertIsolated();
  });

  test("launch view still activates inactive services and deactivates active ones", async ({
    page,
  }) => {
    const mocks = await gotoCatalog(page);
    const inactiveRow = page.getByRole("listitem").filter({ hasText: "Tutoring (inactive)" });
    await inactiveRow.getByRole("button", { name: "Activate for launch" }).click();
    await expect.poll(async () => (await mocks.getCalls()).servicePatches.length).toBe(1);
    expect((await mocks.getCalls()).servicePatches[0]).toMatchObject({
      id: "svc-tutor",
      patch: { is_active: true },
    });

    const activeRow = page.getByRole("listitem").filter({ hasText: "Babysitting" }).first();
    await activeRow.getByRole("button", { name: "Deactivate for launch" }).click();
    await confirmDeactivate(page, "Deactivate for launch");
    await expect.poll(async () => (await mocks.getCalls()).servicePatches.length).toBe(2);
    expect((await mocks.getCalls()).servicePatches[1]).toMatchObject({
      id: "svc-sit",
      patch: { is_active: false },
    });
    await mocks.assertIsolated();
  });

  test("mutation failure surfaces mock error text and keeps persisted inactive badge", async ({
    page,
  }) => {
    const mocks = await installIssue68Mocks(page, {
      scenario: "admin-services-catalog",
      adminCatalogToggleFail: true,
    });
    await page.goto("/admin-services-catalog");
    const row = page.getByRole("listitem").filter({ hasText: "Tutoring (inactive)" });
    await row.getByRole("button", { name: "Activate for launch" }).click();
    // Harness returns a fixed English PostgREST-style message; not i18n-translated in this mock.
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
