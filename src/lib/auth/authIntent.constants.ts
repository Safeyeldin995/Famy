export const OTP_PENDING_COOKIE = "famy_otp_pending";
export const SET_PASSWORD_COOKIE = "famy_set_password_auth";
export const MOBILE_AUTH_COOKIE_NAMES = [OTP_PENDING_COOKIE, SET_PASSWORD_COOKIE] as const;

/** Pending OTP intent lifetime (server cookie + Firebase auth_time freshness). */
export const OTP_PENDING_TTL_SECONDS = 5 * 60;
