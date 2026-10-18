import { supabase } from "@/integrations/supabase/client";

export type OAuthProvider = "google";

/** Where the provider sends the user back after consent. */
export function oauthRedirectUrl(origin: string) {
  return `${origin}/auth/callback`;
}

/**
 * Starts the provider sign-in. OAuth accounts are always customers: the
 * provider portal keeps its phone + ID verification onboarding.
 */
export async function signInWithOAuthProvider(provider: OAuthProvider) {
  return supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: oauthRedirectUrl(window.location.origin) },
  });
}

/** Maps set_my_contact_phone errors to i18n keys. */
export function contactPhoneErrorKey(message: string | undefined) {
  if (!message) return "oauth.phoneSaveFailed";
  if (message.includes("PHONE_TAKEN")) return "oauth.phoneTaken";
  if (message.includes("INVALID_PHONE")) return "oauth.phoneInvalid";
  return "oauth.phoneSaveFailed";
}
