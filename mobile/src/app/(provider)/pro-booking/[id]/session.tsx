import { useCallback, useEffect, useState } from "react";
import { space } from "@/ui/theme";
import { View, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { fetchOnlineSessionToken } from "@/lib/onlineSessionApi";
import { OnlineSessionPreJoin } from "@/ui/OnlineSessionPreJoin";
import { OnlineSessionRoom } from "@/ui/OnlineSessionRoom";
import { ProviderHeader } from "@/ui/provider/ProviderHeader";
import { Page } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";

function onlineSessionErrorLabel(code: string, t: (key: string, opts?: { defaultValue?: string }) => string) {
  const key = `onlineSession.errors.${code}`;
  const translated = t(key, { defaultValue: "" });
  if (translated) return translated;
  return t("onlineSession.errors.server_error");
}

export default function ProviderOnlineSessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "prejoin"; token: string; url: string }
    | { status: "ready"; token: string; url: string }
    | { status: "error"; code: string }
  >({ status: "loading" });

  const load = useCallback(() => {
    setState({ status: "loading" });
    return fetchOnlineSessionToken({ bookingId: id })
      .then((result) => {
        if (!result.ok) setState({ status: "error", code: result.error });
        else setState({ status: "prejoin", token: result.token, url: result.url });
      })
      .catch(() => {
        setState({ status: "error", code: "server_error" });
      });
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    void load().then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [attempt, load]);

  return (
    <Page title={t("onlineSession.title")} scrollHeader>
      <ProviderHeader title={t("onlineSession.title")} onBack={() => router.back()} />
      {state.status === "loading" ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator />
        </View>
      ) : null}
      {state.status === "error" ? (
        <View style={{ gap: space.md, padding: space.lg }}>
          <Text weight="heavy" size="lg">
            {t("onlineSession.joinFailed")}
          </Text>
          <Text>{onlineSessionErrorLabel(state.code, t)}</Text>
          <Button
            label={t("onlineSession.retry")}
            onPress={() => setAttempt((n) => n + 1)}
          />
          <Button variant="secondary" label={t("onlineSession.preJoinBack")} onPress={() => router.back()} />
        </View>
      ) : null}
      {state.status === "prejoin" ? (
        <OnlineSessionPreJoin
          onReady={() =>
            setState({ status: "ready", token: state.token, url: state.url })
          }
          onCancel={() => router.back()}
        />
      ) : null}
      {state.status === "ready" ? (
        <OnlineSessionRoom
          bookingId={id!}
          token={state.token}
          serverUrl={state.url}
          party="provider"
          onLeave={() => router.replace({ pathname: "/pro-booking/[id]", params: { id } })}
        />
      ) : null}
    </Page>
  );
}