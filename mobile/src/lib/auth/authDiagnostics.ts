/** Log auth failure codes only — never phone numbers, OTP digits, or passwords. */
export function logAuthFailure(scope: string, code: string | undefined | null): void {
  const normalized = typeof code === "string" ? code.trim() : "";
  if (!normalized) return;
  console.warn(`[auth:${scope}]`, normalized);
}
