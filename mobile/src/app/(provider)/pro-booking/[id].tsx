import { useEffect, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useTranslation } from "react-i18next";
import { BookOpen, Calendar, Clock, MapPin, Navigation, Phone, User } from "lucide-react-native";
import { bookingMemberAgeTranslation } from "@shared/familyMemberAge";
import { bookingTeachingSummary } from "@shared/tutoring/bookingTeachingSummary";
import { shortBookingCode } from "@/lib/provider/constants";
import {
  isBookingTooEarlyError,
  isProviderCompletionTooEarly,
  providerCompletionMinutesRemaining,
  providerStepOpensAt,
  providerStepWindowState,
} from "@/lib/provider/timeWindow";
import { formatBookingDurationLabel } from "@/lib/bookingDuration";
import { paymentCapturedForJoin } from "@shared/livekit/sessionAccess";
import { useConversationByBooking } from "@/lib/chatQueries";
import { chatPhaseForStatus } from "@/lib/chatPure";
import { useSupportContact } from "@/lib/queries";
import { RescheduleSection } from "@/ui/RescheduleSection";
import { OnlineLessonTimeline } from "@/ui/online/OnlineLessonTimeline";
import { useBookingParty } from "@/lib/provider/parties";
import { useBookingPayment } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { OnlineSessionJoinButton } from "@/ui/OnlineSessionJoinButton";
import { OnlineLessonIssueReport } from "@/ui/OnlineLessonIssueReport";
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
import { useToast } from "@/ui/Toast";
import { bookingAmountDue, carriedFees } from "@shared/payments/amountDue";
import {
  directionsUrl,
  providerMoneyBreakdown,
  requestCountdown,
  requestCountdownLabel,
} from "@shared/provider/providerWorkHelpers";
import { useBookingExpirySettings } from "@/lib/bookingQueries";

