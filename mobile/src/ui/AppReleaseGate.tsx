import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, Image, Linking, Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { useTranslation } from "react-i18next";
import {
  appStoreUpdateUrl,
  decideAppRelease,
  parseAppReleaseSettings,
  parseAppReleaseCache,
  resolveAppReleaseFetch,
  serializeAppReleaseCache,
  APP_RELEASE_CACHE_SCHEMA,
  type AppReleaseDecision,
  type AppReleaseSettings,
  type CachedAppReleaseSnapshot,
} from "@shared/appRelease";
import { supabase } from "@/lib/supabase";
import wordmark from "@/assets/images/famy-wordmark.png";
import { Button } from "./Button";
import { Text } from "./Text";
import { colors, radius, space } from "./theme";

const FETCH_TIMEOUT_MS = 3000;
const DISMISS_KEY = "famy.appRelease.softDismissedVersion";
const CACHE_KEY = "famy.appRelease.decisionCache";
const RECHECK_MS = 5 * 60 * 1000;

type Loaded = { release: AppReleaseSettings; storeLinks: Record<string, unknown> | null };

async function readReleaseCache(): Promise<CachedAppReleaseSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    return parseAppReleaseCache(raw);
  } catch {
    return null;
  }
}

async function writeReleaseCache(loaded: Loaded): Promise<void> {
  const storeLinks = loaded.storeLinks ?? {};
  const snapshot: CachedAppReleaseSnapshot = {
    schema: APP_RELEASE_CACHE_SCHEMA,
    savedAt: Date.now(),
    release: loaded.release,
    storeLinks: {
      play_url: typeof storeLinks.play_url === "string" ? storeLinks.play_url : "",
      app_store_url: typeof storeLinks.app_store_url === "string" ? storeLinks.app_store_url : "",
    },
  };
  try {
    await AsyncStorage.setItem(CACHE_KEY, serializeAppReleaseCache(snapshot));
  } catch {
    // ignore cache write failures
  }
}

/** Reads release settings; on timeout reuses the last cached decision when available. */
async function loadAppRelease(
  cached: CachedAppReleaseSnapshot | null,
): Promise<Loaded | null> {
  let timedOut = false;
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
  const timeout = new Promise<null>((resolve) => {
    setTimeout(() => {
      timedOut = true;
      resolve(null);
    }, FETCH_TIMEOUT_MS);
  });
  let fetched: Loaded | null = null;
  try {
    fetched = await Promise.race([query, timeout]);
  } catch {
    fetched = null;
  }
  if (fetched) {
    await writeReleaseCache(fetched);
    return fetched;
  }
  if (timedOut || !fetched) {
    return resolveAppReleaseFetch(null, cached);
  }
  return null;
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
  const cacheRef = useRef<CachedAppReleaseSnapshot | null>(null);
  const lastCheckAt = useRef(0);

  const check = useCallback(async (force?: boolean) => {
    const now = Date.now();
    if (!force && now - lastCheckAt.current < RECHECK_MS) return;
    lastCheckAt.current = now;
    setChecking(true);
    const cached = cacheRef.current ?? (await readReleaseCache());
    cacheRef.current = cached;
    const result = await loadAppRelease(cached);
    setLoaded(result);
    setChecking(false);
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") return;
    void check(true);
    AsyncStorage.getItem(DISMISS_KEY)
      .then(setDismissedVersion)
      .catch(() => setDismissedVersion(null));
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void check();
    });
    return () => sub.remove();
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
    return <ForceUpdateScreen storeUrl={storeUrl} platform={platform} />;
  }
  const showBanner =
    !!storeUrl && decision.kind === "soft_update" && dismissedVersion !== decision.latest;
  return (
    <View style={styles.flex}>
      {children}
      {showBanner ? (
        <SoftUpdateBanner
          storeUrl={storeUrl!}
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

function ForceUpdateScreen({
  storeUrl,
  platform,
}: {
  storeUrl: string | null;
  platform: "android" | "ios";
}) {
  const { t } = useTranslation();
  const iosNoLink = platform === "ios" && !storeUrl;
  return (
    <FullScreen>
      <Text size="xl" weight="heavy" style={styles.center}>
        {t("appRelease.forceTitle")}
      </Text>
      <Text tone="muted" style={styles.center}>
        {iosNoLink ? t("appRelease.forceIosStore") : t("appRelease.forceBody")}
      </Text>
      {storeUrl ? (
        <Button
          label={t("appRelease.updateNow")}
          onPress={() => void Linking.openURL(storeUrl).catch(() => undefined)}
          style={styles.button}
        />
      ) : null}
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
        accessibilityLabel={t("appRelease.softUpdate")}
        onPress={() => void Linking.openURL(storeUrl).catch(() => undefined)}
        style={styles.bannerAction}
      >
        <Text weight="heavy" tone="brand">
          {t("appRelease.softUpdate")}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("appRelease.softDismiss")}
        onPress={onDismiss}
        style={styles.bannerAction}
      >
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
    start: space.lg,
    end: space.lg,
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
