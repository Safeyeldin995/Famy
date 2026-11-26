import AsyncStorage from "@react-native-async-storage/async-storage";
import { logFamyEvent } from "@/lib/analytics";

const STORAGE_KEY = "famy:analytics:payment_success_ids";
const MAX_IDS = 200;

export async function logPaymentSuccessOnce(paymentId: string | undefined | null): Promise<void> {
  if (!paymentId) return;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const ids: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    if (ids.includes(paymentId)) return;
    await logFamyEvent("payment_success");
    const next = [...ids, paymentId].slice(-MAX_IDS);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Analytics must never block payment flows.
  }
}