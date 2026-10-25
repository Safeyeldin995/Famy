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
  settings: { appVerificationDisabledForTesting: boolean };
};

export function applyFirebasePhoneTestModeBeforeSend(
  auth: AuthWithVerificationSettings,
  phoneE164: string,
  config?: FirebasePhoneTestModeConfig,
): void {
  auth.settings.appVerificationDisabledForTesting = shouldDisableAppVerificationForPhone(
    phoneE164,
    config ?? readFirebasePhoneTestModeConfig(),
  );
}

export function resetFirebasePhoneTestModeAfterSend(auth: AuthWithVerificationSettings): void {
  auth.settings.appVerificationDisabledForTesting = false;
}
