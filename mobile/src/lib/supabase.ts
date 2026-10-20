import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { createClient } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";

type Extra = { supabaseUrl: string; supabasePublishableKey: string; webOrigin: string };

export const appConfig = Constants.expoConfig?.extra as Extra;

/**
 * Same Supabase project and RLS rules as the web app. Only the public
 * publishable key ships in the binary; privileged work stays on the server.
 */
export const supabase = createClient(appConfig.supabaseUrl, appConfig.supabasePublishableKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Refresh tokens only while the app is in the foreground.
if (Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
