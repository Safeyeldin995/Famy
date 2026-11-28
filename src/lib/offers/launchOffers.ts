/**
 * Launch offers (20261128160000_launch_offers): the first-lesson guarantee and the
 * lower commission for new tutors. Pure helpers shared by the web and the app.
 * The database decides every rule; these only read settings and shape UI text.
 */

export const DEFAULT_OFFER_CATEGORY_SLUGS = ["tutoring", "quran", "music"] as const;

export type FirstLessonGuaranteeSettings = {
  enabled: boolean;
  window_hours: number;
  max_per_30_days: number;
  category_slugs: string[];
};

export type LaunchCommissionSettings = {
  enabled: boolean;
  percent_in_person: number | null;
  percent_online: number | null;
  duration_days: number;
  starts_at: string;
  category_slugs: string[];
};

export const DEFAULT_FIRST_LESSON_GUARANTEE: FirstLessonGuaranteeSettings = {
  enabled: false,
  window_hours: 24,
  max_per_30_days: 2,
  category_slugs: [...DEFAULT_OFFER_CATEGORY_SLUGS],
};

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function slugs(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_OFFER_CATEGORY_SLUGS];
  const list = value.filter((s): s is string => typeof s === "string" && s.trim() !== "");
  return list.length ? list : [...DEFAULT_OFFER_CATEGORY_SLUGS];
}

/** A missing or broken row means the guarantee is off: never promise it by accident. */
export function parseFirstLessonGuarantee(value: unknown): FirstLessonGuaranteeSettings {
  const v = obj(value);
  return {
    enabled: v.enabled === true,
    window_hours: num(v.window_hours) ?? DEFAULT_FIRST_LESSON_GUARANTEE.window_hours,
    max_per_30_days: num(v.max_per_30_days) ?? DEFAULT_FIRST_LESSON_GUARANTEE.max_per_30_days,
    category_slugs: slugs(v.category_slugs),
  };
}

export function parseLaunchCommission(value: unknown): LaunchCommissionSettings {
  const v = obj(value);
  return {
    enabled: v.enabled === true,
    percent_in_person: num(v.percent_in_person),
    percent_online: num(v.percent_online),
    duration_days: num(v.duration_days) ?? 30,
    starts_at: typeof v.starts_at === "string" ? v.starts_at : new Date().toISOString(),
    category_slugs: slugs(v.category_slugs),
  };
}

/** Show the promise only where the guarantee really applies. */
export function guaranteeCoversCategory(
  settings: FirstLessonGuaranteeSettings | null | undefined,
  categorySlug: string | null | undefined,
): boolean {
  if (!settings?.enabled || !categorySlug) return false;
  return settings.category_slugs.includes(categorySlug);
}

export type FirstLessonGuaranteeBlock =
  | "disabled"
  | "booking_not_found"
  | "not_completed"
  | "category_not_covered"
  | "not_first_lesson"
  | "window_closed"
  | "already_claimed"
  | "tutor_already_used"
  | "monthly_limit"
  | "no_payment"
  | "payment_not_settled"
  | "card_refund_unknown"
  | "money_flag_open"
  | "issue_open"
  | "nothing_left"
  | "changed";

export type FirstLessonGuaranteeStatus = {
  eligible: boolean;
  blocked: FirstLessonGuaranteeBlock | null;
  amount: number;
  expires_at: string | null;
  claim: {
    id: string;
    amount: number;
    status: "claimed" | "reversed";
    created_at: string;
    reversed_at: string | null;
  } | null;
};

export function parseGuaranteeStatus(raw: unknown): FirstLessonGuaranteeStatus {
  const v = obj(raw);
  const c = v.claim ? obj(v.claim) : null;
  return {
    eligible: v.eligible === true,
    blocked: (typeof v.blocked === "string" ? v.blocked : null) as FirstLessonGuaranteeBlock | null,
    amount: num(v.amount) ?? 0,
    expires_at: typeof v.expires_at === "string" ? v.expires_at : null,
    claim: c
      ? {
          id: String(c.id),
          amount: num(c.amount) ?? 0,
          status: c.status === "reversed" ? "reversed" : "claimed",
          created_at: String(c.created_at ?? ""),
          reversed_at: typeof c.reversed_at === "string" ? c.reversed_at : null,
        }
      : null,
  };
}

