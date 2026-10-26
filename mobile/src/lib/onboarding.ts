import AsyncStorage from "@react-native-async-storage/async-storage";

const ONBOARDED_KEY = "onboarded";
let completedThisSession = false;

export async function isOnboarded(): Promise<boolean> {
  if (completedThisSession) return true;
  try {
    return (await AsyncStorage.getItem(ONBOARDED_KEY)) === "true";
  } catch {
    return false;
  }
}

export async function completeOnboarding(): Promise<void> {
  completedThisSession = true;
  try {
    await AsyncStorage.setItem(ONBOARDED_KEY, "true");
  } catch {
    // Storage failure must not prevent login. A later launch can show the intro again.
  }
}
