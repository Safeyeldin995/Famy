import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Image, Linking, Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { useTranslation } from "react-i18next";
import {
  appStoreUpdateUrl,
  decideAppRelease,
  parseAppReleaseSettings,
  type AppReleaseDecision,
  type AppReleaseSettings,
} from "@shared/appRelease";
import { supabase } from "@/lib/supabase";
import wordmark from "@/assets/images/famy-wordmark.png";
import { Button } from "./Button";
import { Text } from "./Text";
import { colors, radius, space } from "./theme";

const FETCH_TIMEOUT_MS = 3000;
const DISMISS_KEY = "famy.appRelease.softDismissedVersion";

type Loaded = { release: AppReleaseSettings; storeLinks: Record<string, unknown> | null };

/** Reads the release settings; any error or a 3s timeout returns null (the user gets in). */
async function loadAppRelease(): Promise<Loaded | null> {
  const query = supabase
    .from("settings")
    .select("key, value")
    .in("key", ["app_release", "store_links"])
    .then(({ data, error }) => {
      if (error || !data) return null;
      const byKey = new Map(data.map((row) => [row.key as string, row.value]));
      if (!byKey.has("app_release")) return null;
      return {
        release: parseAppReleaseSettings(byKey.get("app_release") as Record<string, unknown>),
        storeLinks: (byKey.get("store_links") as Record<string, unknown> | undefined) ?? null,
      };
    });
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS));
  try {
    return await Promise.race([query, timeout]);
  } catch {
    return null;
  }
}

/**
 * Launch check before the app's own routing: maintenance mode, forced update below
 * the minimum version, and a dismissible banner below the latest version.
 * Never blocks on a network error.
 */
export function AppReleaseGate({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [checking, setChecking] = useState(false);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);

  const check = useCallback(async () => {
    setChecking(true);
    const result = await loadAppRelease();
    setLoaded(result);
    setChecking(false);
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") return;
    void check();
    AsyncStorage.getItem(DISMISS_KEY)
      .then(setDismissedVersion)
      .catch(() => setDismissedVersion(null));
  }, [check]);

  if (Platform.OS === "web") return <>{children}</>;

  const platform = Platform.OS === "ios" ? "ios" : "android";
  const decision: AppReleaseDecision = decideAppRelease(
    loaded?.release ?? null,
    Constants.expoConfig?.version,
    platform,
    i18n.language,
  );
  const storeUrl = appStoreUpdateUrl(platform, loaded?.storeLinks);

  if (decision.kind === "maintenance") {
    return <MaintenanceScreen message={decision.message} checking={checking} onRetry={check} />;
  }
  if (decision.kind === "force_update") {
    return <ForceUpdateScreen storeUrl={storeUrl} />;
  }
  const showBanner = decision.kind === "soft_update" && dismissedVersion !== decision.latest;
  return (
    <View style={styles.flex}>
      {children}
      {showBanner ? (
        <SoftUpdateBanner
          storeUrl={storeUrl}
          onDismiss={() => {
            setDismissedVersion(decision.latest);
            AsyncStorage.setItem(DISMISS_KEY, decision.latest).catch(() => undefined);
          }}
        />
      ) : null}
    </View>
  );
}

function FullScreen({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.full,
        { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xl },
      ]}
      accessibilityLiveRegion="polite"
    >
      <Image
        source={wordmark}
        style={styles.logo}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
      />
      {children}
    </View>
  );
}

function MaintenanceScreen({
  message,
  checking,
  onRetry,
}: {
  message: string;
  checking: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  return (
    <FullScreen>
      <Text size="xl" weight="heavy" style={styles.center}>
        {t("appRelease.maintenanceTitle")}
      </Text>
      <Text tone="muted" style={styles.center}>
        {message || t("appRelease.maintenanceDefault")}
      </Text>
      <Button
        label={t("appRelease.retry")}
        loading={checking}
        onPress={onRetry}
        style={styles.button}
      />
    </FullScreen>
  );
}

function ForceUpdateScreen({ storeUrl }: { storeUrl: string }) {
  const { t } = useTranslation();
  return (
    <FullScreen>
      <Text size="xl" weight="heavy" style={styles.center}>
        {t("appRelease.forceTitle")}
      </Text>
      <Text tone="muted" style={styles.center}>
        {t("appRelease.forceBody")}
      </Text>
      <Button
        label={t("appRelease.updateNow")}
        onPress={() => void Linking.openURL(storeUrl).catch(() => undefined)}
        style={styles.button}
      />
    </FullScreen>
  );
}

function SoftUpdateBanner({ storeUrl, onDismiss }: { storeUrl: string; onDismiss: () => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.banner, { bottom: insets.bottom + space.lg }]} accessibilityRole="alert">
      <Text weight="bold" style={styles.bannerText}>
        {t("appRelease.softBanner")}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => void Linking.openURL(storeUrl).catch(() => undefined)}
        style={styles.bannerAction}
      >
        <Text weight="heavy" tone="brand">
          {t("appRelease.softUpdate")}
        </Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onDismiss} style={styles.bannerAction}>
        <Text tone="muted">{t("appRelease.softDismiss")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  full: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    gap: space.lg,
    paddingHorizontal: space.xl,
  },
  logo: { width: 140, height: 48, marginBottom: space.md },
  center: { textAlign: "center" },
  button: { alignSelf: "stretch", marginTop: space.md },
  banner: {
    position: "absolute",
    left: space.lg,
    right: space.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  bannerText: { flex: 1 },
  bannerAction: { minHeight: 44, justifyContent: "center", paddingHorizontal: space.sm },
});
