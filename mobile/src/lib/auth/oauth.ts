import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import Constants from "expo-constants";
import { Platform } from "react-native";
import {
  mobileOAuthRedirectUrl,
  parseOAuthProviders,
  resolvePostOAuthNavigationTarget,
  type OAuthProvider,
} from "@shared/auth/oauthShared";
import { supabase } from "@/lib/supabase";

type Extra = { oauthProviders?: string; scheme?: string };

WebBrowser.maybeCompleteAuthSession();

function appScheme() {
  const extra = Constants.expoConfig?.extra as Extra | undefined;
  return extra?.scheme ?? Constants.expoConfig?.scheme ?? "famy";
}

export function enabledMobileOAuthProviders(): OAuthProvider[] {
  const extra = Constants.expoConfig?.extra as Extra | undefined;
  return parseOAuthProviders(extra?.oauthProviders);
}

export function showAppleSignInOnMobile() {
  return Platform.OS === "ios" && enabledMobileOAuthProviders().includes("apple");
}

async function finishOAuthSessionFromRedirectUrl(redirectUrl: string) {
  const { error } = await supabase.auth.exchangeCodeForSession(redirectUrl);
  if (error) throw error;
}

/** Google (and Apple on Android) via system browser + deep link back into the app. */
export async function signInWithMobileOAuthBrowser(provider: OAuthProvider) {
  const redirectTo = mobileOAuthRedirectUrl(String(appScheme()));
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data.url) throw new Error("OAUTH_NO_URL");

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== "success" || !result.url) {
    throw new Error(result.type === "cancel" ? "OAUTH_CANCELLED" : "OAUTH_FAILED");
  }
  await finishOAuthSessionFromRedirectUrl(result.url);
}

/** Sign in with Apple on iOS using the native sheet and Supabase id_token flow. */
export async function signInWithAppleNative() {
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
    nonce: hashedNonce,
  });
  if (!credential.identityToken) throw new Error("APPLE_NO_TOKEN");
  const { error } = await supabase.auth.signInWithIdToken({
    provider: "apple",
    token: credential.identityToken,
    nonce: rawNonce,
  });
  if (error) throw error;
}

export type PostMobileOAuthRoute =
  { kind: "setup" } | { kind: "in_app"; path: string } | { kind: "web_admin" };

/**
 * Mirrors web `/auth/callback`: setup when phone or name is missing, else customer home.
 * Admin accounts open the web workspace; provider OAuth is not offered on login.
 */
export async function resolvePostMobileOAuthRoute(): Promise<PostMobileOAuthRoute> {
  const { data: sessionRes } = await supabase.auth.getSession();
  const userId = sessionRes.session?.user.id;
  if (!userId) throw new Error("OAUTH_NO_SESSION");

  const { data: profile } = await supabase
    .from("profiles")
    .select("phone, full_name")
    .eq("id", userId)
    .maybeSingle();

  const { data: rolesRows } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const roles = (rolesRows ?? []).map((r) => r.role as string);
  const landingPath = roles.includes("admin")
    ? null
    : roles.includes("provider")
      ? "/dashboard"
      : "/home";

  if (roles.includes("admin")) return { kind: "web_admin" };

  const target = resolvePostOAuthNavigationTarget({
    profilePhone: profile?.phone,
    profileFullName: profile?.full_name,
    landingPath,
  });
  if (target === "/setup") return { kind: "setup" };
  return { kind: "in_app", path: target === "/home" ? "/home" : target };
}
