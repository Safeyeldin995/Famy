import { normalizePhoneE164 } from "@shared/otp/normalizePhone";

export type FirebasePhoneTestModeConfig = {
  testModeEnabled: boolean;
  testPhoneE164s: ReadonlySet<string>;
};

export function parseFirebaseTestPhoneNumbers(raw: string | undefined): ReadonlySet<string> {
  if (!raw?.trim()) return new Set();
  const numbers = new Set<string>();
  for (const segment of raw.split(",")) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    try {
      numbers.add(normalizePhoneE164(trimmed));
    } catch {
      // Ignore invalid entries; PO must configure valid E.164 in EAS.
    }
  }
  return numbers;
}

export function readFirebasePhoneTestModeConfig(env?: {
  EXPO_PUBLIC_FIREBASE_TEST_MODE?: string;
  EXPO_PUBLIC_FIREBASE_TEST_NUMBERS?: string;
}): FirebasePhoneTestModeConfig {
  const source = env ?? {
    EXPO_PUBLIC_FIREBASE_TEST_MODE: process.env.EXPO_PUBLIC_FIREBASE_TEST_MODE,
    EXPO_PUBLIC_FIREBASE_TEST_NUMBERS: process.env.EXPO_PUBLIC_FIREBASE_TEST_NUMBERS,
  };
  return {
    testModeEnabled: source.EXPO_PUBLIC_FIREBASE_TEST_MODE === "1",
    testPhoneE164s: parseFirebaseTestPhoneNumbers(source.EXPO_PUBLIC_FIREBASE_TEST_NUMBERS),
  };
}

export function shouldDisableAppVerificationForPhone(
  phoneE164: string,
  config: FirebasePhoneTestModeConfig,
): boolean {
  if (!config.testModeEnabled) return false;
  try {
    return config.testPhoneE164s.has(normalizePhoneE164(phoneE164));
  } catch {
    return false;
  }
}

type AuthWithVerificationSettings = {
  settings: { appVerificationDisabledForTesting: boolean; forceRecaptchaFlowForTesting?: boolean };
};

/**
 * Builds installed outside Google Play (EAS preview/development APKs) fail
 * Play Integrity ("Invalid app info in play_integrity_token"), so real numbers
 * never get an SMS. Those builds set EXPO_PUBLIC_FIREBASE_FORCE_RECAPTCHA=1 to
 * use Firebase's reCAPTCHA check instead. Store builds leave it unset.
 */
export function shouldForceFirebaseRecaptcha(env?: {
  EXPO_PUBLIC_FIREBASE_FORCE_RECAPTCHA?: string;
}): boolean {
  const value = env
    ? env.EXPO_PUBLIC_FIREBASE_FORCE_RECAPTCHA
    : process.env.EXPO_PUBLIC_FIREBASE_FORCE_RECAPTCHA;
  return value === "1";
}

export function applyFirebasePhoneTestModeBeforeSend(
  auth: AuthWithVerificationSettings,
  phoneE164: string,
  config?: FirebasePhoneTestModeConfig,
): void {
  const disableVerification = shouldDisableAppVerificationForPhone(
    phoneE164,
    config ?? readFirebasePhoneTestModeConfig(),
  );
  auth.settings.appVerificationDisabledForTesting = disableVerification;
  if (!disableVerification && shouldForceFirebaseRecaptcha()) {
    auth.settings.forceRecaptchaFlowForTesting = true;
  }
}

export function resetFirebasePhoneTestModeAfterSend(auth: AuthWithVerificationSettings): void {
  auth.settings.appVerificationDisabledForTesting = false;
}
