/** Pre-send OTP rate limits (before flow mismatch / SMS). See `otp_send_attempts` table. */
export const OTP_SEND_RATE_LIMIT = {
  IP_MAX_ATTEMPTS: 10,
  PHONE_MAX_ATTEMPTS: 5,
  WINDOW_MS: 60 * 60 * 1000,
  RETENTION_MS: 24 * 60 * 60 * 1000,
} as const;
