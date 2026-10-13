import { toUIProvider, type UIProvider } from "@/lib/db/adapters";
export type CustomerProvider = UIProvider & { categorySlugs: string[] };

export function customerRoleLabel(categories: string[], t: (key: string) => string): string {
  const keys = [
    ...(categories.includes("babysitting") || categories.includes("kids")
      ? ["roles.babysitter"]
      : []),
    ...(categories.includes("tutoring") ? ["roles.teacher"] : []),
  ];
  return keys.map((key) => t(key)).join(" · ");
}

/** Preserve both categories when combining category-specific discovery results. */
export function customerProviders(rows: Parameters<typeof toUIProvider>[0][]): CustomerProvider[] {
  const providers = new Map<string, CustomerProvider>();
  for (const row of rows) {
    const p = toUIProvider(row);
    if (!["babysitting", "tutoring"].includes(p.categorySlug)) continue;
    const existing = providers.get(p.id);
    const categorySlugs = [...new Set([...(existing?.categorySlugs ?? []), p.categorySlug])];
    providers.set(p.id, { ...(existing ?? p), categorySlugs });
  }
  return [...providers.values()];
}

/** Normalize digits in customer-facing free-text descriptions without changing their values. */
export function latinCustomerText<T extends string | null | undefined>(text: T): T {
  if (text == null) return text;
  return text.replace(/[٠-٩۰-۹]/g, (digit) =>
    String(digit.charCodeAt(0) - (digit <= "٩" ? 0x660 : 0x6f0)),
  ) as T;
}
