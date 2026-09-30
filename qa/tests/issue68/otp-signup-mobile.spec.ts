import { test, expect } from "@playwright/test";
import { installIssue68Mocks } from "./mock-supabase.mjs";

test.describe("Issue OTP signup UI — mobile countdown language", () => {
  test("Arabic RTL shows fully localized resend timer at 360px", async ({ page }) => {
    await installIssue68Mocks(page, { lang: "ar" });
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/otp-ui-probe");
    await expect(page.getByTestId("issue68-otp-ui-probe")).toBeVisible();
    await expect(page.getByText(/إعادة الإرسال خلال/i)).toBeVisible();
    await expect(page.getByText(/٢٨ ث/)).toBeVisible();
    await expect(page.getByText(/28s/i)).toHaveCount(0);
  });

  test("English LTR shows localized resend timer at 390px", async ({ page }) => {
    await installIssue68Mocks(page, { lang: "en" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/otp-ui-probe");
    await expect(page.getByText(/Resend code in/i)).toBeVisible();
    await expect(page.getByText(/28 s/)).toBeVisible();
  });
});
