import { test, expect, expectNoErrors } from "./fixtures";
import { captureErrors, type CapturedErrors } from "../../tests/helpers";
import { LOCAL_CI_USERS } from "../fixtures.mjs";

test.describe.serial("guest", () => {
  let profileErrors: CapturedErrors = { console: [], network: [] };

  test("browses online tutors without an account and opens a tutor profile", async ({ page, errors }) => {
    await page.goto("/online/tutors");
    const tutor = page.getByRole("link", { name: new RegExp(LOCAL_CI_USERS.tutor.fullName) }).first();
    await expect(tutor).toBeVisible();
    expectNoErrors(errors);

    errors.stopCapture();
    const onProfile = captureErrors(page);
    await tutor.click();
    await expect(page).toHaveURL(/\/online\/tutors\/[0-9a-f-]{36}/);
    await expect(page.getByRole("heading", { name: LOCAL_CI_USERS.tutor.fullName })).toBeVisible();
    await expect(page.getByRole("link", { name: "اطلب درس" }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "تقييمات الطلبة" })).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    profileErrors = onProfile.readErrors();
  });

  // Product bug https://github.com/Safeyeldin995/Famy/issues/565: anon cannot run has_role() inside reviews_public_read.
  test.fixme("the tutor profile loads its reviews for a guest with no failed requests", () => {
    expect(profileErrors.network).toEqual([]);
    expect(profileErrors.console).toEqual([]);
  });
});
