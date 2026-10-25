/** Whether OTP mount should trigger a native Firebase resend (never on fresh send). */
export function shouldAutoResendFirebaseOtpOnMount(
  hasConfirmation: boolean,
  resendAvailableIn: number,
): boolean {
  if (hasConfirmation) return false;
  if (resendAvailableIn > 0) return false;
  return true;
}
