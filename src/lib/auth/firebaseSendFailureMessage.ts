/** Maps Firebase Auth phone-send error codes to user-facing copy (web + native). */
export function firebaseSendFailureMessage(
  t: (key: string, options?: Record<string, unknown>) => string,
  firebaseAuthCode?: string,
): string {
  switch (firebaseAuthCode) {
    case "auth/too-many-requests":
      return t("auth.firebaseSendTooManyRequests");
    case "auth/quota-exceeded":
      return t("auth.firebaseSendQuotaExceeded");
    case "auth/invalid-phone-number":
      return t("validation.invalidPhone");
    case "auth/famy-send-timeout":
      return t("auth.firebaseSendTimeout");
    case "auth/app-not-authorized":
    case "auth/missing-client-identifier":
    case "auth/captcha-check-failed":
    case "auth/invalid-app-credential":
    case "auth/missing-app-credential":
      return t("auth.firebaseSendDeviceVerifyFailed");
    case "unavailable":
      return t("auth.firebaseStartFailed");
    default:
      return t("auth.firebaseSendFailed");
  }
}
