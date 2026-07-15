import { test, expect } from "@playwright/test";
import path from "path";
import { supabaseAdmin } from "../admin-client.mjs";

test.use({ storageState: path.resolve(process.cwd(), "qa/.auth/admin.json") });

test("admin can create a polygon zone and it persists after refresh", async ({ page }) => {
  await page.goto("/admin/zones");
  await page.getByRole("button", { name: /new zone/i }).click();

  const nameEn = `QA_zone_${Date.now()}`;
  await page.locator('input[dir="ltr"]').first().fill(nameEn);
  await page.locator('input[dir="rtl"]').first().fill("QA_منطقة_اختبار");

  // Draw a small triangle on the polygon map (default mode).
  const mapBox = page.locator(".leaflet-container").first();
  await mapBox.waitFor({ state: "visible", timeout: 15_000 });
  const box = await mapBox.boundingBox();
  if (!box) throw new Error("map not visible");
  await mapBox.click({ position: { x: box.width * 0.4, y: box.height * 0.3 } });
  await mapBox.click({ position: { x: box.width * 0.6, y: box.height * 0.3 } });
  await mapBox.click({ position: { x: box.width * 0.5, y: box.height * 0.6 } });

  await page.getByRole("button", { name: /^create zone$/i }).click();
  // The create form closes on success (onSuccess: setCreating(false)) — more
  // robust than asserting on the toast, which auto-dismisses.
  await expect(page.getByRole("heading", { name: /new zone/i })).toHaveCount(0, { timeout: 10_000 });

  const { data: zone } = await supabaseAdmin.from("zones").select("*").eq("name_en", nameEn).maybeSingle();
  expect(zone, "zone should exist in DB").toBeTruthy();
  expect(zone!.boundary_type).toBe("polygon");
  expect(Array.isArray(zone!.polygon)).toBe(true);
  expect((zone!.polygon as any[]).length).toBeGreaterThanOrEqual(3);

  await page.reload();
  await expect(page.getByText(nameEn)).toBeVisible({ timeout: 10_000 });

  await supabaseAdmin.from("zones").delete().eq("id", zone!.id);
});
