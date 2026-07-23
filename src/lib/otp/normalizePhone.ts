/** Canonical E.164 normalization — shared by client wrappers and server handlers. */
export function normalizePhoneE164(raw: string, defaultCountry = "20"): string {
  const trimmed = raw.trim().replace(/[\s\-()]/g, "");
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
