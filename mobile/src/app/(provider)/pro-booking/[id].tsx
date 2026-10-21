import { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Phone } from "lucide-react-native";
import { shortBookingCode } from "@/lib/provider/constants";
import {
  isBookingTooEarlyError,
  isProviderStepTooEarly,
  providerStepOpensAt,
} from "@/lib/provider/timeWindow";
import { useBookingParty } from "@/lib/provider/parties";
import { useProviderBooking, useProviderUpdateBookingStatus } from "@/lib/provider/queries";
import { localized, money, dateTime } from "@/lib/presentation";
import { DeclineSheet } from "@/ui/provider/DeclineSheet";
import { ProviderPaymentBlock } from "@/ui/provider/ProviderPaymentBlock";
import { proCard } from "@/ui/provider/cards";
import { QueryState, ActionError, ui } from "@/ui/Page";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { colors, space } from "@/ui/theme";

export default function ProBookingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const q = useProviderBooking(id);
  const partyQ = useBookingParty(id);
  const mut = useProviderUpdateBookingStatus();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [dialog, setDialog] = useState<"" | "decline" | "cancel">("");

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const b = q.data as Record<string, unknown> | undefined;
  const party = partyQ.data;
  const customer = (b?.customer ?? {}) as { full_name?: string; phone?: string | null };
  const name = party?.other_name || customer.full_name || t("pro.common.customer");
  const phone = party?.other_phone ?? customer.phone ?? null;
  const service = b?.service as { name_ar?: string; name_en?: string } | undefined;
  const loc = Array.isArray(b?.location) ? b?.location[0] : b?.location;
  const addr = loc as Record<string, string | null> | undefined;
  const zoneName =
    (i18n.language.startsWith("ar") ? party?.zone_name_ar : party?.zone_name_en) || party?.area;
  const status = String(b?.status ?? "");
  const tooEarly =
    b?.start_at && status
      ? isProviderStepTooEarly(status, String(b.start_at), new Date(nowMs))
      : false;
  const stepOpensAt =
    b?.start_at && status ? providerStepOpensAt(status, String(b.start_at)) : null;

  const run = (nextStatus: string, onSuccess?: () => void) => {
    mut.mutate(
      { id: id!, status: nextStatus },
      {
        onSuccess,
        onError: (e: Error) => {
          if (isBookingTooEarlyError(e)) {
            mut.reset();
          }
        },
      },
    );
  };

  return (
    <ScrollView contentContainerStyle={[ui.content, { paddingBottom: 120 }]}>
      <QueryState query={q}>
        {b ? (
          <>
            <View style={proCard.card}>
              <Text weight="heavy" size="lg">
                {name}
              </Text>
              <Text tone="muted" size="sm">
                {t("proWork.bookingLabel")} #{shortBookingCode(String(b.id))}
              </Text>
              <Text tone="brand" weight="bold">
                {t(`pro.statuses.${status}`, status)}
              </Text>
            </View>
            <View style={proCard.card}>
              <Text weight="bold">{localized(service, i18n.language)}</Text>
              <Text tone="muted">{dateTime(String(b.start_at), i18n.language)}</Text>
              <Text>
                {status !== "pending" && addr
                  ? [addr.street, addr.building, addr.area, addr.city].filter(Boolean).join("، ")
                  : zoneName
                    ? t("pro.booking.areaOnly", { area: zoneName })
                    : t("pro.booking.addressMissing")}
              </Text>
              {phone ? (
                <Pressable
                  accessibilityRole="link"
                  onPress={() => Linking.openURL(`tel:${phone}`)}
                  style={[proCard.row, { justifyContent: "flex-start" }]}
                >
                  <Phone size={18} color={colors.brand} />
                  <Text weight="bold" tone="brand">
                    {phone}
                  </Text>
                </Pressable>
              ) : null}
              <Text weight="heavy" tone="brand" size="lg">
                {money(Number(b.price_total ?? 0), i18n.language)}
              </Text>
            </View>
            <ProviderPaymentBlock bookingId={id!} bookingStatus={status} />
            {tooEarly && stepOpensAt ? <Text tone="muted">{t("pro.booking.tooEarly")}</Text> : null}
            <ActionError error={mut.error} />
          </>
        ) : null}
      </QueryState>
      {b ? (
        <View style={proCard.dock}>
          {status === "pending" ? (
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <Button
                variant="secondary"
                label={t("pro.booking.decline")}
                onPress={() => setDialog("decline")}
                style={{ flex: 1 }}
              />
              <Button
                label={t("pro.booking.accept")}
                loading={mut.isPending}
                onPress={() => run("confirmed")}
                style={{ flex: 1 }}
              />
            </View>
          ) : null}
          {status === "confirmed" ? (
            <>
              <Button
                label={t("pro.booking.onTheWay")}
                disabled={tooEarly || mut.isPending}
                onPress={() => run("on_the_way")}
              />
              <Button
                variant="ghost"
                label={t("pro.booking.cancelJob")}
                onPress={() => setDialog("cancel")}
              />
            </>
          ) : null}
          {status === "on_the_way" ? (
            <Button
              label={t("pro.booking.iHaveArrived")}
              loading={mut.isPending}
              onPress={() => run("arrived")}
            />
          ) : null}
          {status === "arrived" ? (
            <Text tone="muted" style={{ textAlign: "center" }}>
              {t("pro.booking.waitingArrivalConfirm")}
            </Text>
          ) : null}
          {status === "arrival_confirmed" ? (
            <Button
              label={t("pro.booking.startService")}
              disabled={tooEarly || mut.isPending}
              onPress={() => run("in_progress")}
            />
          ) : null}
          {status === "in_progress" ? (
            <Button
              label={t("pro.booking.requestCompletion")}
              disabled={tooEarly || mut.isPending}
              onPress={() => run("completion_requested")}
            />
          ) : null}
          {status === "completion_requested" ? (
            <Text tone="muted" style={{ textAlign: "center" }}>
              {t("pro.booking.waitingCompletionConfirm")}
            </Text>
          ) : null}
          {["completed", "cancelled", "no_show", "disputed"].includes(status) ? (
            <Button
              variant="secondary"
              label={t("pro.booking.backToJobs")}
              onPress={() => router.back()}
            />
          ) : null}
        </View>
      ) : null}
      <DeclineSheet
        bookingId={id!}
        visible={dialog === "decline" || dialog === "cancel"}
        onClose={() => setDialog("")}
        title={
          dialog === "decline" ? t("pro.booking.declineConfirm") : t("pro.booking.cancelConfirm")
        }
      />
    </ScrollView>
  );
}
