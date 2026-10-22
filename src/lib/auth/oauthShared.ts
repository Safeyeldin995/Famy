export type OAuthProvider = "google" | "apple";

const OAUTH_PROVIDER_SET = new Set<OAuthProvider>(["google", "apple"]);

/** Parses a comma-separated provider list (empty = none enabled). */
export function parseOAuthProviders(raw: string | undefined): OAuthProvider[] {
  if (!raw?.trim()) return [];
  const out: OAuthProvider[] = [];
  for (const part of raw.split(",")) {
    const p = part.trim().toLowerCase();
    if (p === "google" || p === "apple") {
      if (!out.includes(p)) out.push(p);
    }
  }
  return out;
}

export function isOAuthProvider(value: string): value is OAuthProvider {
  return OAUTH_PROVIDER_SET.has(value as OAuthProvider);
}

/** Where the provider sends the user back after consent (web). */
export function oauthRedirectUrl(origin: string) {
  return `${origin}/auth/callback`;
}

/** Deep link used by the native app after browser OAuth (scheme from app.json). */
export function mobileOAuthRedirectUrl(scheme: string) {
  const base = scheme.replace(/\/$/, "");
  return `${base}://auth/callback`;
}

/**
 * After OAuth, incomplete profiles need setup (name + verified contact phone).
 * OAuth accounts are customers only; providers keep phone + ID onboarding on the portal.
 */
export function resolvePostOAuthNavigationTarget(input: {
  profilePhone: string | null | undefined;
  profileFullName: string | null | undefined;
  landingPath: string | null | undefined;
}): "/setup" | string {
  if (!input.profilePhone?.trim() || !input.profileFullName?.trim()) return "/setup";
  return input.landingPath ?? "/home";
}

/** Maps set_my_contact_phone errors to i18n keys. */
export function contactPhoneErrorKey(message: string | undefined) {
  if (!message) return "oauth.phoneSaveFailed";
  if (message.includes("PHONE_TAKEN")) return "oauth.phoneTaken";
  if (message.includes("INVALID_PHONE")) return "oauth.phoneInvalid";
  return "oauth.phoneSaveFailed";
}
