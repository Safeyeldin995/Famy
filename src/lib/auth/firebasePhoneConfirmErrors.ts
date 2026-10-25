/** Maps native/web Firebase phone confirmation error codes to flow errors. */
export function mapFirebasePhoneConfirmError(code: string): "session_lost" | "invalid_code" {
  if (
    code === "session_lost" ||
    code === "auth/session-expired" ||
    code === "auth/code-expired"
  ) {
    return "session_lost";
  }
  return "invalid_code";
}
