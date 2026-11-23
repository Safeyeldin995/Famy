import { Platform } from "react-native";
import type { PaymobCheckoutChannel } from "@shared/paymob/paymobChannels";

type PaymobSdkListener = (response: { status: string; message?: string }) => void;

type PaymobNativeModule = {
  setSdkListener: (listener: PaymobSdkListener) => void;
  removeSdkListener: () => void;
  presentPayVC: (clientSecret: string, publicKey: string) => void;
};

function loadPaymobNative(): PaymobNativeModule | null {
  if (Platform.OS === "web") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("paymob-reactnative").default as PaymobNativeModule;
  } catch {
    return null;
  }
}

export function shouldUsePaymobNativeSdk(channel: PaymobCheckoutChannel): boolean {
  return channel !== "card" && Platform.OS !== "web" && loadPaymobNative() != null;
}

export async function presentPaymobNativeCheckout(
  clientSecret: string,
  publicKey: string,
): Promise<void> {
  const Paymob = loadPaymobNative();
  if (!Paymob) throw new Error("paymob_sdk_unavailable");
  await new Promise<void>((resolve, reject) => {
    Paymob.setSdkListener((response) => {
      Paymob.removeSdkListener();
      if (response.status === "Success") {
        resolve();
        return;
      }
      if (response.status === "Cancelled") {
        reject(new Error("checkout_cancelled"));
        return;
      }
      reject(new Error(response.message ?? "checkout_failed"));
    });
    Paymob.presentPayVC(clientSecret, publicKey);
  });
}