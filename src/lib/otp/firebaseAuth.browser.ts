import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  PhoneAuthProvider,
  RecaptchaVerifier,
  signInWithCredential,
  signInWithPhoneNumber,
  signOut,
  type Auth,
  type ConfirmationResult,
} from "firebase/auth";

type FirebaseClientConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
};

const VERIFICATION_ID_STORAGE_KEY = "famy.firebase.verificationId";
export const FIREBASE_RECAPTCHA_CONTAINER_ID = "firebase-recaptcha";
/** Firebase reCAPTCHA must not use display:none — it breaks widget layout callbacks. */
export const FIREBASE_RECAPTCHA_CONTAINER_CLASS =
  "pointer-events-none fixed left-0 top-0 h-px w-px overflow-hidden opacity-0";

export class FirebaseClientConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FirebaseClientConfigurationError";
  }
}

export class FirebasePhoneVerificationSessionError extends Error {
  readonly code: "session_lost" | "not_started";

  constructor(message: string, code: "session_lost" | "not_started") {
    super(message);
    this.name = "FirebasePhoneVerificationSessionError";
    this.code = code;
  }
}

export function readFirebaseClientConfig(
  env: Record<string, string | undefined> = import.meta.env,
): FirebaseClientConfig {
  const apiKey = env.VITE_FIREBASE_API_KEY?.trim();
  const authDomain = env.VITE_FIREBASE_AUTH_DOMAIN?.trim();
  const projectId = env.VITE_FIREBASE_PROJECT_ID?.trim();
  const storageBucket = env.VITE_FIREBASE_STORAGE_BUCKET?.trim();
  const messagingSenderId = env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim();
  const appId = env.VITE_FIREBASE_APP_ID?.trim();

  if (!apiKey)
    throw new FirebaseClientConfigurationError("VITE_FIREBASE_API_KEY is not configured");
  if (!authDomain)
    throw new FirebaseClientConfigurationError("VITE_FIREBASE_AUTH_DOMAIN is not configured");
  if (!projectId)
    throw new FirebaseClientConfigurationError("VITE_FIREBASE_PROJECT_ID is not configured");
  if (!storageBucket) {
    throw new FirebaseClientConfigurationError("VITE_FIREBASE_STORAGE_BUCKET is not configured");
  }
  if (!messagingSenderId) {
    throw new FirebaseClientConfigurationError(
      "VITE_FIREBASE_MESSAGING_SENDER_ID is not configured",
    );
  }
  if (!appId) throw new FirebaseClientConfigurationError("VITE_FIREBASE_APP_ID is not configured");

  return { apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId };
}

let firebaseApp: FirebaseApp | undefined;
let firebaseAuth: Auth | undefined;
let recaptchaVerifier: RecaptchaVerifier | undefined;
let recaptchaContainerNode: HTMLElement | undefined;
let confirmationResult: ConfirmationResult | undefined;

function getSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function persistVerificationId(verificationId: string): void {
  const storage = getSessionStorage();
  if (!storage) return;
  try {
    storage.setItem(VERIFICATION_ID_STORAGE_KEY, verificationId);
  } catch {
    // Fail-soft: in-memory confirmationResult still works for this page load.
  }
}

function readStoredVerificationId(): string | null {
  const storage = getSessionStorage();
  if (!storage) return null;
  try {
    return storage.getItem(VERIFICATION_ID_STORAGE_KEY);
  } catch {
    return null;
  }
}

function clearStoredVerificationId(): void {
  const storage = getSessionStorage();
  if (!storage) return;
  try {
    storage.removeItem(VERIFICATION_ID_STORAGE_KEY);
  } catch {
    // Fail-soft: verified token must still be returned to the caller.
  }
}

export function hasFirebasePhoneVerificationSession(): boolean {
  if (typeof window === "undefined") return false;
  if (confirmationResult) return true;
  return !!readStoredVerificationId();
}

export function clearFirebasePhoneVerificationSession(): void {
  confirmationResult = undefined;
  if (typeof window !== "undefined") {
    clearStoredVerificationId();
  }
}

export function getFirebaseAuthApp(): Auth {
  if (firebaseAuth) return firebaseAuth;
  const config = readFirebaseClientConfig();
  firebaseApp = getApps().length > 0 ? getApps()[0]! : initializeApp(config);
  firebaseAuth = getAuth(firebaseApp);
  return firebaseAuth;
}

function resolveFirebaseAuthLanguage(languageCode?: string): string {
  if (languageCode?.toLowerCase().startsWith("ar")) return "ar";
  return "en";
}

function getRecaptchaContainer(containerId: string): HTMLElement {
  const container = document.getElementById(containerId);
  if (!container) {
    throw new Error(`Missing Firebase reCAPTCHA container #${containerId}`);
  }
  return container;
}

function hasRecaptchaContainerElement(containerId: string): boolean {
  return document.getElementById(containerId) !== null;
}

function isRecaptchaVerifierBoundToContainer(containerId: string): boolean {
  if (!recaptchaVerifier || !recaptchaContainerNode) return false;
  const currentContainer = document.getElementById(containerId);
  if (!currentContainer) return false;
  if (currentContainer !== recaptchaContainerNode) return false;
  const body = document.body;
  if (!body || typeof body.contains !== "function") return true;
  return body.contains(currentContainer);
}

function logFirebaseSendClient(
  outcome: "start" | "success" | "failure",
  details: Record<string, string | boolean | undefined> = {},
): void {
  if (outcome === "failure") {
    console.error("[otp.firebase.send.client]", { outcome, ...details });
    return;
  }
  console.info("[otp.firebase.send.client]", { outcome, ...details });
}

