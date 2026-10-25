import { router } from "expo-router";
import { clearMobileAuthCookies } from "@/lib/auth/mobileAuthCookies";
import { signOutNativeFirebaseAuth } from "@/lib/auth/firebasePhone";
import { supabase } from "@/lib/supabase";

const ACCOUNT_DELETED_NOTICE_KEY = "auth.accountDeleted";

let pendingLoginNoticeKey: string | null = null;
let handlingBanned: Promise<void> | null = null;

export function consumePendingLoginNoticeKey(): string | null {
  const key = pendingLoginNoticeKey;
  pendingLoginNoticeKey = null;
  return key;
}

export function isUserBannedAuthError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; message?: unknown; error_description?: unknown };
  if (record.code === "user_banned") return true;
  const message = typeof record.message === "string" ? record.message : "";
  if (message.includes("user_banned")) return true;
  const description = typeof record.error_description === "string" ? record.error_description : "";
  return description.includes("user_banned");
}

/** Clears local auth state and routes to login with a one-time deleted-account notice. */
export function handleUserBannedSession(): Promise<void> {
  if (handlingBanned) return handlingBanned;
  handlingBanned = (async () => {
    pendingLoginNoticeKey = ACCOUNT_DELETED_NOTICE_KEY;
    await clearMobileAuthCookies();
    try {
      await signOutNativeFirebaseAuth();
    } catch {
      // ignore: Firebase may not be initialized
    }
    await supabase.auth.signOut({ scope: "local" });
    router.replace("/login");
  })().finally(() => {
    handlingBanned = null;
  });
  return handlingBanned;
}
