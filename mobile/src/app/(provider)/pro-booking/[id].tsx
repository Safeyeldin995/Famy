import { useEffect, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useTranslation } from "react-i18next";
import { BookOpen, Calendar, Clock, MapPin, Phone, User } from "lucide-react-native";
import { bookingMemberAgeTranslation } from "@shared/familyMemberAge";
import { bookingTeachingSummary } from "@shared/tutoring/bookingTeachingSummary";
import { shortBookingCode } from "@/lib/provider/constants";
import {
  isBookingTooEarlyError,
  isProviderCompletionTooEarly,
  isProviderStepTooEarly,
  providerCompletionMinutesRemaining,
  providerStepOpensAt,
} from "@/lib/provider/timeWindow";
import { useBookingParty } from "@/lib/provider/parties";
import { useProviderBooking, useProviderUpdateBookingStatus } from "@/lib/provider/queries";
import { localized, money, dateTime } from "@/lib/presentation";
import { joinUiParts } from "@shared/format/uiJoin";
import { DeclineSheet } from "@/ui/provider/DeclineSheet";
import { ProviderPaymentBlock } from "@/ui/provider/ProviderPaymentBlock";
import { ProviderHeader } from "@/ui/provider/ProviderHeader";
import { BookingStatusCard } from "@/ui/provider/BookingStatusCard";
import { proCard } from "@/ui/provider/cards";
import { Page, QueryState, ActionError, moneyTextStyle } from "@/ui/Page";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { colors, space } from "@/ui/theme";
import { isSupervisionMode, supervisionModeProviderLabel } from "@shared/booking/supervisionMode";

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
    b?.start_at && b?.end_at && status
      ? isProviderStepTooEarly(status, String(b.start_at), String(b.end_at), new Date(nowMs))
      : false;
  const stepOpensAt =
    b?.start_at && b?.end_at && status
      ? providerStepOpensAt(status, String(b.start_at), String(b.end_at))
      : null;
  const completionTooEarly =
    b?.start_at && b?.end_at && status === "in_progress"
      ? isProviderCompletionTooEarly(
          {
            start_at: String(b.start_at),
            end_at: String(b.end_at),
            session_started_at: (b.session_started_at as string | null) ?? null,
            arrival_confirmed_at: (b.arrival_confirmed_at as string | null) ?? null,
          },
          new Date(nowMs),
        )
      : false;
  const completionMinutesLeft =
    completionTooEarly && b?.start_at && b?.end_at
      ? providerCompletionMinutesRemaining(
          {
            start_at: String(b.start_at),
            end_at: String(b.end_at),
            session_started_at: (b.session_started_at as string | null) ?? null,
            arrival_confirmed_at: (b.arrival_confirmed_at as string | null) ?? null,
          },
          new Date(nowMs),
        )
      : 0;

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
    <Page
      title={t("pro.booking.title")}
      header={<ProviderHeader title={t("pro.booking.title")} />}
      queries={[q]}
      contentStyle={{ paddingBottom: 120 }}
    >
      <QueryState query={q}>
        {b ? (
          <>
            <View style={[proCard.card, { flexDirection: "row", alignItems: "center", gap: 12 }]}>
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: colors.brandTint,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text weight="heavy" tone="brand">
                  {name.slice(0, 1)}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text weight="heavy" size="lg">
                  {name}
                </Text>
                <Text tone="muted" size="xs" style={{ writingDirection: "ltr" }}>
                  {t("proWork.bookingLabel")} #{shortBookingCode(String(b.id))}
                </Text>
              </View>
            </View>
            <BookingStatusCard
              bookingId={id!}
              status={status}
              booking={{
                status,
                session_started_at: (b.session_started_at as string | null) ?? null,
                arrival_confirmed_at: (b.arrival_confirmed_at as string | null) ?? null,
                completion_requested_at: (b.completion_requested_at as string | null) ?? null,
                completed_at: (b.completed_at as string | null) ?? null,
              }}
            />
            <View style={proCard.card}>
              <View style={proCard.row}>
                <User size={16} color={colors.brand} />
                <Text tone="muted" size="sm" style={{ flex: 1 }}>
                  {t("pro.booking.service")}
                </Text>
                <Text weight="bold" size="sm" style={{ flex: 1 }}>
                  {localized(service, i18n.language)}
                </Text>
              </View>
              <View style={proCard.row}>
                <Calendar size={16} color={colors.brand} />
                <Text tone="muted" size="sm" style={{ flex: 1 }}>
                  {t("pro.booking.date")}
                </Text>
                <Text weight="bold" size="sm" style={{ flex: 1 }}>
                  {dateTime(String(b.start_at), i18n.language)}
                </Text>
              </View>
              <View style={proCard.row}>
                <Clock size={16} color={colors.brand} />
                <Text tone="muted" size="sm" style={{ flex: 1 }}>
                  {t("pro.booking.time")}
                </Text>
                <Text weight="bold" size="sm" style={{ flex: 1 }}>
                  {Math.max(
                    1,
                    Math.round(
                      (+new Date(String(b.end_at)) - +new Date(String(b.start_at))) / 36e5,
                    ),
                  )}{" "}
                  {t("scheduleUi.hoursUnit")}
                </Text>
              </View>
              {party?.member_first_name ? (
                <View style={proCard.row}>
                  <User size={16} color={colors.brand} />
                  <Text tone="muted" size="sm" style={{ flex: 1 }}>
                    {t("pro.booking.forWhom")}
                  </Text>
                  <Text weight="bold" size="sm" style={{ flex: 1 }}>
                    {joinUiParts(
                      [
                        party.member_first_name,
                        t(bookingMemberAgeTranslation(party).key, {
                          count: bookingMemberAgeTranslation(party).count,
                        }),
                      ],
                      i18n.language,
                    )}
                  </Text>
                </View>
              ) : null}
              {bookingTeachingSummary(b, i18n.language) ? (
                <View style={proCard.row}>
                  <BookOpen size={16} color={colors.brand} />
                  <Text tone="muted" size="sm" style={{ flex: 1 }}>
                    {t("pro.booking.subject")}
                  </Text>
                  <Text weight="bold" size="sm" style={{ flex: 1 }}>
                    {bookingTeachingSummary(b, i18n.language)}
                  </Text>
                </View>
              ) : null}
              {isSupervisionMode(b.supervision_mode as string | null | undefined) ? (
                <View style={proCard.row}>
                  <User size={16} color={colors.brand} />
                  <Text tone="muted" size="sm" style={{ flex: 1 }}>
                    {t("bookFlow.supervision.label")}
                  </Text>
                  <Text weight="bold" size="sm" style={{ flex: 1 }}>
                    {supervisionModeProviderLabel(String(b.supervision_mode), t)}
                  </Text>
                </View>
              ) : null}
              <View style={proCard.row}>
                <MapPin size={16} color={colors.brand} />
                <Text tone="muted" size="sm" style={{ flex: 1 }}>
                  {t("pro.booking.address")}
                </Text>
                <Text weight="bold" size="sm" style={{ flex: 1 }}>
                  {status !== "pending" && addr
                    ? [addr.street, addr.building, addr.area, addr.city].filter(Boolean).join("، ")
                    : zoneName
                      ? t("pro.booking.areaOnly", { area: zoneName })
                      : t("pro.booking.addressMissing")}
                </Text>
              </View>
              {phone ? (
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={`${t("helpC.call")} ${phone}`}
                  onPress={() => Linking.openURL(`tel:${phone}`)}
                  style={[proCard.row, { justifyContent: "flex-start" }]}
                >
                  <Phone size={18} color={colors.brand} />
                  <Text weight="bold" tone="brand" style={{ writingDirection: "ltr" }}>
                    {phone}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            <View style={[proCard.card, { flexDirection: "row", justifyContent: "space-between" }]}>
              <Text weight="bold">{t("pro.booking.total")}</Text>
              <Text weight="heavy" tone="brand" size="lg" style={moneyTextStyle(i18n.language)}>
                {money(Number(b.price_total ?? 0), i18n.language)}
              </Text>
            </View>
            <ProviderPaymentBlock bookingId={id!} bookingStatus={status} />
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
              <View style={{ gap: space.xs }}>
                <Button
                  label={t("pro.booking.onTheWay")}
                  disabled={tooEarly || mut.isPending}
                  onPress={() => run("on_the_way")}
                />
                {tooEarly && stepOpensAt ? (
                  <Text size="sm" tone="muted" style={{ textAlign: "center" }}>
                    {t("pro.booking.tooEarly")}
                  </Text>
                ) : null}
              </View>
              <Button
                variant="ghost"
                label={t("pro.booking.cancelJob")}
                disabled={mut.isPending}
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
            <View style={{ gap: space.xs }}>
              <Button
                label={t("pro.booking.startService")}
                disabled={tooEarly || mut.isPending}
                onPress={() => run("in_progress")}
              />
              {tooEarly && stepOpensAt ? (
                <Text size="sm" tone="muted" style={{ textAlign: "center" }}>
                  {t("pro.booking.tooEarly")}
                </Text>
              ) : null}
            </View>
          ) : null}
          {status === "in_progress" ? (
            <View style={{ gap: space.xs }}>
              <Button
                label={t("pro.booking.requestCompletion")}
                disabled={completionTooEarly || mut.isPending}
                onPress={() => run("completion_requested")}
              />
              {completionTooEarly ? (
                <Text size="sm" tone="muted" style={{ textAlign: "center" }}>
                  {t("pro.booking.completionWaitMinutes", { count: completionMinutesLeft })}
                </Text>
              ) : null}
            </View>
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
    </Page>
  );
}
