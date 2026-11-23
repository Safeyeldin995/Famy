function authDiagLoggingEnabled(): boolean {
  if (typeof __DEV__ !== "undefined") return __DEV__;
  return process.env.NODE_ENV !== "production";
}

/** Log auth failure codes only — never phone numbers, OTP digits, or passwords. */
export function logAuthFailure(scope: string, code: string | undefined | null): void {
  const normalized = typeof code === "string" ? code.trim() : "";
  if (!normalized || !authDiagLoggingEnabled()) return;
  console.warn(`[auth:${scope}]`, normalized);
}
