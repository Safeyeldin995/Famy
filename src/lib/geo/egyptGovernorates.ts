/**
 * Egypt's 27 governorates. The code is what the database stores
 * (profiles.governorate, providers.governorate, area_requests.governorate,
 * settings.online_availability.closed_governorates) and must stay in sync with
 * public.egypt_governorate_codes() in the migrations.
 */
export type EgyptGovernorate = { code: string; name_ar: string; name_en: string };

export const EGYPT_GOVERNORATES: readonly EgyptGovernorate[] = [
  { code: "cairo", name_ar: "القاهرة", name_en: "Cairo" },
  { code: "giza", name_ar: "الجيزة", name_en: "Giza" },
  { code: "alexandria", name_ar: "الإسكندرية", name_en: "Alexandria" },
  { code: "qalyubia", name_ar: "القليوبية", name_en: "Qalyubia" },
  { code: "sharqia", name_ar: "الشرقية", name_en: "Sharqia" },
  { code: "dakahlia", name_ar: "الدقهلية", name_en: "Dakahlia" },
  { code: "gharbia", name_ar: "الغربية", name_en: "Gharbia" },
  { code: "monufia", name_ar: "المنوفية", name_en: "Monufia" },
  { code: "beheira", name_ar: "البحيرة", name_en: "Beheira" },
  { code: "kafr_el_sheikh", name_ar: "كفر الشيخ", name_en: "Kafr El Sheikh" },
  { code: "damietta", name_ar: "دمياط", name_en: "Damietta" },
  { code: "port_said", name_ar: "بورسعيد", name_en: "Port Said" },
  { code: "ismailia", name_ar: "الإسماعيلية", name_en: "Ismailia" },
  { code: "suez", name_ar: "السويس", name_en: "Suez" },
  { code: "north_sinai", name_ar: "شمال سيناء", name_en: "North Sinai" },
  { code: "south_sinai", name_ar: "جنوب سيناء", name_en: "South Sinai" },
  { code: "red_sea", name_ar: "البحر الأحمر", name_en: "Red Sea" },
  { code: "faiyum", name_ar: "الفيوم", name_en: "Faiyum" },
  { code: "beni_suef", name_ar: "بني سويف", name_en: "Beni Suef" },
  { code: "minya", name_ar: "المنيا", name_en: "Minya" },
  { code: "asyut", name_ar: "أسيوط", name_en: "Asyut" },
  { code: "sohag", name_ar: "سوهاج", name_en: "Sohag" },
  { code: "qena", name_ar: "قنا", name_en: "Qena" },
  { code: "luxor", name_ar: "الأقصر", name_en: "Luxor" },
  { code: "aswan", name_ar: "أسوان", name_en: "Aswan" },
  { code: "matrouh", name_ar: "مطروح", name_en: "Matrouh" },
  { code: "new_valley", name_ar: "الوادي الجديد", name_en: "New Valley" },
] as const;

const BY_CODE = new Map(EGYPT_GOVERNORATES.map((g) => [g.code, g]));

export function isEgyptGovernorateCode(code: unknown): code is string {
  return typeof code === "string" && BY_CODE.has(code);
}

export function governorateName(code: string | null | undefined, language: string): string {
  if (!code) return "";
  const g = BY_CODE.get(code);
  if (!g) return "";
  return language.startsWith("ar") ? g.name_ar : g.name_en;
}

/** Options for a picker, in the order above (largest population centres first). */
export function governorateOptions(language: string): { value: string; label: string }[] {
  return EGYPT_GOVERNORATES.map((g) => ({
    value: g.code,
    label: language.startsWith("ar") ? g.name_ar : g.name_en,
  }));
}

export type OnlineAvailabilitySettings = { closed_governorates: string[] };

/** Reads settings.online_availability; anything malformed means "nothing closed". */
export function parseOnlineAvailability(value: unknown): OnlineAvailabilitySettings {
  const raw =
    value && typeof value === "object" && "closed_governorates" in value
      ? (value as { closed_governorates?: unknown }).closed_governorates
      : null;
  const list = Array.isArray(raw) ? raw.filter(isEgyptGovernorateCode) : [];
  return { closed_governorates: Array.from(new Set(list)).sort() };
}

/** Unknown governorate is treated as open: closing is an exception, not a gate. */
export function isOnlineOpenFor(
  settings: OnlineAvailabilitySettings,
  governorate: string | null | undefined,
): boolean {
  if (!governorate) return true;
  return !settings.closed_governorates.includes(governorate);
}
