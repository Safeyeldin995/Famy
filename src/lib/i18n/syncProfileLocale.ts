import type { SupabaseClient } from "@supabase/supabase-js";
import type { i18n as I18n } from "i18next";

type Lang = "en" | "ar";

const toLang = (language: string | undefined): Lang => (language?.startsWith("ar") ? "ar" : "en");

/**
 * Push notifications are rendered server-side from profiles.locale, so the
 * signed-in user's profile must follow the language they actually use.
 * Syncs on sign-in/session restore and whenever the language changes.
 */
export function startProfileLocaleSync(supabase: SupabaseClient, i18n: I18n) {
  let userId: string | null = null;
  let synced: string | null = null;

  const sync = async () => {
    if (!userId) return;
    const lang = toLang(i18n.language);
    const key = `${userId}:${lang}`;
    if (synced === key) return;
    synced = key;
    const { error } = await supabase
      .from("profiles")
      .update({ locale: lang })
      .eq("id", userId)
      .neq("locale", lang);
    // Retry on the next trigger instead of caching a failed write.
    if (error) synced = null;
  };

  const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
    userId = session?.user?.id ?? null;
    if (event === "SIGNED_OUT") synced = null;
    // Leave the auth callback before querying, as supabase-js recommends.
    if (userId) setTimeout(() => void sync(), 0);
  });
  const onLanguageChanged = () => void sync();
  i18n.on("languageChanged", onLanguageChanged);

  return () => {
    sub.subscription.unsubscribe();
    i18n.off("languageChanged", onLanguageChanged);
  };
}
