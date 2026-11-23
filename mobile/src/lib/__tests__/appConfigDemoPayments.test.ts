import { describe, expect, it, afterEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const mobileRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const appConfigPath = path.join(mobileRoot, "app.config.js");
const appJson = require(path.join(mobileRoot, "app.json")).expo;

describe("app.config.js demo payments build guard", () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
    delete require.cache[appConfigPath];
  });

  it("forces EXPO_PUBLIC_DEMO_PAYMENTS off for production profile", () => {
    process.env.EAS_BUILD_PROFILE = "production";
    process.env.EXPO_PUBLIC_DEMO_PAYMENTS = "1";
    const build = require(appConfigPath);
    build({ config: appJson });
    expect(process.env.EXPO_PUBLIC_DEMO_PAYMENTS).toBe("0");
    expect(process.env.EXPO_PUBLIC_DEMO_PAYMENTS_BUILD_DISABLED).toBe("1");
  });

  it("does not force preview builds off", () => {
    process.env.EAS_BUILD_PROFILE = "preview";
    process.env.EXPO_PUBLIC_DEMO_PAYMENTS = "1";
    delete process.env.EXPO_PUBLIC_DEMO_PAYMENTS_BUILD_DISABLED;
    const build = require(appConfigPath);
    build({ config: appJson });
    expect(process.env.EXPO_PUBLIC_DEMO_PAYMENTS).toBe("1");
    expect(process.env.EXPO_PUBLIC_DEMO_PAYMENTS_BUILD_DISABLED).toBeUndefined();
  });
});