import "react-native-reanimated";
import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { AppState, Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { useFonts } from "expo-font";
import {
  Almarai_400Regular,
  Almarai_700Bold,
  Almarai_800ExtraBold,
} from "@expo-google-fonts/almarai";
import {
  Manrope_400Regular,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from "@expo-google-fonts/manrope";
import { initI18n } from "@/lib/i18n";
import { PushBridge } from "@/lib/push";
import { SessionProvider } from "@/lib/session";
import { AppReleaseGate } from "@/ui/AppReleaseGate";
import { LaunchGate } from "@/ui/LaunchGate";
import { ToastProvider } from "@/ui/Toast";
import { colors } from "@/ui/theme";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

// React Query only knows about browser focus. On the phone, treat the app
// coming back to the foreground as "focused" so stale screens refetch.
if (Platform.OS !== "web") {
  focusManager.setEventListener((handleFocus) => {
    const sub = AppState.addEventListener("change", (state) => handleFocus(state === "active"));
    return () => sub.remove();
  });
}

export default function RootLayout() {
  const [i18nReady, setI18nReady] = useState(false);
  const [fontsLoaded] = useFonts({
    Almarai_400Regular,
    Almarai_700Bold,
    Almarai_800ExtraBold,
    Manrope_400Regular,
    Manrope_700Bold,
    Manrope_800ExtraBold,
  });

  useEffect(() => {
    initI18n().finally(() => setI18nReady(true));
  }, []);

  const bootstrapReady = fontsLoaded && i18nReady;
  if (!bootstrapReady) return null;

  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            <LaunchGate bootstrapReady={bootstrapReady}>
              {/* Maintenance / forced update run before the app's own routing. */}
              <AppReleaseGate>
                <ToastProvider>
                  <PushBridge />
                  <StatusBar style="dark" />
                  <Stack
                    screenOptions={{
                      headerShown: false,
                      contentStyle: { backgroundColor: colors.background },
                    }}
                  />
                </ToastProvider>
              </AppReleaseGate>
            </LaunchGate>
          </SessionProvider>
        </QueryClientProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}
