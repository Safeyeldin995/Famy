export type StoredLanguage = "ar" | "en";
export const LANGUAGE_COOKIE = "famio_lang";

export function readLanguageCookie(cookies: string): StoredLanguage | undefined {
  const value = cookies
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${LANGUAGE_COOKIE}=`))
    ?.slice(LANGUAGE_COOKIE.length + 1);
  return value === "ar" || value === "en" ? value : undefined;
}

export function languageCookie(language: StoredLanguage): string {
  return `${LANGUAGE_COOKIE}=${language}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
