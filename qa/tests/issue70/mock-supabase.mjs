import { expect } from "@playwright/test";
import {
  EXISTING_COORDS,
  MOCK_USER_ID,
  PIN_COORDS,
  TILE_PNG,
} from "../../issue70-host/constants.mjs";

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
    refresh_token: "issue70-mock-refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: MOCK_USER_ID,
      aud: "authenticated",
      role: "authenticated",
      email: "issue70@famio.local",
      phone: "201001112233",
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

function isOsmTile(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname.endsWith("tile.openstreetmap.org") ||
      parsed.hostname === "tile.openstreetmap.org"
    );
  } catch {
    return false;
  }
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{
 *   scenario?: "new-address" | "existing-address" | "existing-address-delayed" | "signed-out" | "save-fail";
 *   addressDelayMs?: number;
 *   saveDelayMs?: number;
 *   saveShouldFail?: boolean;
 *   signedIn?: boolean;
 *   lang?: "en" | "ar";
 * }} [options]
 */
export async function installIssue70Mocks(page, options = {}) {
  const blockedExternal = [];
  const mockedTiles = [];
  const lang = options.lang === "ar" ? "ar" : "en";
  const signedIn = options.signedIn !== false && options.scenario !== "signed-out";
  const scenario = options.scenario ?? (signedIn ? "new-address" : "signed-out");

  await page.request.post("/__issue70/config", {
    data: {
      scenario,
      addressDelayMs: options.addressDelayMs ?? 0,
      saveDelayMs: options.saveDelayMs ?? 0,
      saveShouldFail: options.saveShouldFail ?? false,
    },
  });

  await page.addInitScript(
    ({ session, nextLang, pin, signedIn: hasSession }) => {
      window.__issue70Geo = { calls: 0, lastOptions: null, coords: pin };
      const geo = {
        getCurrentPosition(success, _error, positionOptions) {
          window.__issue70Geo.calls += 1;
          window.__issue70Geo.lastOptions = positionOptions || null;
          queueMicrotask(() => {
            success({
              coords: {
                latitude: window.__issue70Geo.coords.lat,
                longitude: window.__issue70Geo.coords.lng,
                accuracy: 8,
                altitude: null,
                altitudeAccuracy: null,
                heading: null,
                speed: null,
              },
              timestamp: Date.now(),
            });
          });
        },
        watchPosition() {
          return 0;
        },
        clearWatch() {},
      };
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: geo,
      });
      localStorage.setItem("famio.lang", nextLang);
      if (hasSession) {
        localStorage.setItem("sb-127-auth-token", JSON.stringify(session));
      } else {
        localStorage.removeItem("sb-127-auth-token");
      }
    },
    { session: mockSession(), nextLang: lang, pin: PIN_COORDS, signedIn },
  );

  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (isOsmTile(url)) {
      mockedTiles.push(url);
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: TILE_PNG,
        headers: { "cache-control": "no-store" },
      });
      return;
    }
    if (isLocalUrl(url)) {
      await route.continue();
      return;
    }
    blockedExternal.push(url);
    await route.abort("blockedbyclient");
  });

  return {
    getBlockedExternal: () => [...blockedExternal],
    getMockedTiles: () => [...mockedTiles],
    async getCalls() {
      return page.request.get("/__issue70/calls").then((res) => res.json());
    },
    async getNetwork() {
      return page.request.get("/__issue70/network").then((res) => res.json());
    },
    async geoCalls() {
      return page.evaluate(() => window.__issue70Geo?.calls ?? 0);
    },
    async assertIsolated() {
      const network = await page.request.get("/__issue70/network").then((res) => res.json());
      expect(blockedExternal, blockedExternal.join("\n")).toEqual([]);
      expect(network.unexpected, network.unexpected.join("\n")).toEqual([]);
      expect(network.unexpectedWrites, JSON.stringify(network.unexpectedWrites)).toEqual([]);
    },
  };
}

export async function waitForSetupForm(page) {
  await expect(page.getByText("Complete your profile")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByPlaceholder("Sarah Mostafa")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sheikh Zayed", exact: true })).toBeVisible();
}

export async function fillRequiredSetupFields(page, values = {}) {
  const name = values.name ?? "Nour Hassan";
  const address = values.address ?? "Street 12, Gate 3";
  const area = values.area ?? "Sheikh Zayed";
  await page.getByPlaceholder("Sarah Mostafa").fill(name);
  await page.getByRole("button", { name: area, exact: true }).click();
  await page.getByPlaceholder("Street, landmark, gate number…").fill(address);
}

export async function clickContinue(page) {
  const button = page.getByRole("button", { name: "Continue" });
  await expect(button).toBeEnabled();
  // Leaflet's attribution <a href="https://leafletjs.com"> is position:absolute
  // in the real picker. After tiles hydrate it can overlap the sticky action
  // bar. A pointer click, including { force: true }, hits that link and leaves
  // the page on ERR_BLOCKED_BY_CLIENT. Invoke the real button's click() so the
  // product submit handler runs without changing the picker.
  await button.evaluate((el) => {
    if (!(el instanceof HTMLElement)) throw new Error("Continue control is missing");
    el.click();
  });
}

export { EXISTING_COORDS, MOCK_USER_ID, PIN_COORDS };
