/**
 * An intent older than this is ignored. Kept short because it is stored per device,
 * so it should only resume the sign-up that started from the guest screen.
 */
export const GUEST_INTENT_TTL_MS = 2 * 60 * 60 * 1000;

export type GuestIntent = { providerId: string; serviceId?: string; savedAt: number };

export function parseGuestIntent(raw: string | null, now = Date.now()): GuestIntent | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<GuestIntent>;
    if (typeof value.providerId !== "string" || !value.providerId) return null;
    if (typeof value.savedAt !== "number" || now - value.savedAt > GUEST_INTENT_TTL_MS) return null;
    return {
      providerId: value.providerId,
      serviceId:
        typeof value.serviceId === "string" && value.serviceId ? value.serviceId : undefined,
      savedAt: value.savedAt,
    };
  } catch {
    return null;
  }
}
