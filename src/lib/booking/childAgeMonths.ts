/**
 * Whole-month age matching PostgreSQL
 * `EXTRACT(YEAR FROM age(at_date, dob)) * 12 + EXTRACT(MONTH FROM age(at_date, dob))`
 * used by `assert_babysitting_booking_eligible`.
 * `atInstant` is interpreted as the UTC calendar date of a timestamptz
 * (`(start_at AT TIME ZONE 'utc')::date`).
 */
export function utcCalendarDate(isoOrDate: string | Date): { y: number; m: number; d: number } {
  if (typeof isoOrDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(isoOrDate)) {
    const [y, m, d] = isoOrDate.split("-").map(Number);
    return { y, m, d };
  }
  const at = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  return { y: at.getUTCFullYear(), m: at.getUTCMonth() + 1, d: at.getUTCDate() };
}

export function ageInWholeMonthsUtc(dateOfBirth: string, atInstant: string | Date): number {
  const dob = utcCalendarDate(dateOfBirth);
  const at = utcCalendarDate(atInstant);
  let months = (at.y - dob.y) * 12 + (at.m - dob.m);
  if (at.d < dob.d) months -= 1;
  return months;
}

export const CHILD_AGE_MONTH_MIN = 0;
export const CHILD_AGE_MONTH_MAX = 215;

export function childAgeMonthsInSupportedRange(months: number): boolean {
  return months >= CHILD_AGE_MONTH_MIN && months <= CHILD_AGE_MONTH_MAX;
}
