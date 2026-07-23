/** QA-only sanitized session lifecycle logging for local E2E diagnosis. */
export function logPasswordSetupSession(
  stage: string,
  details: Record<string, string | boolean | null | undefined>,
): void {
  if (process.env.QA_E2E_OTP_CAPTURE !== "1") return;
  console.info("[password.setup.session]", stage, details);
}
