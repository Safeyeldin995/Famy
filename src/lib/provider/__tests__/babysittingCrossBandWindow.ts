import { ageInWholeMonthsUtc } from "@/lib/booking/childAgeMonths";

/** Schema defaults from `20260627164621`. The babysitting fixture does not override them. */
export const FIXTURE_MAX_ADVANCE_DAYS = 60;
export const FIXTURE_MIN_NOTICE_HOURS = 4;

/** Toddler catalogue band is 12–35 months; preschool starts at 36. */
export const TODDLER_MAX_MONTHS = 35;
export const PRESCHOOL_MIN_MONTHS = 36;

export function dateOfBirthForWholeMonthsUtc(atInstant: Date, months: number): string {
  const total = atInstant.getUTCFullYear() * 12 + atInstant.getUTCMonth() - months;
  const dobY = Math.floor(total / 12);
  const dobM0 = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(dobY, dobM0 + 1, 0)).getUTCDate();
  const dobD = Math.min(atInstant.getUTCDate(), lastDay);
  const iso = `${String(dobY).padStart(4, "0")}-${String(dobM0 + 1).padStart(2, "0")}-${String(dobD).padStart(2, "0")}`;
  const age = ageInWholeMonthsUtc(iso, atInstant);
  if (age !== months) {
    throw new Error(
      `dateOfBirthForWholeMonthsUtc: ${iso} is ${age} months at ${atInstant.toISOString()}, expected ${months}`,
    );
  }
  return iso;
}

export function addUtcMonthsAtHour(start: Date, months: number, hourUtc = 10): Date {
  return new Date(
    Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth() + months,
      start.getUTCDate(),
      hourUtc,
      0,
      0,
      0,
    ),
  );
}

export function isWithinAdvanceWindow(
  start: Date,
  now: Date,
  maxAdvanceDays = FIXTURE_MAX_ADVANCE_DAYS,
): boolean {
  return start.getTime() <= now.getTime() + maxAdvanceDays * 86_400_000;
}

/**
 * Earliest 10:00 UTC start after the same-band +24h time where the child is
 * exactly 36 months old and still inside min_notice / max_advance_days.
 * Throws rather than returning a date that would hit `check_booking_slot`.
 */
export function planCrossBandRescheduleUtc(args: {
  originalStart: Date;
  dateOfBirth: string;
  now?: Date;
  maxAdvanceDays?: number;
  minNoticeHours?: number;
  slotHourUtc?: number;
}): Date {
  const now = args.now ?? new Date();
  const maxAdvanceDays = args.maxAdvanceDays ?? FIXTURE_MAX_ADVANCE_DAYS;
  const minNoticeHours = args.minNoticeHours ?? FIXTURE_MIN_NOTICE_HOURS;
  const hourUtc = args.slotHourUtc ?? 10;
  const { originalStart, dateOfBirth } = args;

  const ageOriginal = ageInWholeMonthsUtc(dateOfBirth, originalStart);
  if (ageOriginal !== TODDLER_MAX_MONTHS) {
    throw new Error(
      `cross-band fixture requires ${TODDLER_MAX_MONTHS} months at original start; got ${ageOriginal} (dob ${dateOfBirth} at ${originalStart.toISOString()})`,
    );
  }

  const sameBand = new Date(originalStart.getTime() + 24 * 60 * 60 * 1000);
  const ageSame = ageInWholeMonthsUtc(dateOfBirth, sameBand);
  if (ageSame !== TODDLER_MAX_MONTHS) {
    throw new Error(
      `cross-band fixture requires ${TODDLER_MAX_MONTHS} months at same-band +24h; got ${ageSame} at ${sameBand.toISOString()}`,
    );
  }

  const earliest = new Date(now.getTime() + minNoticeHours * 3_600_000);
  const latest = new Date(now.getTime() + maxAdvanceDays * 86_400_000);

  const firstDay = new Date(
    Date.UTC(
      originalStart.getUTCFullYear(),
      originalStart.getUTCMonth(),
      originalStart.getUTCDate() + 1,
      hourUtc,
      0,
      0,
      0,
    ),
  );
  const lastDay = new Date(
    Date.UTC(latest.getUTCFullYear(), latest.getUTCMonth(), latest.getUTCDate(), hourUtc, 0, 0, 0),
  );

  for (let t = firstDay.getTime(); t <= lastDay.getTime(); t += 86_400_000) {
    const raw = new Date(t);
    const candidate = new Date(
      Date.UTC(raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate(), hourUtc, 0, 0, 0),
    );
    if (candidate.getTime() <= sameBand.getTime()) continue;
    if (candidate.getTime() < earliest.getTime()) continue;
    if (candidate.getTime() > latest.getTime()) break;
    if (ageInWholeMonthsUtc(dateOfBirth, candidate) === PRESCHOOL_MIN_MONTHS) {
      return candidate;
    }
  }

  throw new Error(
    `no ${hourUtc}:00 UTC start is both within max_advance_days=${maxAdvanceDays} of ${now.toISOString()} and exactly ${PRESCHOOL_MIN_MONTHS} months old (dob ${dateOfBirth}, original ${originalStart.toISOString()}, latest ${latest.toISOString()})`,
  );
}
