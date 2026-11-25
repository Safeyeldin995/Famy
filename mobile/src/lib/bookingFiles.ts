/** File payloads matching the web receipt/calendar actions. No uploads or payment mutation. */
import {
  WALLET_REFUND_DISCLOSURE_AR,
  WALLET_REFUND_DISCLOSURE_EN,
} from "@shared/online/walletRefundDisclosure";

export type BookingFileInfo = {
  id: string;
  provider: string;
  service: string;
  date: string;
  time: string;
  duration: string;
  address: string;
  total: string;
  start: string;
  end: string;
  online?: boolean;
  language?: string;
};
export function receiptText(b: BookingFileInfo) {
  const refundLine =
    b.online === true
      ? (b.language === "ar" ? WALLET_REFUND_DISCLOSURE_AR : WALLET_REFUND_DISCLOSURE_EN)
      : null;
  return [
    "FAMY — Booking Receipt",
    "========================",
    `Booking ID: #${b.id}`,
    `Service:    ${b.service}`,
    `Provider:   ${b.provider}`,
    `Date:       ${b.date}`,
    `Time:       ${b.time} (${b.duration})`,
    `Address:    ${b.address}`,
    `Total:      ${b.total}`,
    "",
    ...(refundLine ? [refundLine, ""] : []),
    "Thank you for booking with Famy.",
  ].join("\n");
}
export function calendarText(b: BookingFileInfo) {
  const stamp = (value: string) =>
    new Date(value)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  const escape = (value: string) =>
    value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Famy//Booking//EN",
    "BEGIN:VEVENT",
    `UID:${escape(b.id)}@famy.app`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(b.start)}`,
    `DTEND:${stamp(b.end)}`,
    `SUMMARY:${escape(`Famy – ${b.service}`)}`,
    `DESCRIPTION:${escape(`Provider: ${b.provider}`)}`,
    `LOCATION:${escape(b.address)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

/**
 * Short text for the system share sheet ("Share booking"). Leaves out the
 * address and price on purpose: the customer picks who receives it.
 */
export function bookingShareMessage(b: BookingFileInfo) {
  if (b.language === "ar") {
    return [
      `حجز على فامي: ${b.service}`,
      `مع ${b.provider}`,
      `يوم ${b.date} الساعة ${b.time} (${b.duration})`,
      `رقم الحجز #${b.id}`,
    ].join("\n");
  }
  return [
    `Famy booking: ${b.service}`,
    `With ${b.provider}`,
    `${b.date} at ${b.time} (${b.duration})`,
    `Booking #${b.id}`,
  ].join("\n");
}
