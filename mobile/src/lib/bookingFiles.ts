/** File payloads matching the web receipt/calendar actions. No uploads or payment mutation. */
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
};
export function receiptText(b: BookingFileInfo) {
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
