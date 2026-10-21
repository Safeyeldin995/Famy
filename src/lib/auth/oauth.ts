import { supabase } from "@/integrations/supabase/client";
import {
  contactPhoneErrorKey,
  oauthRedirectUrl,
  parseOAuthProviders,
  resolvePostOAuthNavigationTarget,
  type OAuthProvider,
} from "@/lib/auth/oauthShared";

export type { OAuthProvider } from "@/lib/auth/oauthShared";
export {
  contactPhoneErrorKey,
  mobileOAuthRedirectUrl,
  oauthRedirectUrl,
  parseOAuthProviders,
  resolvePostOAuthNavigationTarget,
  isOAuthProvider,
} from "@/lib/auth/oauthShared";

/** Web: which OAuth buttons to show (default none until configured in the dashboard). */
export function enabledWebOAuthProviders(): OAuthProvider[] {
  return parseOAuthProviders(import.meta.env.VITE_OAUTH_PROVIDERS);
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
