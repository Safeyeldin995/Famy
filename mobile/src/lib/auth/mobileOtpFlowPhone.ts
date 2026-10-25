import * as SecureStore from "expo-secure-store";

const STORAGE_KEY = "famy.mobile.otp.phone";

export async function rememberOtpFlowPhone(phoneE164: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(STORAGE_KEY, phoneE164);
  } catch {
    // non-fatal: resend may still work from route params
  }
}

export async function readOtpFlowPhone(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(STORAGE_KEY);
  } catch {
    return null;
  }
}

export async function forgetOtpFlowPhone(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(STORAGE_KEY);
  } catch {
    // ignore
  }
}
