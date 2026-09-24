import { expect } from "@playwright/test";
import { MOCK_USER_ID } from "../../issue68-host/constants.mjs";

function b64url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function mockSession() {
  const accessToken = `${b64url({ alg: "none", typ: "JWT" })}.${b64url({
    sub: MOCK_USER_ID,
    role: "authenticated",
    aud: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.x`;
  return {
    access_token: accessToken,
    refresh_token: "issue68-mock-refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: MOCK_USER_ID,
      aud: "authenticated",
      role: "authenticated",
      email: "issue68@famio.local",
      phone: "201026868002",
    },
  };
}

function isLocalUrl(url) {
  return (
    url === "about:blank" ||
    url.startsWith("http://127.0.0.1:") ||
    url.startsWith("http://localhost:") ||
    url.startsWith("https://127.0.0.1:") ||
    url.startsWith("https://localhost:") ||
    url.startsWith("ws://127.0.0.1:") ||
    url.startsWith("ws://localhost:") ||
    url.startsWith("blob:") ||
    url.startsWith("data:")
  );
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{
 *   providerDelayMs?: number;
 *   snapshotDelayMs?: number;
 *   lang?: "en" | "ar";
 *   scenario?: "default" | "returning" | "new-provider" | "saved-data-error";
 * }} [options]
 */
export async function installIssue68Mocks(page, options = {}) {
  const blockedExternal = [];
  const lang = options.lang === "ar" ? "ar" : "en";

  await page.request.post("/__issue68/config", {
    data: {
      snapshotDelayMs: options.snapshotDelayMs ?? 0,
      providerDelayMs: options.providerDelayMs ?? 0,
      scenario: options.scenario ?? "default",
    },
  });

  await page.addInitScript(
    ({ session, nextLang }) => {
      localStorage.setItem("sb-127-auth-token", JSON.stringify(session));
      localStorage.setItem("famio.lang", nextLang);
    },
    { session: mockSession(), nextLang: lang },
  );

  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (isLocalUrl(url)) {
      await route.continue();
      return;
    }
    blockedExternal.push(url);
    await route.abort("blockedbyclient");
  });

  return {
    getBlockedExternal: () => [...blockedExternal],
    async getCalls() {
      return page.request.get("/__issue68/calls").then((res) => res.json());
    },
    async getNetwork() {
      return page.request.get("/__issue68/network").then((res) => res.json());
    },
    async assertIsolated() {
      const network = await page.request.get("/__issue68/network").then((res) => res.json());
      expect(blockedExternal, blockedExternal.join("\n")).toEqual([]);
      expect(network.unexpected, network.unexpected.join("\n")).toEqual([]);
    },
  };
}

export async function waitForSnapshotAndProvider(page) {
  await expect
    .poll(async () => {
      const calls = await page.request.get("/__issue68/calls").then((res) => res.json());
      return calls.snapshot >= 1 && calls.provider >= 1;
    })
    .toBe(true);
}

export async function gotoOnboardingHarness(page, impl = "current", lang = "en") {
  await page.goto(`/onboarding?impl=${impl}`);
  const legalName =
    lang === "ar"
      ? page.getByRole("textbox", { name: "الاسم القانوني الكامل" })
      : page.getByRole("textbox", { name: "Full legal name" });
  await legalName.waitFor({ state: "visible", timeout: 15_000 });
  await waitForSnapshotAndProvider(page);
  await page.waitForFunction(() => {
    const labels = ["Experience", "الخبرة"];
    const btn = [...document.querySelectorAll("button")].find((node) =>
      labels.includes(node.textContent?.trim() ?? ""),
    );
    return Boolean(btn && Object.keys(btn).some((key) => key.startsWith("__reactProps")));
  });
  return legalName;
}

export async function openExperienceStep(page, impl = "current", lang = "en") {
  await gotoOnboardingHarness(page, impl, lang);
  const experienceName = lang === "ar" ? "الخبرة" : "Experience";
  await page.getByRole("button", { name: experienceName, exact: true }).click();
  await page.locator('input[type="number"]').first().waitFor({ state: "visible", timeout: 15_000 });
}

export async function gotoProOnboardingRoute(page) {
  await page.goto("/pro/onboarding");
}

export async function openOnboardingStep(page, name) {
  await page.getByRole("button", { name, exact: true }).click();
}

export const QA_AVATAR_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBUQEBAVFRUVFRUVFRUVFRUVFRUWFxUVFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGxAQGy0lHyUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBIgACEQEDEQH/xAAXAAEBAQEAAAAAAAAAAAAAAAAAAQID/8QAFhEBAQEAAAAAAAAAAAAAAAAAAAER/9oADAMBAAIQAxAAAAG6P//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//Z",
  "base64",
);
