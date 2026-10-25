/**
 * Native Firebase phone auth (optional). Requires a dev/production build with
 * @react-native-firebase/app + auth and google-services.json / GoogleService-Info.plist.
 */

import { logAuthFailure } from "@/lib/auth/authDiagnostics";
import { mapFirebasePhoneConfirmError } from "@shared/auth/firebasePhoneConfirmErrors";

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

type FirebaseAuthInstance = {
  currentUser: FirebaseUser | null;
  onAuthStateChanged: (listener: (user: FirebaseUser | null) => void) => () => void;
  signInWithPhoneNumber: (phone: string) => Promise<{
    confirm: (code: string) => Promise<{ user: FirebaseUser }>;
  }>;
};

type FirebaseAuthFactory = (() => FirebaseAuthInstance) & {
  signInWithPhoneNumber?: FirebaseAuthInstance["signInWithPhoneNumber"];
};

let confirmation: Awaited<ReturnType<FirebaseAuthInstance["signInWithPhoneNumber"]>> | null =
  null;
let phoneVerificationActive = false;
let authStateUnsubscribe: (() => void) | null = null;
const autoVerifyListeners = new Set<(idToken: string) => void>();

function loadAuthFactory(): FirebaseAuthFactory | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("@react-native-firebase/auth").default as FirebaseAuthFactory;
  } catch {
    return null;
  }
}

function authInstance(): FirebaseAuthInstance | null {
  const factory = loadAuthFactory();
  if (!factory) return null;
  return typeof factory === "function" ? factory() : null;
}

function extractErrorCode(error: unknown): FirebasePhoneErrorCode {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code?: string }).code ?? "unknown");
  }
  return "unknown";
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
  authStateUnsubscribe = auth.onAuthStateChanged(async (user) => {
    if (!phoneVerificationActive || !user?.phoneNumber) return;
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

export function subscribeNativeFirebasePhoneAutoVerify(listener: (idToken: string) => void) {
  ensureAuthStateListener();
  autoVerifyListeners.add(listener);
  return () => {
    autoVerifyListeners.delete(listener);
  };
}

export async function getNativeFirebasePhoneVerificationIdToken(): Promise<
  { ok: true; idToken: string } | { ok: false; code: FirebasePhoneErrorCode }
> {
  const auth = authInstance();
  if (!auth?.currentUser?.phoneNumber) {
    return { ok: false, code: "session_lost" };
  }
  try {
    const idToken = await auth.currentUser.getIdToken();
    return { ok: true, idToken };
  } catch (error) {
    logAuthFailure("firebase_id_token", extractErrorCode(error));
    return { ok: false, code: extractErrorCode(error) };
  }
}

export async function sendNativeFirebasePhoneOtp(
  phoneE164: string,
): Promise<{ ok: true } | { ok: false; code: FirebasePhoneErrorCode }> {
  const factory = loadAuthFactory();
  const auth = authInstance();
  if (!factory || !auth) return { ok: false, code: "unavailable" };
  ensureAuthStateListener();
  phoneVerificationActive = true;
  try {
    const signIn =
      typeof factory.signInWithPhoneNumber === "function"
        ? factory.signInWithPhoneNumber.bind(factory)
        : auth.signInWithPhoneNumber.bind(auth);
    confirmation = await signIn(phoneE164);
    return { ok: true };
  } catch (error) {
    confirmation = null;
    phoneVerificationActive = false;
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
): Promise<{ ok: true; idToken: string } | { ok: false; code: FirebasePhoneErrorCode }> {
  if (confirmation) {
    try {
      const cred = await confirmation.confirm(code);
      const idToken = await cred.user.getIdToken();
      confirmation = null;
      phoneVerificationActive = false;
      return { ok: true, idToken };
    } catch (error) {
      const errCode = extractErrorCode(error);
      logAuthFailure("firebase_confirm", errCode);
      if (errCode === "auth/session-expired" || errCode === "auth/code-expired") {
        confirmation = null;
        phoneVerificationActive = false;
      }
      return { ok: false, code: errCode };
    }
  }

  const auto = await getNativeFirebasePhoneVerificationIdToken();
  if (auto.ok) {
    phoneVerificationActive = false;
    return auto;
  }
  return { ok: false, code: "session_lost" };
}

export function resetNativeFirebasePhoneSession() {
  confirmation = null;
  phoneVerificationActive = false;
}
