import { AuthIntentConfigurationError } from "@/lib/auth/authIntent.server";

export type FirebaseOtpBeginFailureReason =
  | "provider_mismatch"
  | "auth_intent_secret_missing"
  | "invalid_phone"
  | "unexpected";

export type FirebaseOtpBeginLog = {
  reason: FirebaseOtpBeginFailureReason;
  configuredOtpProvider: string;
  authIntentSecretConfigured: boolean;
  phoneSuffix: string | null;
  errorName?: string;
  errorCode?: string;
  errorMessage?: string;
};

export function maskPhoneSuffix(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 2) return null;
  return digits.slice(-2);
}

export function isAuthIntentSecretConfigured(): boolean {
  return Boolean(process.env.AUTH_INTENT_SECRET?.trim());
}

export function logFirebaseOtpBeginFailure(details: FirebaseOtpBeginLog): void {
  console.error("[otp.firebase.begin]", details);
}

export function classifyFirebaseOtpBeginError(error: unknown): {
  reason: FirebaseOtpBeginFailureReason;
  errorName?: string;
  errorCode?: string;
  errorMessage?: string;
} {
  if (error instanceof AuthIntentConfigurationError) {
    return {
      reason: "auth_intent_secret_missing",
      errorName: error.name,
      errorMessage: "AUTH_INTENT_SECRET is not configured",
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Invalid E.164 phone")) {
    return {
      reason: "invalid_phone",
      errorName: error instanceof Error ? error.name : "Error",
      errorMessage: "Invalid E.164 phone",
    };
  }

  const errorName = error instanceof Error ? error.name : "Error";
  const errorCode =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: string }).code ?? "")
      : undefined;

  return {
    reason: "unexpected",
    errorName,
    errorCode: errorCode || undefined,
    errorMessage: message.slice(0, 200),
  };
}
