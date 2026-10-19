import { describe, expect, it, vi } from "vitest";
import { createInstance } from "i18next";
import type { SupabaseClient } from "@supabase/supabase-js";
import { startProfileLocaleSync } from "../syncProfileLocale";

function fakeSupabase() {
  let authCallback: (event: string, session: unknown) => void = () => {};
  const updates: { locale: string; id: string }[] = [];
  const client = {
    auth: {
      onAuthStateChange: (cb: typeof authCallback) => {
        authCallback = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
    from: (table: string) => {
      expect(table).toBe("profiles");
      return {
        update: (values: { locale: string }) => ({
          eq: (_col: string, id: string) => ({
            neq: async () => {
              updates.push({ locale: values.locale, id });
              return { error: null };
            },
          }),
        }),
      };
    },
  };
  return {
    client: client as unknown as SupabaseClient,
    updates,
    signIn: (id: string) => authCallback("INITIAL_SESSION", { user: { id } }),
    signOut: () => authCallback("SIGNED_OUT", null),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("startProfileLocaleSync", () => {
  it("writes the app language to the signed-in profile and follows language changes", async () => {
    const i18n = createInstance();
    await i18n.init({ lng: "ar", resources: {} });
    const sb = fakeSupabase();
    const stop = startProfileLocaleSync(sb.client, i18n);

    sb.signIn("user-1");
    await flush();
    expect(sb.updates).toEqual([{ locale: "ar", id: "user-1" }]);

    // Same user and language: no duplicate write.
    sb.signIn("user-1");
    await flush();
    expect(sb.updates).toHaveLength(1);

    await i18n.changeLanguage("en");
    await flush();
    expect(sb.updates.at(-1)).toEqual({ locale: "en", id: "user-1" });

    stop();
  });

  it("does nothing while signed out", async () => {
    const i18n = createInstance();
    await i18n.init({ lng: "ar", resources: {} });
    const sb = fakeSupabase();
    startProfileLocaleSync(sb.client, i18n);
    sb.signOut();
    await i18n.changeLanguage("en");
    await flush();
    expect(sb.updates).toEqual([]);
  });
});
