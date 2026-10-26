import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import {
  MOBILE_AUTH_COOKIE_NAMES,
  MOBILE_AUTH_INTENTS_HEADER,
  OTP_PENDING_COOKIE,
  SET_PASSWORD_COOKIE,
  type MobileAuthIntentsPayload,
} from "@shared/auth/authIntent.constants";

const STORAGE_KEY = "famy.mobile.auth.cookies";
/** One-time migration from the previous AsyncStorage jar. */
const LEGACY_STORAGE_KEY = STORAGE_KEY;

type CookieJar = Partial<Record<(typeof MOBILE_AUTH_COOKIE_NAMES)[number], string>>;

async function readSecureItem(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function writeSecureItem(key: string, value: string) {
  await SecureStore.setItemAsync(key, value);
}

async function deleteSecureItem(key: string) {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // already absent
  }
}

async function readJar(): Promise<CookieJar> {
  try {
    let raw = await readSecureItem(STORAGE_KEY);
    if (!raw) {
      const legacy = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        await writeSecureItem(STORAGE_KEY, legacy);
        await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
        raw = legacy;
      }
    }
    if (!raw) return {};
    const parsed = JSON.parse(raw) as CookieJar;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeJar(jar: CookieJar) {
  const hasAny = MOBILE_AUTH_COOKIE_NAMES.some((name) => jar[name]);
  if (!hasAny) {
    await clearMobileAuthCookies();
    return;
  }
  await writeSecureItem(STORAGE_KEY, JSON.stringify(jar));
}

export async function mobileAuthIntentHeader(): Promise<string | undefined> {
  const jar = await readJar();
  const payload: MobileAuthIntentsPayload = {
    otpPending: jar[OTP_PENDING_COOKIE] ?? null,
    setPassword: jar[SET_PASSWORD_COOKIE] ?? null,
  };
  if (!payload.otpPending && !payload.setPassword) return undefined;
  return JSON.stringify(payload);
}

/** @deprecated Use mobileAuthIntentHeader — kept for call-site clarity during migration. */
export async function mobileAuthCookieHeader(): Promise<string | undefined> {
  return mobileAuthIntentHeader();
}

export async function mergeMobileAuthIntents(intents: MobileAuthIntentsPayload | undefined) {
  if (!intents) return;
  const jar = await readJar();
  if (intents.otpPending === null) {
    delete jar[OTP_PENDING_COOKIE];
  } else if (typeof intents.otpPending === "string" && intents.otpPending.length > 0) {
    jar[OTP_PENDING_COOKIE] = intents.otpPending;
  }
  if (intents.setPassword === null) {
    delete jar[SET_PASSWORD_COOKIE];
  } else if (typeof intents.setPassword === "string" && intents.setPassword.length > 0) {
    jar[SET_PASSWORD_COOKIE] = intents.setPassword;
  }
  await writeJar(jar);
}

export async function clearMobileAuthCookies() {
  await deleteSecureItem(STORAGE_KEY);
  try {
    await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export { MOBILE_AUTH_INTENTS_HEADER };
