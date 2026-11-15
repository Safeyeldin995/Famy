import AsyncStorage from "@react-native-async-storage/async-storage";
import { parseGuestIntent, type GuestIntent } from "./guestIntent";

export type { GuestIntent };

/**
 * Guest browsing state. A signed-out visitor picks an area and browses providers;
 * when they tap "book" we remember the provider so the app can reopen it after sign-up.
 */
const ZONE_KEY = "famy:guest:zone";
const INTENT_KEY = "famy:guest:intent";

export async function getGuestZone(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(ZONE_KEY);
  } catch {
    return null;
  }
}

export async function setGuestZone(zoneId: string) {
  try {
    await AsyncStorage.setItem(ZONE_KEY, zoneId);
  } catch {
    // Non-critical: the visitor just picks the area again.
  }
}

export async function saveGuestIntent(providerId: string, serviceId?: string) {
  const intent: GuestIntent = { providerId, serviceId, savedAt: Date.now() };
  try {
    await AsyncStorage.setItem(INTENT_KEY, JSON.stringify(intent));
  } catch {
    // Non-critical: after sign-up the visitor lands on home instead.
  }
}

/** Reads and clears the saved intent so it is used once. */
export async function takeGuestIntent(): Promise<GuestIntent | null> {
  try {
    const raw = await AsyncStorage.getItem(INTENT_KEY);
    if (raw) await AsyncStorage.removeItem(INTENT_KEY);
    return parseGuestIntent(raw);
  } catch {
    return null;
  }
}
