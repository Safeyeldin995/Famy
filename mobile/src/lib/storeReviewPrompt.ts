import AsyncStorage from "@react-native-async-storage/async-storage";
import * as StoreReview from "expo-store-review";
import { supabase } from "@/lib/supabase";

const STORAGE_LAST_PROMPT = "famy.store_review_last_prompt_ms";
const MIN_COMPLETED_BOOKINGS = 2;
const PROMPT_COOLDOWN_MS = 120 * 24 * 60 * 60 * 1000;

export async function maybePromptForStoreReview(userId: string | undefined): Promise<void> {
  if (!userId) return;
  if (!(await StoreReview.hasAction())) return;
  if (!(await StoreReview.isAvailableAsync())) return;

  const lastRaw = await AsyncStorage.getItem(STORAGE_LAST_PROMPT);
  const lastMs = lastRaw ? Number(lastRaw) : 0;
  if (Number.isFinite(lastMs) && lastMs > 0 && Date.now() - lastMs < PROMPT_COOLDOWN_MS) {
    return;
  }

  const { count, error } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", userId)
    .eq("status", "completed");

  if (error || (count ?? 0) < MIN_COMPLETED_BOOKINGS) return;

  await StoreReview.requestReview();
  await AsyncStorage.setItem(STORAGE_LAST_PROMPT, String(Date.now()));
}