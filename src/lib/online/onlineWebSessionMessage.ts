const TOKEN_ERRORS = new Set([
  "unauthorized",
  "payment_required",
  "outside_join_window",
  "not_online_booking",
  "booking_not_active",
  "not_participant",
  "livekit_unavailable",
  "server_error",
]);

export function onlineSessionTokenErrorKey(code: string): string | null {
  const key = code.trim();
  if (!key) return null;
  return TOKEN_ERRORS.has(key) ? `onlineSession.errors.${key}` : null;
}

export function isMediaDeviceErrorMessage(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("permission") ||
    m.includes("notallowed") ||
    m.includes("not found") ||
    m.includes("device") ||
    m.includes("denied")
  );
}