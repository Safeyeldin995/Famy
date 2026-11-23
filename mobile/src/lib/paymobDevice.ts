import Constants from "expo-constants";
import { Platform } from "react-native";

function applePayMerchantId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { applePayMerchantId?: string } | undefined;
  const fromExtra = extra?.applePayMerchantId?.trim();
  if (fromExtra) return fromExtra;
  const fromEnv = process.env.EXPO_PUBLIC_APPLE_PAY_MERCHANT_ID?.trim();
  return fromEnv || undefined;
}

export function mobileApplePayMerchantConfigured(): boolean {
  return !!applePayMerchantId();
}

export function showApplePayPaymentOption(serverConfigured: boolean): boolean {
  return Platform.OS === "ios" && serverConfigured && mobileApplePayMerchantConfigured();
}

export function showGooglePayPaymentOption(serverConfigured: boolean): boolean {
  return Platform.OS === "android" && serverConfigured;
}