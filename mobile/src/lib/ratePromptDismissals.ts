import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "famy.ratePrompt.dismissed";
const MAX_IDS = 50;

/** Booking ids whose Home rating card the customer dismissed («مش دلوقتي»). */
export async function loadDismissedRatePrompts(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export async function dismissRatePrompt(bookingId: string): Promise<void> {
  try {
    const current = await loadDismissedRatePrompts();
    current.delete(bookingId);
    const ids = [...current, bookingId].slice(-MAX_IDS);
    await AsyncStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // Best effort: the card is already hidden for this session.
  }
}
