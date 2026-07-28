import type { PostgrestError } from "@supabase/supabase-js";

export const BOOKING_ERROR_CODES = {
  SLOT_UNAVAILABLE: "SLOT_UNAVAILABLE",
  PROVIDER_INELIGIBLE: "PROVIDER_INELIGIBLE",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  ADDRESS_OUTSIDE_ZONE: "ADDRESS_OUTSIDE_ZONE",
  AVAILABILITY_CHANGED: "AVAILABILITY_CHANGED",
  INVALID_PROMO: "INVALID_PROMO",
  INVALID_BOOKING_REQUEST: "INVALID_BOOKING_REQUEST",
  DUPLICATE_REQUEST_CONFLICT: "DUPLICATE_REQUEST_CONFLICT",
  UNAUTHORIZED: "UNAUTHORIZED",
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
  BOOKING_DUPLICATE_REQUEST_CONFLICT: BOOKING_ERROR_CODES.DUPLICATE_REQUEST_CONFLICT,
  BOOKING_UNAUTHORIZED: BOOKING_ERROR_CODES.UNAUTHORIZED,
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
  return null;
}

export function bookingErrorI18nKey(code: BookingErrorCode): string {
  return `bookFlow.errors.${code}`;
}

export function isSlotStaleBookingError(code: BookingErrorCode | null): boolean {
  return code === BOOKING_ERROR_CODES.SLOT_UNAVAILABLE
    || code === BOOKING_ERROR_CODES.AVAILABILITY_CHANGED;
}

export function mapBookingRpcError(error: PostgrestError): BookingError {
  const code = parseBookingErrorCode(error.message)
    ?? (error.code === "42501" ? BOOKING_ERROR_CODES.UNAUTHORIZED : null)
    ?? (error.code === "23P01" ? BOOKING_ERROR_CODES.SLOT_UNAVAILABLE : null)
    ?? BOOKING_ERROR_CODES.INVALID_BOOKING_REQUEST;
  const friendly = error.message?.includes(":") ? error.message.split(":").slice(1).join(":").trim() : error.message;
  return new BookingError(code, friendly || code);
}

export function getBookingErrorMessage(
  error: unknown,
  t: (key: string, defaultValue?: string) => string,
): string {
  if (error instanceof BookingError) {
    return t(bookingErrorI18nKey(error.code), error.message);
  }
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    const code = parseBookingErrorCode(error.message);
    if (code) return t(bookingErrorI18nKey(code), error.message);
    return error.message;
  }
  return t("bookFlow.failed", "Could not create booking");
}
