import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  RecaptchaVerifier,
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

export class FirebaseClientConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FirebaseClientConfigurationError";
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

export function getFirebaseAuthApp(): Auth {
  if (firebaseAuth) return firebaseAuth;
  const config = readFirebaseClientConfig();
  firebaseApp = getApps().length > 0 ? getApps()[0]! : initializeApp(config);
  firebaseAuth = getAuth(firebaseApp);
  return firebaseAuth;
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
  containerId = "firebase-recaptcha",
): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("Firebase phone OTP can only run in the browser");
  }
  await ensureInvisibleRecaptcha(containerId);
  if (!recaptchaVerifier) {
    throw new Error("Firebase reCAPTCHA is not ready");
  }
  confirmationResult = await signInWithPhoneNumber(
    getFirebaseAuthApp(),
    phoneE164,
    recaptchaVerifier,
  );
}

export async function confirmFirebasePhoneOtp(code: string): Promise<string> {
  if (!confirmationResult) {
    throw new Error("Firebase phone verification has not started");
  }
  const credential = await confirmationResult.confirm(code);
  const idToken = await credential.user.getIdToken();
  await signOut(getFirebaseAuthApp());
  confirmationResult = undefined;
  return idToken;
}

export function resetFirebasePhoneOtpSessionForTests(): void {
  recaptchaVerifier = undefined;
  confirmationResult = undefined;
  firebaseAuth = undefined;
  firebaseApp = undefined;
}
