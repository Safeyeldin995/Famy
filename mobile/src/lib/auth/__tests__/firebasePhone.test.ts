import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockConfirm = vi.fn();
const mockSignInWithPhoneNumber = vi.fn();
const mockOnAuthStateChanged = vi.fn(() => () => {});
const mockSignOut = vi.fn(async () => {});
const mockGetAuth = vi.fn();

vi.mock("@react-native-firebase/auth", () => ({
  getAuth: (...args: unknown[]) => mockGetAuth(...args),
  signInWithPhoneNumber: (...args: unknown[]) => mockSignInWithPhoneNumber(...args),
  onAuthStateChanged: (...args: unknown[]) => mockOnAuthStateChanged(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
}));

const firebasePhonePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../firebasePhone.ts",
);

async function loadFirebasePhone() {
  vi.resetModules();
  return import("../firebasePhone");
}

describe("native Firebase phone auth (v27 modular exports)", () => {
  beforeEach(() => {
    mockConfirm.mockReset();
    mockSignInWithPhoneNumber.mockReset();
    mockOnAuthStateChanged.mockReset();
    mockSignOut.mockReset();
    mockGetAuth.mockReset();
    mockOnAuthStateChanged.mockReturnValue(() => {});
    mockSignOut.mockResolvedValue(undefined);
  });

  it("send → confirm returns idToken when getAuth and signInWithPhoneNumber succeed", async () => {
    const phone = "+201012345678";
    const auth = { currentUser: null };
    mockGetAuth.mockReturnValue(auth);
    mockSignInWithPhoneNumber.mockResolvedValue({ confirm: mockConfirm });
    mockConfirm.mockResolvedValue({
      user: {
        phoneNumber: phone,
        getIdToken: async () => "firebase-id-token",
      },
    });

    const mod = await loadFirebasePhone();
    const send = await mod.sendNativeFirebasePhoneOtp(phone);
    expect(send).toEqual({ ok: true });
    expect(mockSignInWithPhoneNumber).toHaveBeenCalledWith(auth, phone);

    const confirm = await mod.confirmNativeFirebasePhoneOtp("123456", phone);
    expect(confirm).toEqual({ ok: true, idToken: "firebase-id-token" });
  });

  it("returns unavailable only when getAuth throws", async () => {
    mockGetAuth.mockImplementation(() => {
      throw Object.assign(new Error("Firebase app not configured"), { code: "no-app" });
    });

    const mod = await loadFirebasePhone();
    const send = await mod.sendNativeFirebasePhoneOtp("+201012345678");
    expect(send).toEqual({ ok: false, code: "unavailable" });
  });
});

describe("firebasePhone source guard", () => {
  it("does not read .default from @react-native-firebase/auth", () => {
    const src = fs.readFileSync(firebasePhonePath, "utf8");
    expect(src).not.toMatch(/require\("@react-native-firebase\/auth"\)\.default/);
    expect(src).not.toMatch(/from "@react-native-firebase\/auth";\s*\n.*\.default/s);
    expect(src).toContain("getAuth");
  });
});
