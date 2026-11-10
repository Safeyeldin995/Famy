import AsyncStorage from "@react-native-async-storage/async-storage";

export const PENDING_PUSH_DEEP_LINK_KEY = "famy.mobilePush.pendingDeepLink";

export async function stashPendingPushDeepLink(deepLink: string): Promise<void> {
  if (!deepLink || deepLink === "/") return;
  await AsyncStorage.setItem(PENDING_PUSH_DEEP_LINK_KEY, deepLink);
}

export async function consumePendingPushDeepLink(): Promise<string | null> {
  const value = await AsyncStorage.getItem(PENDING_PUSH_DEEP_LINK_KEY);
  if (value) await AsyncStorage.removeItem(PENDING_PUSH_DEEP_LINK_KEY);
  return value;
}
