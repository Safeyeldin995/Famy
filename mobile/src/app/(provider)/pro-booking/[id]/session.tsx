import { useEffect, useState } from "react";
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

export default function ProviderOnlineSessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "prejoin"; token: string; url: string }
    | { status: "ready"; token: string; url: string }
    | { status: "error"; code: string }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchOnlineSessionToken({ bookingId: id })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) setState({ status: "error", code: result.error });
        else setState({ status: "prejoin", token: result.token, url: result.url });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", code: "server_error" });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <Page title={t("onlineSession.title")} scrollHeader>
      <ProviderHeader title={t("onlineSession.title")} onBack={() => router.back()} />
      {state.status === "loading" ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator />
        </View>
      ) : null}
      {state.status === "error" ? (
        <View style={{ gap: 12, padding: 16 }}>
          <Text>{t(`onlineSession.errors.${state.code}`, { defaultValue: state.code })}</Text>
          <Button label={t("onlineSession.joinFailed")} onPress={() => router.back()} />
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
          onLeave={() => router.replace({ pathname: "/pro-booking/[id]", params: { id } })}
        />
      ) : null}
    </Page>
  );
}