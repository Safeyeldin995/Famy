/**
 * Native Firebase phone auth (optional). Requires a dev/production build with
 * @react-native-firebase/app + auth and google-services.json / GoogleService-Info.plist.
 */

export type FirebasePhoneErrorCode =
  | "unavailable"
  | "session_lost"
  | "auth/too-many-requests"
  | "auth/quota-exceeded"
  | "auth/invalid-phone-number"
  | string;

type FirebaseAuthModule = {
  signInWithPhoneNumber: (phone: string) => Promise<{
    confirm: (code: string) => Promise<{ user: { getIdToken: () => Promise<string> } }>;
  }>;
};

let confirmation: Awaited<ReturnType<FirebaseAuthModule["signInWithPhoneNumber"]>> | null = null;

function loadAuth(): FirebaseAuthModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("@react-native-firebase/auth").default as FirebaseAuthModule;
  } catch {
    return null;
  }
}

export function hasNativeFirebasePhoneSession() {
  return confirmation !== null;
}

export async function sendNativeFirebasePhoneOtp(
  phoneE164: string,
): Promise<{ ok: true } | { ok: false; code: FirebasePhoneErrorCode }> {
  const auth = loadAuth();
  if (!auth) return { ok: false, code: "unavailable" };
  try {
    confirmation = await auth.signInWithPhoneNumber(phoneE164);
    return { ok: true };
  } catch (error) {
    confirmation = null;
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: string }).code ?? "unknown")
        : "unknown";
    return { ok: false, code };
  }
}

export async function confirmNativeFirebasePhoneOtp(
  code: string,
): Promise<{ ok: true; idToken: string } | { ok: false; code: FirebasePhoneErrorCode }> {
  if (!confirmation) return { ok: false, code: "session_lost" };
  try {
    const cred = await confirmation.confirm(code);
    const idToken = await cred.user.getIdToken();
    confirmation = null;
    return { ok: true, idToken };
  } catch (error) {
    const errCode =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: string }).code ?? "unknown")
        : "unknown";
    return { ok: false, code: errCode };
  }
}

export function resetNativeFirebasePhoneSession() {
  confirmation = null;
}
