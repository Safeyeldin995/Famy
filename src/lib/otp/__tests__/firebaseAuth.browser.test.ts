import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockConfirm = vi.fn();
const mockGetIdToken = vi.fn();
const mockSignOut = vi.fn().mockResolvedValue(undefined);
const mockSignInWithPhoneNumber = vi.fn();
const mockSignInWithCredential = vi.fn();
const mockRender = vi.fn().mockResolvedValue(undefined);

vi.mock("firebase/app", () => ({
  initializeApp: vi.fn(() => ({ name: "test-app" })),
  getApps: vi.fn(() => []),
}));

vi.mock("firebase/auth", () => ({
  getAuth: vi.fn(() => ({})),
  RecaptchaVerifier: vi.fn(function RecaptchaVerifier(this: { render: () => Promise<void> }) {
    this.render = mockRender;
  }),
  signInWithPhoneNumber: (...args: unknown[]) => mockSignInWithPhoneNumber(...args),
  signInWithCredential: (...args: unknown[]) => mockSignInWithCredential(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
  PhoneAuthProvider: {
    credential: vi.fn((verificationId: string, code: string) => ({ verificationId, code })),
  },
}));

function stubFirebaseClientEnv() {
  vi.stubEnv("VITE_FIREBASE_API_KEY", "test-api-key");
  vi.stubEnv("VITE_FIREBASE_AUTH_DOMAIN", "test.firebaseapp.com");
  vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "test-project");
  vi.stubEnv("VITE_FIREBASE_STORAGE_BUCKET", "test-project.appspot.com");
  vi.stubEnv("VITE_FIREBASE_MESSAGING_SENDER_ID", "123456789");
  vi.stubEnv("VITE_FIREBASE_APP_ID", "1:123456789:web:abc");
}

function createThrowingSessionStorage() {
  const throwStorageError = () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  return {
    getItem: vi.fn(throwStorageError),
    setItem: vi.fn(throwStorageError),
    removeItem: vi.fn(throwStorageError),
  };
}

function createMemorySessionStorage() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    store,
  };
}

describe("firebaseAuth.browser sessionStorage fail-soft", () => {
  beforeEach(() => {
    stubFirebaseClientEnv();
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("document", {
      getElementById: vi.fn(() => ({})),
    });
    mockSignInWithPhoneNumber.mockResolvedValue({
      verificationId: "verification-id-123",
      confirm: mockConfirm,
    });
    mockConfirm.mockResolvedValue({
      user: { getIdToken: mockGetIdToken },
    });
    mockGetIdToken.mockResolvedValue("firebase-id-token");
    mockSignInWithCredential.mockResolvedValue({
      user: { getIdToken: mockGetIdToken },
    });
  });

  afterEach(async () => {
    const { resetFirebasePhoneOtpSessionForTests } = await import("../firebaseAuth.browser");
    resetFirebasePhoneOtpSessionForTests();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("completes send even when sessionStorage.setItem throws", async () => {
    const storage = createThrowingSessionStorage();
    vi.stubGlobal("sessionStorage", storage);

    const { sendFirebasePhoneOtp } = await import("../firebaseAuth.browser");
    await expect(sendFirebasePhoneOtp("+201012345678")).resolves.toBeUndefined();
    expect(mockSignInWithPhoneNumber).toHaveBeenCalledOnce();
    expect(storage.setItem).toHaveBeenCalledOnce();
  });

  it("returns the verified token even when sessionStorage.removeItem throws", async () => {
    const storage = createThrowingSessionStorage();
    vi.stubGlobal("sessionStorage", storage);

    const { sendFirebasePhoneOtp, confirmFirebasePhoneOtp } = await import("../firebaseAuth.browser");
    await sendFirebasePhoneOtp("+201012345678");

    await expect(confirmFirebasePhoneOtp("123456")).resolves.toBe("firebase-id-token");
    expect(mockConfirm).toHaveBeenCalledWith("123456");
    expect(storage.removeItem).toHaveBeenCalled();
  });

  it("does not throw from hasFirebasePhoneVerificationSession when storage reads fail", async () => {
    vi.stubGlobal("sessionStorage", createThrowingSessionStorage());

    const { hasFirebasePhoneVerificationSession, sendFirebasePhoneOtp } = await import(
      "../firebaseAuth.browser"
    );

    expect(hasFirebasePhoneVerificationSession()).toBe(false);
    await sendFirebasePhoneOtp("+201012345678");
    expect(hasFirebasePhoneVerificationSession()).toBe(true);
  });

  it("restores verification from sessionStorage after reload when storage works", async () => {
    const storage = createMemorySessionStorage();
    vi.stubGlobal("sessionStorage", storage);

    const {
      sendFirebasePhoneOtp,
      confirmFirebasePhoneOtp,
      resetFirebasePhoneOtpSessionForTests,
      hasFirebasePhoneVerificationSession,
    } = await import("../firebaseAuth.browser");

    await sendFirebasePhoneOtp("+201012345678");
    expect(storage.store.get("famy.firebase.verificationId")).toBe("verification-id-123");

    resetFirebasePhoneOtpSessionForTests();
    storage.store.set("famy.firebase.verificationId", "verification-id-123");

    expect(hasFirebasePhoneVerificationSession()).toBe(true);
    await expect(confirmFirebasePhoneOtp("123456")).resolves.toBe("firebase-id-token");
    expect(mockSignInWithCredential).toHaveBeenCalledOnce();
  });
});

describe("phoneOtpFlow firebase session errors", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/otp/otpProviderConfig");
    vi.doUnmock("@/lib/otp/firebaseAuth.browser");
  });

  it("maps not_started and session_lost to firebase_session_lost", async () => {
    vi.doMock("@/lib/otp/otpProviderConfig", () => ({
      isClientFirebaseOtpProvider: () => true,
    }));

    const { FirebasePhoneVerificationSessionError } = await import("../firebaseAuth.browser");
    const confirmFirebasePhoneOtp = vi
      .fn()
      .mockRejectedValueOnce(
        new FirebasePhoneVerificationSessionError("not started", "not_started"),
      )
      .mockRejectedValueOnce(
        new FirebasePhoneVerificationSessionError("session lost", "session_lost"),
      );

    vi.doMock("@/lib/otp/firebaseAuth.browser", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../firebaseAuth.browser")>();
      return {
        ...actual,
        confirmFirebasePhoneOtp,
      };
    });

    const { verifyPhoneOtpCode } = await import("../phoneOtpFlow");

    await expect(verifyPhoneOtpCode("123456")).resolves.toEqual({
      ok: false,
      error: "firebase_session_lost",
    });
    await expect(verifyPhoneOtpCode("654321")).resolves.toEqual({
      ok: false,
      error: "firebase_session_lost",
    });
  });
});