function sanitizeFirebaseClientError(error: unknown): {
  errorName?: string;
  code?: string;
  message?: string;
} {
  const errorName = error instanceof Error ? error.name : "Error";
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: string }).code ?? "")
      : undefined;
  const message =
    error instanceof Error ? error.message.slice(0, 120) : String(error).slice(0, 120);
  return {
    errorName,
    code: code || undefined,
    message,
  };
}

function logFirebaseVerifyClient(
  outcome: "start" | "success" | "failure",
  details: Record<string, string | boolean | undefined> = {},
): void {
  if (outcome === "failure") {
    console.error("[otp.firebase.verify.client]", { outcome, ...details });
    return;
  }
  console.info("[otp.firebase.verify.client]", { outcome, ...details });
}

async function clearRecaptchaVerifier(): Promise<void> {
  if (!recaptchaVerifier) return;
  try {
    await recaptchaVerifier.clear();
  } catch {
    // Widget may already be torn down with its container.
  }
  recaptchaVerifier = undefined;
  recaptchaContainerNode = undefined;
}

export async function ensureInvisibleRecaptcha(
  containerId = FIREBASE_RECAPTCHA_CONTAINER_ID,
): Promise<void> {
  if (typeof window === "undefined") return;
  const auth = getFirebaseAuthApp();
  if (recaptchaVerifier && isRecaptchaVerifierBoundToContainer(containerId)) {
    return;
  }

  await clearRecaptchaVerifier();
  const containerNode = getRecaptchaContainer(containerId);
  recaptchaContainerNode = containerNode;
  recaptchaVerifier = new RecaptchaVerifier(auth, containerNode, {
    size: "invisible",
  });
  await recaptchaVerifier.render();
}

export async function sendFirebasePhoneOtp(
  phoneE164: string,
  options: { containerId?: string; languageCode?: string } = {},
): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("Firebase phone OTP can only run in the browser");
  }
  const containerId = options.containerId ?? FIREBASE_RECAPTCHA_CONTAINER_ID;
  const auth = getFirebaseAuthApp();
  auth.languageCode = resolveFirebaseAuthLanguage(options.languageCode);

  logFirebaseSendClient("start", {
    containerMounted: hasRecaptchaContainerElement(containerId),
    verifierCached: Boolean(recaptchaVerifier),
  });

  try {
    await ensureInvisibleRecaptcha(containerId);
    if (!recaptchaVerifier) {
      throw new Error("Firebase reCAPTCHA is not ready");
    }
    confirmationResult = await signInWithPhoneNumber(auth, phoneE164, recaptchaVerifier);
    persistVerificationId(confirmationResult.verificationId);
    logFirebaseSendClient("success");
  } catch (error) {
    logFirebaseSendClient("failure", sanitizeFirebaseClientError(error));
    await clearRecaptchaVerifier();
    throw error;
  }
}

async function completeFirebasePhoneVerification(code: string): Promise<string> {
  const auth = getFirebaseAuthApp();
  const trimmedCode = code.trim();
  const usingConfirmationResult = Boolean(confirmationResult);
  const hasStoredVerificationId = Boolean(readStoredVerificationId());

  logFirebaseVerifyClient("start", {
    path: usingConfirmationResult ? "confirmation_result" : "session_storage",
    hasStoredVerificationId,
  });

  try {
    if (confirmationResult) {
      const credential = await confirmationResult.confirm(trimmedCode);
      const idToken = await credential.user.getIdToken();
      await signOut(auth);
      confirmationResult = undefined;
      clearStoredVerificationId();
      logFirebaseVerifyClient("success", { path: "confirmation_result" });
      return idToken;
    }

    const verificationId = readStoredVerificationId();
    if (!verificationId) {
      throw new FirebasePhoneVerificationSessionError(
        "Firebase phone verification session expired",
        "session_lost",
      );
    }

    const credential = PhoneAuthProvider.credential(verificationId, trimmedCode);
    const userCredential = await signInWithCredential(auth, credential);
    const idToken = await userCredential.user.getIdToken();
    await signOut(auth);
    confirmationResult = undefined;
    clearStoredVerificationId();
    logFirebaseVerifyClient("success", { path: "session_storage" });
    return idToken;
  } catch (error) {
    if (
      error instanceof FirebasePhoneVerificationSessionError &&
      (error.code === "session_lost" || error.code === "not_started")
    ) {
      logFirebaseVerifyClient("failure", {
        path: usingConfirmationResult ? "confirmation_result" : "session_storage",
        reason: error.code,
      });
      throw error;
    }
    logFirebaseVerifyClient("failure", {
      path: usingConfirmationResult ? "confirmation_result" : "session_storage",
      ...sanitizeFirebaseClientError(error),
    });
    throw error;
  }
}

export async function confirmFirebasePhoneOtp(code: string): Promise<string> {
  if (!confirmationResult && !readStoredVerificationId()) {
    throw new FirebasePhoneVerificationSessionError(
      "Firebase phone verification has not started",
      "not_started",
    );
  }
  return completeFirebasePhoneVerification(code);
}

export async function resetFirebasePhoneOtpSessionForTests(): Promise<void> {
  await clearRecaptchaVerifier();
  confirmationResult = undefined;
  firebaseAuth = undefined;
  firebaseApp = undefined;
  if (typeof window !== "undefined") {
    clearStoredVerificationId();
  }
}
