import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockConfirm = vi.fn();
const mockGetIdToken = vi.fn();
const mockSignOut = vi.fn().mockResolvedValue(undefined);
const mockSignInWithPhoneNumber = vi.fn();
const mockSignInWithCredential = vi.fn();
const mockRender = vi.fn().mockResolvedValue(undefined);
const mockClear = vi.fn();
let lastRecaptchaContainer: unknown;

vi.mock("firebase/app", () => ({
  initializeApp: vi.fn(() => ({ name: "test-app" })),
  getApps: vi.fn(() => []),
}));

vi.mock("firebase/auth", () => ({
  getAuth: vi.fn(() => ({})),
  RecaptchaVerifier: vi.fn(function RecaptchaVerifierMock(
    this: { render: typeof mockRender; clear: typeof mockClear },
    _auth: unknown,
    container: unknown,
  ) {
    lastRecaptchaContainer = container;
    this.render = mockRender;
    this.clear = mockClear;
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

type TestDomNode = {
  id: string;
  className: string;
  parentNode: unknown;
  detached: boolean;
  remove: () => void;
  setAttribute: (name: string, value: string) => void;
};

function installTestDom() {
  const nodesById = new Map<string, TestDomNode>();
  const attached = new Set<TestDomNode>();

  const body = {
    appendChild(node: TestDomNode) {
      node.parentNode = body;
      node.detached = false;
      attached.add(node);
      if (node.id) nodesById.set(node.id, node);
      return node;
    },
  };

  vi.stubGlobal("document", {
    body,
    getElementById(id: string) {
      const node = nodesById.get(id);
      if (!node || node.detached || !attached.has(node)) return null;
      return node;
    },
    contains(node: TestDomNode) {
      return attached.has(node) && !node.detached;
    },
    createElement() {
      return {
        id: "",
        className: "",
        parentNode: null,
        detached: true,
        remove() {
          this.detached = true;
          attached.delete(this);
          if (this.id) nodesById.delete(this.id);
        },
        setAttribute() {},
      } satisfies TestDomNode;
    },
  });
}

function mountRecaptchaContainer(id = "firebase-recaptcha"): TestDomNode {
  document.getElementById(id)?.remove();
  const container = document.createElement("div") as unknown as TestDomNode;
  container.id = id;
  container.className = "hidden";
  container.setAttribute("aria-hidden", "true");
  document.body.appendChild(container as unknown as Node);
  return container;
}

describe("firebaseAuth.browser sessionStorage fail-soft", () => {
  beforeEach(() => {
    stubFirebaseClientEnv();
    vi.stubGlobal("window", globalThis);
    installTestDom();
    mountRecaptchaContainer();
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

describe("firebaseAuth.browser reCAPTCHA lifecycle", () => {
  beforeEach(() => {
    stubFirebaseClientEnv();
    vi.stubGlobal("window", globalThis);
    installTestDom();
    mockSignInWithPhoneNumber.mockResolvedValue({
      verificationId: "verification-id-123",
      confirm: mockConfirm,
    });
  });

  afterEach(async () => {
    const { resetFirebasePhoneOtpSessionForTests } = await import("../firebaseAuth.browser");
    resetFirebasePhoneOtpSessionForTests();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("rebinds to a new live container after navigation detaches the old node", async () => {
    const containerA = mountRecaptchaContainer();
    const { ensureInvisibleRecaptcha } = await import("../firebaseAuth.browser");

    const { RecaptchaVerifier } = await import("firebase/auth");

    await ensureInvisibleRecaptcha();
    expect(RecaptchaVerifier).toHaveBeenCalledTimes(1);
    expect(lastRecaptchaContainer).toBe(containerA);

    containerA.remove();
    const containerB = mountRecaptchaContainer();

    await ensureInvisibleRecaptcha();
    expect(mockClear).toHaveBeenCalledTimes(1);
    expect(RecaptchaVerifier).toHaveBeenCalledTimes(2);
    expect(lastRecaptchaContainer).toBe(containerB);
  });

  it("throws a typed error when the reCAPTCHA container is missing", async () => {
    const { ensureInvisibleRecaptcha, FirebaseRecaptchaContainerError } = await import(
      "../firebaseAuth.browser"
    );

    await expect(ensureInvisibleRecaptcha("firebase-recaptcha")).rejects.toBeInstanceOf(
      FirebaseRecaptchaContainerError,
    );
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
