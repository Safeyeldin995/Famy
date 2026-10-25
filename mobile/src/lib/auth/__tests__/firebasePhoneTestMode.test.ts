import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyFirebasePhoneTestModeBeforeSend,
  readFirebasePhoneTestModeConfig,
  shouldDisableAppVerificationForPhone,
} from "../firebasePhoneTestMode";

const easJsonPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../../eas.json");

describe("firebase phone test mode config", () => {
  it("never disables app verification when test mode is off (production-style env)", () => {
    const config = readFirebasePhoneTestModeConfig({
      EXPO_PUBLIC_FIREBASE_TEST_MODE: undefined,
      EXPO_PUBLIC_FIREBASE_TEST_NUMBERS: "+201012345678",
    });
    expect(config.testModeEnabled).toBe(false);
    expect(shouldDisableAppVerificationForPhone("+201012345678", config)).toBe(false);
  });

  it("does not disable app verification for a non-listed number when preview test mode is on", () => {
    const config = readFirebasePhoneTestModeConfig({
      EXPO_PUBLIC_FIREBASE_TEST_MODE: "1",
      EXPO_PUBLIC_FIREBASE_TEST_NUMBERS: "+201011111111",
    });
    expect(shouldDisableAppVerificationForPhone("+201099999999", config)).toBe(false);
  });

  it("disables app verification for a configured test number when preview test mode is on", () => {
    const config = readFirebasePhoneTestModeConfig({
      EXPO_PUBLIC_FIREBASE_TEST_MODE: "1",
      EXPO_PUBLIC_FIREBASE_TEST_NUMBERS: "+201012345678, +201098765432",
    });
    expect(shouldDisableAppVerificationForPhone("+201012345678", config)).toBe(true);
    expect(shouldDisableAppVerificationForPhone("201098765432", config)).toBe(true);
  });

  it("sets auth.settings only for a listed test number during send", () => {
    const auth = { settings: { appVerificationDisabledForTesting: false } };
    const config = readFirebasePhoneTestModeConfig({
      EXPO_PUBLIC_FIREBASE_TEST_MODE: "1",
      EXPO_PUBLIC_FIREBASE_TEST_NUMBERS: "+201012345678",
    });

    applyFirebasePhoneTestModeBeforeSend(auth, "+201099999999", config);
    expect(auth.settings.appVerificationDisabledForTesting).toBe(false);

    applyFirebasePhoneTestModeBeforeSend(auth, "+201012345678", config);
    expect(auth.settings.appVerificationDisabledForTesting).toBe(true);
  });
});

describe("mobile eas.json firebase test mode guard", () => {
  it("sets test mode only on preview/development and never on production", () => {
    const eas = JSON.parse(fs.readFileSync(easJsonPath, "utf8")) as {
      build: Record<string, { env?: Record<string, string> }>;
    };

    expect(eas.build.production?.env?.EXPO_PUBLIC_FIREBASE_TEST_MODE).toBeUndefined();
    expect(eas.build.preview?.env?.EXPO_PUBLIC_FIREBASE_TEST_MODE).toBe("1");
    expect(eas.build.development?.env?.EXPO_PUBLIC_FIREBASE_TEST_MODE).toBe("1");
  });
});