/**
 * Which guarantee card a completed booking shows:
 *  - "offer": the button «الحصة مكانتش مناسبة»;
 *  - "claimed": the money went back to the wallet;
 *  - "waiting": the lesson qualifies but the money cannot move yet (an open
 *    payment check), so tell the customer to come back or contact support;
 *  - null: nothing (not a first lesson, window closed, not covered, ...).
 */
export function guaranteeCardState(
  status: FirstLessonGuaranteeStatus | null | undefined,
): "offer" | "claimed" | "waiting" | null {
  if (!status) return null;
  if (status.claim?.status === "claimed") return "claimed";
  if (status.claim) return null;
  if (status.eligible && status.amount > 0) return "offer";
  if (
    status.blocked === "payment_not_settled" ||
    status.blocked === "card_refund_unknown" ||
    status.blocked === "money_flag_open" ||
    status.blocked === "issue_open"
  ) {
    return "waiting";
  }
  return null;
}

/** «GUARANTEE_BLOCKED:monthly_limit» → the i18n key for a short reason. */
export function guaranteeErrorKey(message: string | null | undefined): string {
  const code = /GUARANTEE_BLOCKED:([a-z_]+)/.exec(message ?? "")?.[1];
  switch (code) {
    case "window_closed":
      return "firstLessonGuarantee.errors.windowClosed";
    case "monthly_limit":
      return "firstLessonGuarantee.errors.monthlyLimit";
    case "tutor_already_used":
    case "already_claimed":
      return "firstLessonGuarantee.errors.alreadyUsed";
    case "not_first_lesson":
      return "firstLessonGuarantee.errors.notFirst";
    default:
      return "firstLessonGuarantee.errors.generic";
  }
}

/**
 * The last day the lower commission applies, as a Cairo calendar date in
 * Western digits (ends_at is exclusive, so step back one millisecond).
 */
export function launchCommissionLastDay(endsAtIso: string, language: string): string {
  const end = new Date(new Date(endsAtIso).getTime() - 1);
  return new Intl.DateTimeFormat(language.startsWith("ar") ? "ar-EG-u-nu-latn" : "en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "Africa/Cairo",
  }).format(end);
}

export type MyLaunchCommission =
  | { active: false }
  | {
      active: true;
      starts_at: string;
      ends_at: string;
      percent_in_person: number | null;
      percent_online: number | null;
      regular_in_person: number | null;
      regular_online: number | null;
    };

export function parseMyLaunchCommission(raw: unknown): MyLaunchCommission {
  const v = obj(raw);
  if (v.active !== true || typeof v.ends_at !== "string") return { active: false };
  return {
    active: true,
    starts_at: String(v.starts_at ?? ""),
    ends_at: v.ends_at,
    percent_in_person: num(v.percent_in_person),
    percent_online: num(v.percent_online),
    regular_in_person: num(v.regular_in_person),
    regular_online: num(v.regular_online),
  };
}

/** The lowest launch rate to show in one line, e.g. «7.5%». */
export function launchCommissionPercentLabel(c: MyLaunchCommission): string | null {
  if (!c.active) return null;
  const rates = [c.percent_in_person, c.percent_online].filter((x): x is number => x != null);
  if (!rates.length) return null;
  const low = Math.min(...rates);
  return `${Number.isInteger(low) ? low : low.toFixed(2).replace(/0$/, "")}%`;
}

/** Until when the guarantee can be asked for, e.g. «الجمعة 8:30 م» (Cairo time, Western digits). */
export function guaranteeDeadlineLabel(expiresAtIso: string, language: string): string {
  return new Intl.DateTimeFormat(language.startsWith("ar") ? "ar-EG-u-nu-latn" : "en-GB", {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Africa/Cairo",
  }).format(new Date(expiresAtIso));
}
