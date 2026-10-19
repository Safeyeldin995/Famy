/** Arabic-Indic (U+0660–U+0669) and Persian (U+06F0–U+06F9) → Western digits for phone parsing. */
export function normalizeDigitsToWestern(raw: string): string {
  return raw.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (ch) => {
    const code = ch.charCodeAt(0);
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
    return String(code - 0x06f0);
  });
}

/** Canonical E.164 normalization — shared by client wrappers and server handlers. */
export function normalizePhoneE164(raw: string, defaultCountry = "20"): string {
  const trimmed = normalizeDigitsToWestern(raw)
    .trim()
    .replace(/[\s\-()]/g, "");
  if (trimmed.startsWith("+")) {
    return `+${trimmed.slice(1).replace(/\D/g, "")}`;
  }

  let digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }

  if (digits.startsWith(defaultCountry) && digits.length > defaultCountry.length + 7) {
    return `+${digits}`;
  }

  digits = digits.replace(/^0+/, "");
  return `+${defaultCountry}${digits}`;
}

export function isValidE164Phone(phone: string): boolean {
  return /^\+\d{8,15}$/.test(phone);
}
