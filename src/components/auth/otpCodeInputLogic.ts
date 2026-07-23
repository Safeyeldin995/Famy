export const OTP_LENGTH = 6;

export function sanitizeOtpDigits(value: string): string {
  return value.replace(/\D/g, "").slice(0, OTP_LENGTH);
}

export function applyOtpDigitInput(current: string[], index: number, raw: string): {
  next: string[];
  focusIndex: number;
  complete: boolean;
} {
  const digits = sanitizeOtpDigits(raw);
  const next = [...current];

  if (!digits) {
    next[index] = "";
    return { next, focusIndex: index, complete: false };
  }

  let focusIndex = index;
  for (const digit of digits) {
    if (focusIndex >= OTP_LENGTH) break;
    next[focusIndex] = digit;
    focusIndex++;
  }

  const boundedFocus = Math.min(focusIndex, OTP_LENGTH - 1);
  return {
    next,
    focusIndex: boundedFocus,
    complete: next.every((digit) => digit.length === 1),
  };
}

export function applyOtpBackspace(current: string[], index: number): {
  next: string[];
  focusIndex: number;
} {
  const next = [...current];
  if (next[index]) {
    next[index] = "";
    return { next, focusIndex: index };
  }
  if (index > 0) {
    next[index - 1] = "";
    return { next, focusIndex: index - 1 };
  }
  return { next, focusIndex: index };
}
