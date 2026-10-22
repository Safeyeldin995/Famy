import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import {
  MOBILE_AUTH_COOKIE_NAMES,
  OTP_PENDING_COOKIE,
  SET_PASSWORD_COOKIE,
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

export async function mobileAuthCookieHeader(): Promise<string | undefined> {
  const jar = await readJar();
  const parts = MOBILE_AUTH_COOKIE_NAMES.flatMap((name) => {
    const value = jar[name];
    return value ? [`${name}=${value}`] : [];
  });
  return parts.length > 0 ? parts.join("; ") : undefined;
}

function parseSetCookiePair(raw: string): { name: string; value: string; cleared: boolean } | null {
  const segment = raw.split(";")[0]?.trim();
  if (!segment) return null;
  const eq = segment.indexOf("=");
  if (eq <= 0) return null;
  const name = segment.slice(0, eq);
  const value = segment.slice(eq + 1);
  const cleared = raw.includes("Max-Age=0") || value === "";
  return { name, value, cleared };
}

export async function mergeMobileAuthSetCookies(setCookies: string[]) {
  if (setCookies.length === 0) return;
  const jar = await readJar();
  for (const raw of setCookies) {
    const parsed = parseSetCookiePair(raw);
    if (!parsed) continue;
    if (parsed.name !== OTP_PENDING_COOKIE && parsed.name !== SET_PASSWORD_COOKIE) {
      continue;
    }
    if (parsed.cleared) {
      delete jar[parsed.name];
    } else {
      jar[parsed.name] = parsed.value;
    }
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
