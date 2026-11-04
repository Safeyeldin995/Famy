/** Calendar dates in Cairo, shared by the web and native member forms. */
export function memberToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export type MemberAge = { years: number; months: number };

function calendarDate(value: string): number[] | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== value) return null;
  return value.split("-").map(Number);
}

export function memberAgeFromDate(dateOfBirth: string, today = memberToday()): MemberAge | null {
  const birth = calendarDate(dateOfBirth);
  const current = calendarDate(today);
  if (!birth || !current || dateOfBirth > today) return null;
  const months =
    (current[0] - birth[0]) * 12 + current[1] - birth[1] - (current[2] < birth[2] ? 1 : 0);
  return { years: Math.floor(months / 12), months: months % 12 };
}

export function memberMaxYears(relationship: string): number {
  return relationship === "son" || relationship === "daughter" ? 17 : 99;
}

export function memberAgeToDate(age: MemberAge, today = memberToday()): string {
  const current = calendarDate(today);
  if (
    !current ||
    !Number.isInteger(age.years) ||
    age.years < 0 ||
    age.years > 99 ||
    !Number.isInteger(age.months) ||
    age.months < 0 ||
    age.months > 11
  ) {
    throw new Error("Invalid member age");
  }
  // Only under-twos ask for months. The stored date is explicitly an estimate.
  const monthIndex =
    current[0] * 12 + current[1] - 1 - age.years * 12 - (age.years < 2 ? age.months : 0);
  return `${Math.floor(monthIndex / 12)}-${String((monthIndex % 12) + 1).padStart(2, "0")}-01`;
}

export function estimatedMemberBirthDate(dateOfBirth: string, today = memberToday()): string {
  const age = memberAgeFromDate(dateOfBirth, today);
  if (!age) throw new Error("Invalid member birth date");
  return memberAgeToDate(age, today);
}

export function memberAgeTranslation(dateOfBirth: string, today = memberToday()) {
  const age = memberAgeFromDate(dateOfBirth, today);
  if (!age) return { key: "memberAge.unknown", count: 0 };
  return memberAgePartsTranslation(age);
}

export function memberAgePartsTranslation(age: MemberAge) {
  const count = age.years < 2 ? age.years * 12 + age.months : age.years;
  // Explicit keys also work on Hermes without Intl.PluralRules.
  const category =
    count === 0
      ? "zero"
      : count === 1
        ? "one"
        : count === 2
          ? "two"
          : count % 100 >= 3 && count % 100 <= 10
            ? "few"
            : count % 100 >= 11
              ? "many"
              : "other";
  return { key: `memberAge.${age.years < 2 ? "monthCount" : "yearCount"}_${category}`, count };
}

export function bookingMemberAgeTranslation(
  party?: { member_age_months?: number | null; member_age_years: number | null } | null,
) {
  const months = party?.member_age_months;
  if (months != null)
    return memberAgePartsTranslation({ years: Math.floor(months / 12), months: months % 12 });
  if (party?.member_age_years != null)
    return memberAgePartsTranslation({ years: party.member_age_years, months: 0 });
  return { key: "memberAge.unknown", count: 0 };
}
