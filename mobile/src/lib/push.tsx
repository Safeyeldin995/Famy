import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, View } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { mapNotificationDeepLink } from "./deepLinks";
import { resolveWorkspace, useSession, type Workspace } from "./session";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";

const PROMPT_SEEN_KEY = "famy.mobilePush.promptSeen";
const ACTIVE_TOKEN_KEY = "famy.mobilePush.activeToken";

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

let androidChannelReady = false;

async function ensureAndroidChannel() {
  if (androidChannelReady || Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("default", {
    name: "Famy",
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: colors.brand,
  });
  androidChannelReady = true;
}

function expoProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId;
}

async function fetchExpoPushToken(): Promise<string | null> {
  const projectId = expoProjectId();
  if (!projectId) return null;
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  return token.data ?? null;
}

async function registerTokenWithBackend(token: string) {
  const platform = Platform.OS === "ios" ? "ios" : "android";
  const { error } = await supabase.rpc("register_device_push_token", {
    p_token: token,
    p_platform: platform,
  });
  if (error) throw error;
  await AsyncStorage.setItem(ACTIVE_TOKEN_KEY, token);
}

export async function revokeActivePushToken(): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(ACTIVE_TOKEN_KEY);
    if (token) {
      await supabase.rpc("revoke_device_push_token", { p_token: token });
      await AsyncStorage.removeItem(ACTIVE_TOKEN_KEY);
    }
  } catch {
    // Best-effort before sign-out; never block logout.
  }
}

export async function signOutWithPushRevoke(): Promise<{ error: Error | null }> {
  await revokeActivePushToken();
  const { error } = await supabase.auth.signOut();
  return { error: error ?? null };
}

function deepLinkFromResponse(
  response: Notifications.NotificationResponse | null | undefined,
): string | null {
  const data = response?.notification.request.content.data as { deepLink?: unknown } | undefined;
  return typeof data?.deepLink === "string" ? data.deepLink : null;
}

function navigateDeepLink(deepLink: string | null, workspace: Workspace) {
  const target = mapNotificationDeepLink(deepLink, workspace);
  if ("params" in target && target.params) {
    router.push({ pathname: target.pathname, params: target.params });
  } else {
    router.push(target.pathname);
  }
}

async function syncPushRegistration(): Promise<void> {
  if (!Device.isDevice || Platform.OS === "web") return;
  await ensureAndroidChannel();
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing !== "granted") return;
  const token = await fetchExpoPushToken();
  if (!token) return;
  await registerTokenWithBackend(token);
}

/** Explicit customer settings action; never report success without backend registration. */
export async function enableCustomerPushNotifications(): Promise<void> {
  if (!Device.isDevice || Platform.OS === "web") throw new Error("unsupported");
  await ensureAndroidChannel();
  const permission = await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted") throw new Error("denied");
  const token = await fetchExpoPushToken();
  if (!token) throw new Error("unconfigured");
  await registerTokenWithBackend(token);
}

export function PushBridge() {
  const { session, ready } = useSession();
  const { t } = useTranslation();
  const [promptOpen, setPromptOpen] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const handledColdStart = useRef(false);

  useEffect(() => {
    if (!session?.user.id) {
      setWorkspace(null);
      return;
    }
    let cancelled = false;
    resolveWorkspace(session.user.id).then((r) => {
      if (!cancelled) setWorkspace(r.workspace);
    });
    return () => {
      cancelled = true;
    };
  }, [session?.user.id]);

  const runPromptFlow = useCallback(async () => {
    if (!Device.isDevice || Platform.OS === "web" || !session) return;
    try {
      const seen = await AsyncStorage.getItem(PROMPT_SEEN_KEY);
      const { status: existing } = await Notifications.getPermissionsAsync();
      if (existing === "granted") {
        await syncPushRegistration();
        return;
      }
      if (existing === "denied") return;
      if (!seen) {
        setPromptOpen(true);
        return;
      }
      const { status } = await Notifications.requestPermissionsAsync();
      if (status === "granted") await syncPushRegistration();
    } catch {
      // Permission or token failures must not break the app shell.
    }
  }, [session, workspace]);

  useEffect(() => {
    if (!ready || !session) return;
    void runPromptFlow();
  }, [ready, session, runPromptFlow]);

  useEffect(() => {
    if (!session || !workspace || Platform.OS === "web") return;

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      navigateDeepLink(deepLinkFromResponse(response), workspace);
    });

    if (!handledColdStart.current) {
      handledColdStart.current = true;
      void Notifications.getLastNotificationResponseAsync().then((response) => {
        if (response) navigateDeepLink(deepLinkFromResponse(response), workspace);
      });
    }

    return () => sub.remove();
  }, [session, workspace]);

  const onEnable = async () => {
    setPromptOpen(false);
    await AsyncStorage.setItem(PROMPT_SEEN_KEY, "1");
    const { status } = await Notifications.requestPermissionsAsync();
    if (status === "granted") await syncPushRegistration();
  };

  const onDismiss = async () => {
    setPromptOpen(false);
    await AsyncStorage.setItem(PROMPT_SEEN_KEY, "1");
  };

  if (!promptOpen) return null;

  const bodyKey = workspace === "provider" ? "mobilePush.bodyProvider" : "mobilePush.bodyCustomer";

  return (
    <Modal transparent animationType="fade" visible={promptOpen} onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text weight="heavy" size="lg">
            {t("mobilePush.title")}
          </Text>
          <Text tone="muted">{t(bodyKey)}</Text>
          <View style={styles.actions}>
            <Button label={t("mobilePush.enable")} onPress={() => void onEnable()} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("mobilePush.notNow")}
              onPress={() => void onDismiss()}
              style={styles.notNow}
            >
              <Text tone="muted">{t("mobilePush.notNow")}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: space.xl,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: space.xl,
    gap: space.md,
  },
  actions: { gap: space.sm, marginTop: space.sm },
  notNow: { minHeight: 44, alignItems: "center", justifyContent: "center" },
});
