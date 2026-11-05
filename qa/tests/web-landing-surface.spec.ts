import { test, expect } from "@playwright/test";

test.describe("public web surface", () => {
  test("landing renders and legacy login redirects home", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.goto("/login");
    await expect(page).toHaveURL(/\/$/);
  });

  test("staff sign-in page renders", async ({ page }) => {
    await page.goto("/staff");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("admin without session redirects to staff", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/staff$/);
  });
});
