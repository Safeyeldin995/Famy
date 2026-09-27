import { test, expect } from "@playwright/test";
import { EXISTING_COORDS, EXISTING_ADDRESS_ID } from "../../issue70-host/constants.mjs";
import {
  PIN_COORDS,
  clickContinue,
  fillRequiredSetupFields,
  installIssue70Mocks,
  waitForSetupForm,
} from "./mock-supabase.mjs";

function addressWrites(calls) {
  return (calls.writes ?? []).filter((write) => write.table === "addresses");
}

test.describe("Issue #70 signed-in /setup address browser harness", () => {
  test("records HEAD, product hashes, and the SSR/hydration coverage gap", async ({ request }) => {
    const identity = await request.get("/__issue70/identity").then((res) => res.json());
    expect(identity.head).toMatch(/^[a-f0-9]{40}$/);
    expect(identity.ssrHydrationCoverage.covered).toBe(false);
    expect(identity.ssrHydrationCoverage.reason).toMatch(/does not boot TanStack Start SSR/);
    expect(identity.productPaths).toEqual([
      "src/routes/setup.tsx",
      "src/components/famio/AuthGate.tsx",
      "src/components/famio/LocationPicker.tsx",
      "src/lib/auth/useRequireAuth.ts",
      "src/lib/db/queries.ts",
    ]);
    for (const rel of identity.productPaths) {
      expect(identity.hashes[rel], rel).toMatch(/^[a-f0-9]{64}$/);
    }
    console.log(`[issue70-identity] HEAD ${identity.head}`);
    console.log(
      `[issue70-identity] ssrHydrationCoverage ${JSON.stringify(identity.ssrHydrationCoverage)}`,
    );
    console.log(`[issue70-identity] hashes ${JSON.stringify(identity.hashes)}`);
  });

  test("signed-in full navigation loads the real setup form", async ({ page }) => {
    const mocks = await installIssue70Mocks(page, { scenario: "new-address" });
    await page.goto("/setup");
    await waitForSetupForm(page);
    await expect(page.getByTestId("issue70-setup-host")).toBeVisible();
    await expect(page.getByText("Location on map")).toBeVisible();
    await expect(page.getByRole("button", { name: "Use current location" })).toBeVisible();
    await expect(page.getByTestId("issue70-login")).toHaveCount(0);
    const calls = await mocks.getCalls();
    expect(calls.profileReads).toBeGreaterThanOrEqual(1);
    expect(calls.addressReads).toBeGreaterThanOrEqual(1);
    expect(calls.settingsReads).toBeGreaterThanOrEqual(1);
    await mocks.assertIsolated();
  });

  test("signed-out navigation redirects to login without protected setup content", async ({
    page,
  }) => {
    const mocks = await installIssue70Mocks(page, { scenario: "signed-out", signedIn: false });
    await page.goto("/setup");
    await expect(page.getByTestId("issue70-login")).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText("Complete your profile")).toHaveCount(0);
    await expect(page.getByPlaceholder("Sarah Mostafa")).toHaveCount(0);
    await expect(page.getByPlaceholder("Street, landmark, gate number…")).toHaveCount(0);
    await expect(page.getByText("Location on map")).toHaveCount(0);
    await mocks.assertIsolated();
  });

  test("new address with a selected pin sends exact coordinates and navigates only after save", async ({
    page,
  }) => {
    const mocks = await installIssue70Mocks(page, { scenario: "new-address", saveDelayMs: 800 });
    await page.goto("/setup");
    await waitForSetupForm(page);
    expect(await mocks.geoCalls()).toBe(0);

    await fillRequiredSetupFields(page, { name: "Amira Adel", address: "House 22, Palm Hills" });
    await page.getByRole("button", { name: "Use current location" }).click();
    await expect(
      page.getByText(`${PIN_COORDS.lat.toFixed(6)}, ${PIN_COORDS.lng.toFixed(6)}`),
    ).toBeVisible();
    expect(await mocks.geoCalls()).toBe(1);

    await clickContinue(page);
    await expect(page.getByTestId("issue70-home")).toHaveCount(0);
    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.getByText("Saving…")).toBeVisible();

    await expect(page.getByTestId("issue70-home")).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/home$/);

    const calls = await mocks.getCalls();
    const inserts = addressWrites(calls).filter((write) => write.method === "POST");
    const updates = addressWrites(calls).filter((write) => write.method === "PATCH");
    expect(inserts).toHaveLength(1);
    expect(updates).toHaveLength(0);
    expect(inserts[0].body.lat).toBe(PIN_COORDS.lat);
    expect(inserts[0].body.lng).toBe(PIN_COORDS.lng);
    expect(inserts[0].body.street).toBe("House 22, Palm Hills");
    expect(inserts[0].body.line1).toBe("House 22, Palm Hills");
    expect(inserts[0].body.area).toBe("Sheikh Zayed");
    expect(inserts[0].body.city).toBe("Giza");
    expect(inserts[0].body.user_id).toBeTruthy();
    expect(inserts[0].body.is_default).toBe(true);
    expect(calls.createdCount).toBe(1);
    expect(calls.updatedCount).toBe(0);
    await mocks.assertIsolated();
  });

  test("existing default address prefills fields and pin, then updates the same id", async ({
    page,
  }) => {
    const mocks = await installIssue70Mocks(page, { scenario: "existing-address" });
    await page.goto("/setup");
    await waitForSetupForm(page);

    await expect(page.getByPlaceholder("Sarah Mostafa")).toHaveValue("Nour Hassan");
    await expect(page.getByPlaceholder("Street, landmark, gate number…")).toHaveValue(
      "Villa 8, Allegria Gate 4",
    );
    await expect(page.getByPlaceholder("Allegria, Sheikh Zayed")).toHaveValue("Allegria");
    await expect(page.getByPlaceholder("Villa 12")).toHaveValue("Villa 8");
    await expect(page.getByPlaceholder("Apt 3B (optional)")).toHaveValue("1");
    await expect(
      page.getByPlaceholder("Anything we should know? (Gate code, dogs, etc.)"),
    ).toHaveValue("Call on arrival");
    await expect(page.getByRole("button", { name: "Sheikh Zayed", exact: true })).toHaveClass(
      /border-brand/,
    );
    await expect(
      page.getByText(`${EXISTING_COORDS.lat.toFixed(6)}, ${EXISTING_COORDS.lng.toFixed(6)}`),
    ).toBeVisible();

    await page
      .getByPlaceholder("Street, landmark, gate number…")
      .fill("Villa 8, Allegria Gate 4 - revised");
    const continueHit = await page.getByRole("button", { name: "Continue" }).evaluate((el) => {
      const box = el.getBoundingClientRect();
      const node = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return { tag: node?.tagName ?? "", text: node?.textContent?.trim() ?? "" };
    });
    expect(
      continueHit.tag,
      "Continue must remain the hit target after editing a field above the map",
    ).toBe("BUTTON");
    expect(continueHit.text).toBe("Continue");
    await clickContinue(page);
    await expect(page.getByTestId("issue70-home")).toBeVisible({ timeout: 15_000 });

    const calls = await mocks.getCalls();
    const inserts = addressWrites(calls).filter((write) => write.method === "POST");
    const updates = addressWrites(calls).filter((write) => write.method === "PATCH");
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe(EXISTING_ADDRESS_ID);
    expect(updates[0].body.street).toBe("Villa 8, Allegria Gate 4 - revised");
    expect(updates[0].body.lat).toBe(EXISTING_COORDS.lat);
    expect(updates[0].body.lng).toBe(EXISTING_COORDS.lng);
    expect(calls.createdCount).toBe(0);
    expect(calls.updatedCount).toBe(1);
    await mocks.assertIsolated();
  });

  test("save without a pin is allowed and sends null coordinates", async ({ page }) => {
    const mocks = await installIssue70Mocks(page, { scenario: "new-address" });
    await page.goto("/setup");
    await waitForSetupForm(page);
    expect(await mocks.geoCalls()).toBe(0);
    await expect(page.getByText("No location set yet")).toBeVisible();
    await expect(
      page.getByText("Without a pinned location, this address can't be used to book a service."),
    ).toBeVisible();

    await fillRequiredSetupFields(page, { address: "Building 5, no pin" });
    await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
    await clickContinue(page);
    await expect(page.getByTestId("issue70-home")).toBeVisible({ timeout: 15_000 });

    const calls = await mocks.getCalls();
    const inserts = addressWrites(calls).filter((write) => write.method === "POST");
    expect(inserts).toHaveLength(1);
    expect(inserts[0].body.lat).toBeNull();
    expect(inserts[0].body.lng).toBeNull();
    expect(inserts[0].body.street).toBe("Building 5, no pin");
    expect(await mocks.geoCalls()).toBe(0);
    await mocks.assertIsolated();
  });

  test("delayed address loading cannot create a duplicate", async ({ page }) => {
    const mocks = await installIssue70Mocks(page, {
      scenario: "existing-address-delayed",
      addressDelayMs: 1800,
    });
    await page.goto("/setup");
    await expect(page.getByTestId("issue70-setup-host")).toBeVisible();
    await expect(page.getByPlaceholder("Sarah Mostafa")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);

    await waitForSetupForm(page);
    await expect(page.getByPlaceholder("Street, landmark, gate number…")).toHaveValue(
      "Villa 8, Allegria Gate 4",
    );
    await page.getByPlaceholder("Street, landmark, gate number…").fill("Villa 8 delayed edit");
    await clickContinue(page);
    await expect(page.getByTestId("issue70-home")).toBeVisible({ timeout: 15_000 });

    const calls = await mocks.getCalls();
    const inserts = addressWrites(calls).filter((write) => write.method === "POST");
    const updates = addressWrites(calls).filter((write) => write.method === "PATCH");
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe(EXISTING_ADDRESS_ID);
    expect(updates[0].body.street).toBe("Villa 8 delayed edit");
    expect(calls.createdCount).toBe(0);
    expect(calls.updatedCount).toBe(1);
    await mocks.assertIsolated();
  });

  test("failed saves retain inputs and do not navigate", async ({ page }) => {
    const mocks = await installIssue70Mocks(page, { scenario: "save-fail", saveShouldFail: true });
    await page.goto("/setup");
    await waitForSetupForm(page);
    await fillRequiredSetupFields(page, { name: "Kept Name", address: "Kept Street 99" });
    await page.getByPlaceholder("Villa 12").fill("Villa Kept");
    await clickContinue(page);

    await expect(page.getByText("Could not save address")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("issue70-home")).toHaveCount(0);
    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.getByPlaceholder("Sarah Mostafa")).toHaveValue("Kept Name");
    await expect(page.getByPlaceholder("Street, landmark, gate number…")).toHaveValue(
      "Kept Street 99",
    );
    await expect(page.getByPlaceholder("Villa 12")).toHaveValue("Villa Kept");
    await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();

    const calls = await mocks.getCalls();
    expect(addressWrites(calls).length).toBeGreaterThanOrEqual(1);
    expect(calls.createdCount).toBe(0);
    expect(calls.updatedCount).toBe(0);
    await mocks.assertIsolated();
  });
});
