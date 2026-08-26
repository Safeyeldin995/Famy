import { toUIProvider, type UIProvider } from "@/lib/db/adapters";

/** Completed bookings only, unique by provider, preserving query order (most recent first). */
export function rebookProvidersFromBookings(bookings: readonly any[], limit = 5): UIProvider[] {
  const seen = new Set<string>();
  const result: UIProvider[] = [];

  for (const booking of bookings) {
    if (booking.status !== "completed") continue;
    if (!booking.provider) continue;
    const providerId = booking.provider_id ?? booking.provider.id;
    if (!providerId || seen.has(providerId)) continue;
    seen.add(providerId);
    result.push(toUIProvider(booking.provider));
    if (result.length >= limit) break;
  }

  return result;
}
