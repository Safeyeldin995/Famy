import { toUIProvider, type UIProvider } from "@/lib/db/adapters";
export type CustomerProvider = UIProvider & { categorySlugs: string[] };

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
