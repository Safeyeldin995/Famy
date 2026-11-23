import { useEffect, useRef, useState } from "react";
import { View, StyleSheet, Linking, Platform } from "react-native";
import { useTranslation } from "react-i18next";
import * as ImagePicker from "expo-image-picker";
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
  const [networkOk, setNetworkOk] = useState<boolean | null>(null);
  const [autoSkipped, setAutoSkipped] = useState(false);
  const advanceScheduled = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cam = await ImagePicker.getCameraPermissionsAsync();
      if (cancelled) return;
      if (cam.granted) {
        setCameraReady(true);
        setMicReady(true);
      }
      if (!cam.granted) {
        const req = await ImagePicker.requestCameraPermissionsAsync();
        if (req.granted) {
          setCameraReady(true);
          setMicReady(true);
        }
      }
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
    };
  }, []);

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
        label={t("onlineSession.preJoinMic")}
        actionLabel={t("onlineSession.preJoinConfirmReady")}
        onAction={() => setMicReady(true)}
        settingsLabel={t("onlineSession.preJoinOpenSettings")}
        onSettings={openSettings}
      />
      <CheckRow
        ok={cameraReady}
        label={t("onlineSession.preJoinCamera")}
        actionLabel={t("onlineSession.preJoinConfirmReady")}
        onAction={() => setCameraReady(true)}
        settingsLabel={t("onlineSession.preJoinOpenSettings")}
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

function CheckRow({
  label,
  ok,
  pending,
  actionLabel,
  onAction,
  settingsLabel,
  onSettings,
}: {
  label: string;
  ok?: boolean;
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