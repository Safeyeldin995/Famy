import type { PostgrestError } from "@supabase/supabase-js";

export const BOOKING_ERROR_CODES = {
  SLOT_UNAVAILABLE: "SLOT_UNAVAILABLE",
  PROVIDER_INELIGIBLE: "PROVIDER_INELIGIBLE",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  ADDRESS_OUTSIDE_ZONE: "ADDRESS_OUTSIDE_ZONE",
  AVAILABILITY_CHANGED: "AVAILABILITY_CHANGED",
  INVALID_PROMO: "INVALID_PROMO",
  INVALID_BOOKING_REQUEST: "INVALID_BOOKING_REQUEST",
  SUPERVISION_REQUIRED: "SUPERVISION_REQUIRED",
  PHONE_REQUIRED: "PHONE_REQUIRED",
  DEBT_OUTSTANDING: "DEBT_OUTSTANDING",
  DUPLICATE_REQUEST_CONFLICT: "DUPLICATE_REQUEST_CONFLICT",
  UNAUTHORIZED: "UNAUTHORIZED",
  ONLINE_BIRTH_DATE_REQUIRED: "ONLINE_BIRTH_DATE_REQUIRED",
  ONLINE_AGE_MINIMUM: "ONLINE_AGE_MINIMUM",
  ONLINE_REGION_CLOSED: "ONLINE_REGION_CLOSED",
  USER_BLOCKED: "USER_BLOCKED",
  PROVIDER_SETTLEMENT_BLOCKED: "PROVIDER_SETTLEMENT_BLOCKED",
  PREPAID_REQUIRED: "PREPAID_REQUIRED",
  GUARDIAN_CONSENT_REQUIRED: "GUARDIAN_CONSENT_REQUIRED",
  TOO_EARLY: "TOO_EARLY",
} as const;

export type BookingErrorCode = (typeof BOOKING_ERROR_CODES)[keyof typeof BOOKING_ERROR_CODES];

const DB_PREFIX = "BOOKING_";

const CODE_ALIASES: Record<string, BookingErrorCode> = {
  BOOKING_SLOT_UNAVAILABLE: BOOKING_ERROR_CODES.SLOT_UNAVAILABLE,
  BOOKING_PROVIDER_INELIGIBLE: BOOKING_ERROR_CODES.PROVIDER_INELIGIBLE,
  BOOKING_SERVICE_UNAVAILABLE: BOOKING_ERROR_CODES.SERVICE_UNAVAILABLE,
  BOOKING_ADDRESS_OUTSIDE_ZONE: BOOKING_ERROR_CODES.ADDRESS_OUTSIDE_ZONE,
  BOOKING_AVAILABILITY_CHANGED: BOOKING_ERROR_CODES.AVAILABILITY_CHANGED,
  BOOKING_INVALID_PROMO: BOOKING_ERROR_CODES.INVALID_PROMO,
  BOOKING_INVALID_BOOKING_REQUEST: BOOKING_ERROR_CODES.INVALID_BOOKING_REQUEST,
  BOOKING_SUPERVISION_REQUIRED: BOOKING_ERROR_CODES.SUPERVISION_REQUIRED,
  BOOKING_PHONE_REQUIRED: BOOKING_ERROR_CODES.PHONE_REQUIRED,
  BOOKING_DEBT_OUTSTANDING: BOOKING_ERROR_CODES.DEBT_OUTSTANDING,
  BOOKING_DUPLICATE_REQUEST_CONFLICT: BOOKING_ERROR_CODES.DUPLICATE_REQUEST_CONFLICT,
  BOOKING_UNAUTHORIZED: BOOKING_ERROR_CODES.UNAUTHORIZED,
  BOOKING_ONLINE_BIRTH_DATE_REQUIRED: BOOKING_ERROR_CODES.ONLINE_BIRTH_DATE_REQUIRED,
  BOOKING_ONLINE_AGE_MINIMUM: BOOKING_ERROR_CODES.ONLINE_AGE_MINIMUM,
  BOOKING_ONLINE_REGION_CLOSED: BOOKING_ERROR_CODES.ONLINE_REGION_CLOSED,
  BOOKING_PROVIDER_SETTLEMENT_BLOCKED: BOOKING_ERROR_CODES.PROVIDER_SETTLEMENT_BLOCKED,
  BOOKING_PREPAID_REQUIRED: BOOKING_ERROR_CODES.PREPAID_REQUIRED,
  ONLINE_BOOKING_PREPAID_REQUIRED: BOOKING_ERROR_CODES.PREPAID_REQUIRED,
  BOOKING_GUARDIAN_CONSENT_REQUIRED: BOOKING_ERROR_CODES.GUARDIAN_CONSENT_REQUIRED,
  BOOKING_TOO_EARLY: BOOKING_ERROR_CODES.TOO_EARLY,
};

export class BookingError extends Error {
  readonly code: BookingErrorCode;

  constructor(code: BookingErrorCode, message: string) {
    super(message);
    this.name = "BookingError";
    this.code = code;
  }
}

export function parseBookingErrorCode(raw: string | null | undefined): BookingErrorCode | null {
  if (!raw) return null;
  const token = raw.split(":")[0]?.trim();
  if (!token) return null;
  if (token in CODE_ALIASES) return CODE_ALIASES[token];
  if (token.startsWith(DB_PREFIX)) {
    const stripped = token.slice(DB_PREFIX.length);
    const values = Object.values(BOOKING_ERROR_CODES) as string[];
    if (values.includes(stripped)) return stripped as BookingErrorCode;
  }
  if ((Object.values(BOOKING_ERROR_CODES) as string[]).includes(token)) {
    return token as BookingErrorCode;
  }
  if (token === "user_blocked") {
    return BOOKING_ERROR_CODES.USER_BLOCKED;
  }
  return null;
}

export function bookingErrorI18nKey(code: BookingErrorCode): string {
  return `bookFlow.errors.${code}`;
}

export function isSlotStaleBookingError(code: BookingErrorCode | null): boolean {
  return (
    code === BOOKING_ERROR_CODES.SLOT_UNAVAILABLE ||
    code === BOOKING_ERROR_CODES.AVAILABILITY_CHANGED
  );
}

export function mapBookingRpcError(error: PostgrestError): BookingError {
  if (error.message?.includes("user_blocked")) {
    return new BookingError(BOOKING_ERROR_CODES.USER_BLOCKED, "user_blocked");
  }
  const code =
    parseBookingErrorCode(error.message) ??
    (error.code === "42501" ? BOOKING_ERROR_CODES.UNAUTHORIZED : null) ??
    (error.code === "23P01" ? BOOKING_ERROR_CODES.SLOT_UNAVAILABLE : null) ??
    BOOKING_ERROR_CODES.INVALID_BOOKING_REQUEST;
  const friendly = error.message?.includes(":")
    ? error.message.split(":").slice(1).join(":").trim()
    : error.message;
  return new BookingError(code, friendly || code);
}

export function getBookingErrorMessage(
  error: unknown,
  t: (key: string, defaultValue?: string) => string,
): string {
  if (error instanceof BookingError) {
    return t(bookingErrorI18nKey(error.code), error.message);
  }
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    const code = parseBookingErrorCode(error.message);
    if (code) return t(bookingErrorI18nKey(code), error.message);
    // Never show a raw server or network message to the customer.
    if ("code" in error && error.code === "42501") {
      return t(bookingErrorI18nKey(BOOKING_ERROR_CODES.UNAUTHORIZED));
    }
  }
  return t("bookFlow.failed", "Could not create booking");
}
