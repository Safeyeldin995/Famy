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

/**
 * Egyptian mobile typed in any common form (01xxxxxxxxx, 1xxxxxxxxx, +201…,
 * 00201…, 201…, Arabic-Indic digits, spaces) → the 10 national digits after
 * the country code ("1" + 9 digits), or null when it is not a valid mobile.
 */
export function egyptMobileNationalDigits(raw: string): string | null {
  let digits = normalizeDigitsToWestern(raw).replace(/\D/g, "");
  if (digits.startsWith("0020")) digits = digits.slice(4);
  else if (digits.startsWith("20") && digits.length === 12) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return /^1[0125]\d{8}$/.test(digits) ? digits : null;
}

/** True when the input is a valid Egyptian mobile in any common form. */
export function isValidEgyptMobile(raw: string): boolean {
  return egyptMobileNationalDigits(raw) !== null;
}

/** Egyptian mobile in E.164 (+201xxxxxxxxx), or null when invalid. */
export function egyptMobileE164(raw: string): string | null {
  const national = egyptMobileNationalDigits(raw);
  return national ? `+20${national}` : null;
}
