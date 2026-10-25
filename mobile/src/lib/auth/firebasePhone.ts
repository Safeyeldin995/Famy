/**
 * Native Firebase phone auth (optional). Requires a dev/production build with
 * @react-native-firebase/app + auth and google-services.json / GoogleService-Info.plist.
 */

import {
  getAuth,
  onAuthStateChanged,
  signInWithPhoneNumber,
  signOut,
} from "@react-native-firebase/auth";
import { logAuthFailure } from "@/lib/auth/authDiagnostics";
import { mapFirebasePhoneConfirmError } from "@shared/auth/firebasePhoneConfirmErrors";
import { normalizePhoneE164 } from "@shared/otp/normalizePhone";

export type FirebasePhoneErrorCode =
  | "unavailable"
  | "session_lost"
  | "auth/too-many-requests"
  | "auth/quota-exceeded"
  | "auth/invalid-phone-number"
  | "auth/invalid-verification-code"
  | "auth/session-expired"
  | "auth/code-expired"
  | string;

type FirebaseUser = {
  phoneNumber: string | null;
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
};

type FirebaseAuthInstance = ReturnType<typeof getAuth>;

type PhoneConfirmation = Awaited<ReturnType<typeof signInWithPhoneNumber>>;

let confirmation: PhoneConfirmation | null = null;
let phoneVerificationActive = false;
let flowPhoneE164: string | null = null;
let flowStartedAtMs = 0;
let authStateUnsubscribe: (() => void) | null = null;
const autoVerifyListeners = new Set<(idToken: string) => void>();

function authInstance(): FirebaseAuthInstance | null {
  try {
    return getAuth();
  } catch (error) {
    logAuthFailure("firebase_init", extractErrorCode(error));
    return null;
  }
}

function extractErrorCode(error: unknown): FirebasePhoneErrorCode {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code?: string }).code ?? "unknown");
  }
  return "unknown";
}

function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  try {
    return normalizePhoneE164(a) === normalizePhoneE164(b);
  } catch {
    return false;
  }
}

function isCurrentFlowPhoneUser(user: FirebaseUser | null): user is FirebaseUser {
  if (!phoneVerificationActive || !flowPhoneE164 || !user?.phoneNumber) return false;
  return phonesMatch(user.phoneNumber, flowPhoneE164);
}

function notifyAutoVerify(idToken: string) {
  for (const listener of autoVerifyListeners) {
    listener(idToken);
  }
}

function ensureAuthStateListener() {
  if (authStateUnsubscribe) return;
  const auth = authInstance();
  if (!auth) return;
  authStateUnsubscribe = onAuthStateChanged(auth, async (user) => {
    if (!isCurrentFlowPhoneUser(user)) return;
    try {
      const idToken = await user.getIdToken();
      notifyAutoVerify(idToken);
    } catch (error) {
      logAuthFailure("firebase_auto_verify", extractErrorCode(error));
    }
  });
}

export function hasNativeFirebasePhoneSession() {
  return confirmation !== null;
}

export function getNativeFirebaseFlowStartedAtMs() {
  return flowStartedAtMs;
}

export function subscribeNativeFirebasePhoneAutoVerify(listener: (idToken: string) => void) {
  ensureAuthStateListener();
  autoVerifyListeners.add(listener);
  return () => {
    autoVerifyListeners.delete(listener);
  };
}

export async function getNativeFirebasePhoneVerificationIdToken(
  expectedPhoneE164: string,
): Promise<{ ok: true; idToken: string } | { ok: false; code: FirebasePhoneErrorCode }> {
  const auth = authInstance();
  const user = auth?.currentUser ?? null;
  if (!isCurrentFlowPhoneUser(user) || !phonesMatch(user.phoneNumber, expectedPhoneE164)) {
    return { ok: false, code: "session_lost" };
  }
  try {
    const idToken = await user.getIdToken();
    return { ok: true, idToken };
  } catch (error) {
    logAuthFailure("firebase_id_token", extractErrorCode(error));
    return { ok: false, code: extractErrorCode(error) };
  }
}

export function resetNativeFirebasePhoneSession() {
  confirmation = null;
  phoneVerificationActive = false;
  flowPhoneE164 = null;
  flowStartedAtMs = 0;
}

/** Clears persisted native Firebase user so an old phone sign-in cannot satisfy a new OTP intent. */
export async function signOutNativeFirebaseAuth(): Promise<void> {
  resetNativeFirebasePhoneSession();
  const auth = authInstance();
  if (!auth) return;
  try {
    await signOut(auth);
  } catch (error) {
    logAuthFailure("firebase_sign_out", extractErrorCode(error));
  }
}

export async function sendNativeFirebasePhoneOtp(
  phoneE164: string,
): Promise<{ ok: true } | { ok: false; code: FirebasePhoneErrorCode }> {
  const auth = authInstance();
  if (!auth) return { ok: false, code: "unavailable" };

  await signOutNativeFirebaseAuth();
  ensureAuthStateListener();
  phoneVerificationActive = true;
  flowPhoneE164 = normalizePhoneE164(phoneE164);
  flowStartedAtMs = Date.now();

  try {
    confirmation = await signInWithPhoneNumber(auth, flowPhoneE164);
    return { ok: true };
  } catch (error) {
    await signOutNativeFirebaseAuth();
    const code = extractErrorCode(error);
    logAuthFailure("firebase_send", code);
    return { ok: false, code };
  }
}

export function mapNativeFirebaseConfirmError(
  code: FirebasePhoneErrorCode,
): "session_lost" | "invalid_code" {
  return mapFirebasePhoneConfirmError(code);
}

export async function confirmNativeFirebasePhoneOtp(
  code: string,
  expectedPhoneE164: string,
): Promise<{ ok: true; idToken: string } | { ok: false; code: FirebasePhoneErrorCode }> {
  if (!confirmation) {
    return { ok: false, code: "session_lost" };
  }
  try {
    const cred = await confirmation.confirm(code);
    if (!phonesMatch(cred.user.phoneNumber, expectedPhoneE164)) {
      await signOutNativeFirebaseAuth();
      return { ok: false, code: "session_lost" };
    }
    const idToken = await cred.user.getIdToken();
    resetNativeFirebasePhoneSession();
    return { ok: true, idToken };
  } catch (error) {
    const errCode = extractErrorCode(error);
    logAuthFailure("firebase_confirm", errCode);
    if (errCode === "auth/session-expired" || errCode === "auth/code-expired") {
      resetNativeFirebasePhoneSession();
    }
    return { ok: false, code: errCode };
  }
}
