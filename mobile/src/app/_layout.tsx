import "react-native-reanimated";
import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
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
import { LaunchGate } from "@/ui/LaunchGate";
import { colors } from "@/ui/theme";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

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
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <LaunchGate bootstrapReady={bootstrapReady}>
            <PushBridge />
            <StatusBar style="dark" />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.background },
              }}
            />
          </LaunchGate>
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
