import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  MOBILE_AUTH_COOKIE_NAMES,
  OTP_PENDING_COOKIE,
  SET_PASSWORD_COOKIE,
} from "@shared/auth/authIntent.constants";

const STORAGE_KEY = "famy.mobile.auth.cookies";

type CookieJar = Partial<Record<(typeof MOBILE_AUTH_COOKIE_NAMES)[number], string>>;

async function readJar(): Promise<CookieJar> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
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
    await AsyncStorage.removeItem(STORAGE_KEY);
    return;
  }
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(jar));
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
    if (
      parsed.name !== OTP_PENDING_COOKIE &&
      parsed.name !== SET_PASSWORD_COOKIE
    ) {
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
  await AsyncStorage.removeItem(STORAGE_KEY);
}
