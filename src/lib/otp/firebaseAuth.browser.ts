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

export async function ensureInvisibleRecaptcha(containerId = "firebase-recaptcha"): Promise<void> {
  if (typeof window === "undefined") return;
  const auth = getFirebaseAuthApp();
  if (recaptchaVerifier) return;
  recaptchaVerifier = new RecaptchaVerifier(auth, getRecaptchaContainer(containerId), {
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
  const containerId = options.containerId ?? "firebase-recaptcha";
  const auth = getFirebaseAuthApp();
  auth.languageCode = resolveFirebaseAuthLanguage(options.languageCode);
  await ensureInvisibleRecaptcha(containerId);
  if (!recaptchaVerifier) {
    throw new Error("Firebase reCAPTCHA is not ready");
  }
  confirmationResult = await signInWithPhoneNumber(auth, phoneE164, recaptchaVerifier);
  persistVerificationId(confirmationResult.verificationId);
}

async function completeFirebasePhoneVerification(code: string): Promise<string> {
  const auth = getFirebaseAuthApp();

  if (confirmationResult) {
    const credential = await confirmationResult.confirm(code);
    const idToken = await credential.user.getIdToken();
    await signOut(auth);
    confirmationResult = undefined;
    clearStoredVerificationId();
    return idToken;
  }

  const verificationId = readStoredVerificationId();
  if (!verificationId) {
    throw new FirebasePhoneVerificationSessionError(
      "Firebase phone verification session expired",
      "session_lost",
    );
  }

  const credential = PhoneAuthProvider.credential(verificationId, code);
  const userCredential = await signInWithCredential(auth, credential);
  const idToken = await userCredential.user.getIdToken();
  await signOut(auth);
  confirmationResult = undefined;
  clearStoredVerificationId();
  return idToken;
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

export function resetFirebasePhoneOtpSessionForTests(): void {
  recaptchaVerifier = undefined;
  confirmationResult = undefined;
  firebaseAuth = undefined;
  firebaseApp = undefined;
  if (typeof window !== "undefined") {
    clearStoredVerificationId();
  }
}