export default function ProBookingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { session } = useSession();
  const q = useProviderBooking(id);
  const partyQ = useBookingParty(id);
  const paymentQ = useBookingPayment(id);
  const supportQ = useSupportContact();
  const bookingStatus = String((q.data as { status?: string } | undefined)?.status ?? "");
  const conversation = useConversationByBooking(id, bookingStatus);
  const mut = useProviderUpdateBookingStatus();
  const expiryQ = useBookingExpirySettings();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [dialog, setDialog] = useState<"" | "decline" | "cancel">("");
  const [chatFeedback, setChatFeedback] = useState<"" | "unavailable" | "error">("");

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const b = q.data as Record<string, unknown> | undefined;
  const party = partyQ.data;
  const customer = (b?.customer ?? {}) as { full_name?: string; phone?: string | null };
  const name = party?.other_name || customer.full_name || t("pro.common.customer");
  const isOnline =
    String((b as { service_mode?: string } | undefined)?.service_mode ?? "") === "online";
  const phone = isOnline ? null : (party?.other_phone ?? customer.phone ?? null);
  const service = b?.service as { name_ar?: string; name_en?: string } | undefined;
  const loc = Array.isArray(b?.location) ? b?.location[0] : b?.location;
  const addr = loc as Record<string, string | null> | undefined;
  const zoneName =
    (i18n.language.startsWith("ar") ? party?.zone_name_ar : party?.zone_name_en) || party?.area;
  const status = String(b?.status ?? "");
  const countdown =
    status === "pending" && b?.created_at && b?.start_at
      ? requestCountdown(String(b.created_at), String(b.start_at), expiryQ.data, new Date(nowMs))
      : null;
  const breakdown = b ? providerMoneyBreakdown(b as Parameters<typeof providerMoneyBreakdown>[0]) : null;
  const mapUrl =
    !isOnline && status !== "pending" && addr ? directionsUrl(addr.lat, addr.lng) : null;
  const stepWindow =
    b?.start_at && b?.end_at && status
      ? providerStepWindowState(status, String(b.start_at), String(b.end_at), new Date(nowMs))
      : "not_applicable";
  const tooEarly = stepWindow === "early";
  const stepWindowClosed = stepWindow === "closed";
  const chatOpen = b ? chatPhaseForStatus(status) !== "unavailable" : false;
  const paymentCaptured = paymentCapturedForJoin({
    status: paymentQ.data?.status,
    payment_method_type: paymentQ.data?.payment_method_type,
  });
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

  const openSupport = () => {
    const digits = supportQ.data?.whatsapp?.replace(/\D/g, "");
    if (!digits) {
      router.push("/pro-help");
      return;
    }
    const text = encodeURIComponent(
      t("pro.support.bookingHelpSubject") + ` #${shortBookingCode(String(b?.id ?? ""))}`,
    );
    void Linking.openURL(`https://wa.me/${digits}?text=${text}`).catch(() => router.push("/pro-help"));
  };

  const openBookingChat = async () => {
    setChatFeedback("");
    if (!chatOpen) {
      setChatFeedback("unavailable");
      return;
    }
    const result = await conversation.refetch();
    if (result.isError) setChatFeedback("error");
    else if (!result.data) setChatFeedback("unavailable");
    else router.push({ pathname: "/pro-chat/[id]", params: { id: result.data } });
  };

  const run = (nextStatus: string, onSuccess?: () => void) => {
    mut.mutate(
      { id: id!, status: nextStatus },
      {
        onSuccess: () => {
          toast.show(t("mobile.bookingUpdated"));
          onSuccess?.();
        },
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
    >
      <QueryState query={q} skeleton="detail">
        {b ? (
          <>
            <View
              style={[proCard.card, { flexDirection: "row", alignItems: "center", gap: space.md }]}
            >
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
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("pro.booking.messageCustomer")}
                accessibilityState={{ busy: conversation.isFetching }}
                disabled={conversation.isFetching}
                onPress={() => void openBookingChat()}
                style={{
                  minHeight: 44,
                  minWidth: 44,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text size="sm" tone="brand" weight="bold">
                  {t("pro.booking.messageCustomer")}
                </Text>
              </Pressable>
            </View>
            {!!chatFeedback && (
              <Text size="sm" tone="muted" accessibilityLiveRegion="polite">
                {t(
                  chatFeedback === "error"
                    ? "bookingChat.loadFailed"
                    : "bookingChat.unavailableBody",
                )}
              </Text>
            )}
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
                  {formatBookingDurationLabel(
                    String(b.start_at),
                    String(b.end_at),
                    i18n.language,
                    t,
                  )}
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
              {!isOnline ? (
                <>
                  <View style={proCard.row}>
                    <MapPin size={16} color={colors.brand} />
                    <Text tone="muted" size="sm" style={{ flex: 1 }}>
                      {t("pro.booking.address")}
                    </Text>
                    <Text weight="bold" size="sm" style={{ flex: 1 }}>
                      {status !== "pending" && addr
                        ? [addr.street, addr.building, addr.area, addr.city]
                            .filter(Boolean)
                            .join("، ")
                        : zoneName
                          ? t("pro.booking.areaOnly", { area: zoneName })
                          : t("pro.booking.addressMissing")}
                    </Text>
                  </View>
                  {mapUrl && !["completed", "cancelled", "no_show"].includes(status) ? (
                    <Pressable
                      accessibilityRole="link"
                      accessibilityLabel={t("pro.booking.openMap")}
                      onPress={() => void Linking.openURL(mapUrl).catch(() => undefined)}
                      style={[proCard.row, { justifyContent: "flex-start", minHeight: 44 }]}
                    >
                      <Navigation size={18} color={colors.brand} />
                      <Text weight="bold" tone="brand">
                        {t("pro.booking.openMap")}
                      </Text>
                    </Pressable>
                  ) : null}
                </>
              ) : null}
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
                {money(bookingAmountDue(b), i18n.language)}
              </Text>
            </View>
            {breakdown ? (
              <View style={proCard.card}>
                <View style={proCard.row}>
                  <Text tone="muted" size="sm" style={{ flex: 1 }}>
                    {t("pro.earnings.breakdownBookingValue")}
                  </Text>
                  <Text weight="bold" size="sm" style={moneyTextStyle(i18n.language)}>
                    {money(breakdown.bookingValue, i18n.language)}
                  </Text>
                </View>
                <View style={proCard.row}>
                  <Text tone="muted" size="sm" style={{ flex: 1 }}>
                    {t("pro.earnings.breakdownCommission")}
                  </Text>
                  <Text weight="bold" size="sm" style={moneyTextStyle(i18n.language)}>
                    − {money(breakdown.commission, i18n.language)}
                  </Text>
                </View>
                <View style={proCard.row}>
                  <Text weight="bold" size="sm" style={{ flex: 1 }}>
                    {t("pro.earnings.breakdownNet")}
                  </Text>
                  <Text weight="heavy" tone="brand" style={moneyTextStyle(i18n.language)}>
                    {money(breakdown.net, i18n.language)}
                  </Text>
                </View>
              </View>
            ) : null}
            {carriedFees(b) > 0 ? (
              <Text size="sm" tone="muted">
                {t("pro.booking.carriedFeesNote", { amount: money(carriedFees(b), i18n.language) })}
              </Text>
            ) : null}
            {isOnline ? (
              <OnlineLessonTimeline
                status={status}
                startAt={String(b.start_at)}
                endAt={String(b.end_at)}
                paymentCaptured={paymentCaptured}
                statusChangedAt={(b.status_changed_at as string | null) ?? null}
                amountDue={bookingAmountDue(b)}
              />
            ) : null}
            {typeof b.customer_id === "string" ? (
              <RescheduleSection
                viewer="provider"
                booking={{
                  id: String(b.id),
                  customer_id: String(b.customer_id),
                  status,
                  start_at: String(b.start_at),
                  end_at: String(b.end_at),
                }}
              />
            ) : null}
            {b && typeof b.id === "string" ? (
              <OnlineSessionJoinButton
                booking={{
                  id: String(b.id),
                  service_mode: (b.service_mode as string | null) ?? "in_person",
                  status: String(b.status),
                  customer_id: String(b.customer_id),
                  start_at: String(b.start_at),
                  end_at: String(b.end_at),
                }}
                providerProfileId={session?.user.id}
                viewerUserId={session?.user.id}
                paymentStatus={paymentQ.data?.status}
                paymentMethodType={paymentQ.data?.payment_method_type}
                party="provider"
                onJoin={() =>
                  router.push({
                    pathname: "/pro-booking/[id]/session",
                    params: { id: String(b.id) },
                  })
                }
              />
            ) : null}
            {isOnline && b && typeof b.id === "string" ? (
              <OnlineLessonIssueReport
                bookingId={String(b.id)}
                startAt={String(b.start_at)}
                endAt={String(b.end_at)}
              />
            ) : null}
            <ProviderPaymentBlock bookingId={id!} bookingStatus={status} />
            <ActionError error={mut.error} />
          </>
        ) : null}
      </QueryState>
      {b ? (
        <View style={proCard.dock}>
          {status === "pending" && countdown ? (
            <Text
              size="sm"
              weight="bold"
              tone={countdown.kind === "overdue" || countdown.urgent ? "danger" : "brand"}
              style={{ textAlign: "center" }}
              accessibilityLiveRegion="polite"
            >
              {requestCountdownLabel(countdown, t)}
            </Text>
          ) : null}
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
          {status === "confirmed" && !isOnline ? (
            <>
              <View style={{ gap: space.xs }}>
                <Button
                  label={t("pro.booking.onTheWay")}
                  disabled={tooEarly || stepWindowClosed || mut.isPending}
                  onPress={() => run("on_the_way")}
                />
                {tooEarly && stepOpensAt ? (
                  <Text size="sm" tone="muted" style={{ textAlign: "center" }}>
                    {t("pro.booking.tooEarly")}
                  </Text>
                ) : null}
                {stepWindowClosed ? (
                  <View style={{ gap: space.sm, alignItems: "center" }}>
                    <Text size="sm" tone="muted" style={{ textAlign: "center" }}>
                      {t("pro.booking.bookingTimePassed")}
                    </Text>
                    <Pressable
                      accessibilityRole="link"
                      accessibilityLabel={t("pro.booking.openSupportTicket")}
                      onPress={openSupport}
                      style={{ minHeight: 44, justifyContent: "center" }}
                    >
                      <Text tone="brand" weight="bold">
                        {t("pro.booking.openSupportTicket")}
                      </Text>
                    </Pressable>
                  </View>
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
          {status === "on_the_way" && !isOnline ? (
            <View style={{ gap: space.xs }}>
              <Button
                label={t("pro.booking.iHaveArrived")}
                loading={mut.isPending}
                disabled={stepWindowClosed}
                onPress={() => run("arrived")}
              />
              {stepWindowClosed ? (
                <Text size="sm" tone="muted" style={{ textAlign: "center" }}>
                  {t("pro.booking.bookingTimePassed")}
                </Text>
              ) : null}
            </View>
          ) : null}
          {status === "arrived" && !isOnline ? (
            <Text tone="muted" style={{ textAlign: "center" }}>
              {t("pro.booking.waitingArrivalConfirm")}
            </Text>
          ) : null}
          {status === "arrival_confirmed" && !isOnline ? (
            <View style={{ gap: space.xs }}>
              <Button
                label={t("pro.booking.startService")}
                disabled={tooEarly || stepWindowClosed || mut.isPending}
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
