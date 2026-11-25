import { useCallback, useEffect, useRef, useState } from "react";
import { View, StyleSheet, Linking, Platform } from "react-native";
import { useTranslation } from "react-i18next";
import { permissions } from "@livekit/react-native-webrtc";
import { Text } from "./Text";
import { Button } from "./Button";
import { space } from "./theme";
import { appConfig } from "@/lib/supabase";

type Props = {
  onReady: () => void;
  onCancel: () => void;
};

export function OnlineSessionPreJoin({ onReady, onCancel }: Props) {
  const { t } = useTranslation();
  const [micReady, setMicReady] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const [cameraDenied, setCameraDenied] = useState(false);
  const [networkOk, setNetworkOk] = useState<boolean | null>(null);
  const [autoSkipped, setAutoSkipped] = useState(false);
  const advanceScheduled = useRef(false);

  const isCancelled = useRef(false);

  // Checks each device on its own: a denied mic must never be shown as ready.
  const requestDevice = useCallback(async (name: "microphone" | "camera") => {
    const setReady = name === "microphone" ? setMicReady : setCameraReady;
    const setDenied = name === "microphone" ? setMicDenied : setCameraDenied;
    try {
      const granted = await ensureMediaPermission(name);
      if (isCancelled.current) return;
      setReady(granted);
      setDenied(!granted);
    } catch {
      if (isCancelled.current) return;
      setReady(false);
      setDenied(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    isCancelled.current = false;
    void (async () => {
      // One system prompt at a time.
      await requestDevice("microphone");
      await requestDevice("camera");
    })();
    fetch(`${appConfig.webOrigin.replace(/\/$/, "")}/api/session/capabilities`, {
      method: "GET",
      headers: { "Cache-Control": "no-store" },
    })
      .then((r) => {
        if (!cancelled) setNetworkOk(r.ok);
      })
      .catch(() => {
        if (!cancelled) setNetworkOk(false);
      });
    return () => {
      cancelled = true;
      isCancelled.current = true;
    };
  }, [requestDevice]);

  useEffect(() => {
    if (advanceScheduled.current) return;
    if (!(micReady && cameraReady && networkOk === true)) return;
    advanceScheduled.current = true;
    const timer = setTimeout(() => {
      setAutoSkipped(true);
      onReady();
    }, 350);
    return () => clearTimeout(timer);
  }, [cameraReady, micReady, networkOk, onReady]);

  const ready = micReady && cameraReady && networkOk === true;

  const openSettings = () => {
    if (Platform.OS === "ios") void Linking.openURL("app-settings:");
    else void Linking.openSettings();
  };

  return (
    <View style={styles.wrap}>
      <Text size="lg" weight="bold">
        {t("onlineSession.preJoinTitle")}
      </Text>
      <Text tone="muted">{t("onlineSession.preJoinHintShort")}</Text>
      {autoSkipped && ready ? (
        <Text tone="muted">{t("onlineSession.preJoinAutoReady")}</Text>
      ) : null}
      <CheckRow
        ok={micReady}
        denied={micDenied}
        label={t("onlineSession.preJoinMic")}
        actionLabel={t("onlineSession.retry")}
        onAction={() => void requestDevice("microphone")}
        settingsLabel={t("onlineSession.openSettings")}
        onSettings={openSettings}
      />
      <CheckRow
        ok={cameraReady}
        denied={cameraDenied}
        label={t("onlineSession.preJoinCamera")}
        actionLabel={t("onlineSession.retry")}
        onAction={() => void requestDevice("camera")}
        settingsLabel={t("onlineSession.openSettings")}
        onSettings={openSettings}
      />
      <CheckRow
        ok={networkOk === true}
        label={t("onlineSession.preJoinNetwork")}
        pending={networkOk === null}
      />
      <View style={styles.actions}>
        <Button label={t("onlineSession.preJoinContinue")} disabled={!ready} onPress={onReady} />
        <Button label={t("onlineSession.preJoinBack")} variant="secondary" onPress={onCancel} />
      </View>
    </View>
  );
}

async function ensureMediaPermission(name: "microphone" | "camera"): Promise<boolean> {
  const current = await permissions.query({ name });
  if (current === permissions.RESULT.GRANTED) return true;
  const granted = await permissions.request({ name });
  return granted === true || granted === permissions.RESULT.GRANTED;
}

function CheckRow({
  label,
  ok,
  denied,
  pending,
  actionLabel,
  onAction,
  settingsLabel,
  onSettings,
}: {
  label: string;
  ok?: boolean;
  denied?: boolean;
  pending?: boolean;
  actionLabel?: string;
  onAction?: () => void;
  settingsLabel?: string;
  onSettings?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      <Text>
        {label} {pending ? t("onlineSession.preJoinChecking") : ok ? "✓" : "…"}
      </Text>
      {denied && !ok ? (
        <Text tone="danger" size="sm">
          {t("onlineSession.preJoinDenied")}
        </Text>
      ) : null}
      {!ok && !pending && onAction && actionLabel ? (
        <View style={styles.rowActions}>
          <Button label={actionLabel} variant="secondary" onPress={onAction} />
          {onSettings && settingsLabel ? (
            <Button label={settingsLabel} variant="secondary" onPress={onSettings} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md, paddingVertical: space.md },
  row: { gap: space.sm },
  rowActions: { gap: space.sm },
  actions: { gap: space.sm, marginTop: space.md },
});