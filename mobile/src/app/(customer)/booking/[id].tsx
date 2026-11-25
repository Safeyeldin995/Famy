import { PaymentBlock } from "@/ui/PaymentBlock";
import { bookingDurationUnitKey } from "@/lib/bookingDuration";
import { BookingActions } from "@/ui/BookingActions";
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import {
  Calendar,
  Clock,
  Download,
  HelpCircle,
  LifeBuoy,
  MapPin,
  MessageSquare,
  Phone,
  Share2,
} from "lucide-react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import {
  useBooking,
  useBookingPayment,
  useBookingParty,
  useProviderServicePreparationNotes,
  useSupportContact,
} from "@/lib/queries";
import { openCustomerPushExplanationPrompt } from "@/lib/push";
import { hapticSuccess } from "@/ui/haptics";
import { useSession } from "@/lib/session";
import { OnlineSessionJoinButton } from "@/ui/OnlineSessionJoinButton";
import { OnlineLessonIssueReport } from "@/ui/OnlineLessonIssueReport";
import { CustomerPreparationNotesSection } from "@/ui/customer/CustomerPreparationNotesSection";
import { chatPhaseForStatus, useConversationByBooking } from "@/lib/chatQueries";
import { dateTime, localized, money } from "@/lib/presentation";
import { joinUiParts } from "@shared/format/uiJoin";
import { Page, QueryState, moneyTextStyle, ui } from "@/ui/Page";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { Avatar } from "@/ui/ProviderCard";
import { CustomerPageHeader } from "@/ui/CustomerPageHeader";
import { RescheduleSection } from "@/ui/RescheduleSection";
import { receiptText, calendarText, type BookingFileInfo } from "@/lib/bookingFiles";
import { shareBookingFile } from "@/lib/shareBookingFile";
import { colors, radius, space } from "@/ui/theme";
import { BookingJourneyStepper } from "@/ui/BookingJourneyStepper";
import { OnlineLessonTimeline } from "@/ui/online/OnlineLessonTimeline";
import { OnlineLessonPaymentPanel } from "@/ui/online/OnlineLessonPaymentPanel";
import { useBookingStatusHistory } from "@/lib/bookingJourneyQueries";
import {
  isSupervisionMode,
  supervisionModeProviderLabel,
} from "@shared/booking/supervisionMode";
import { bookingAmountDue, carriedFees } from "@shared/payments/amountDue";
import { moneyHeld } from "@shared/payments/refundOwed";

export default function BookingDetail() {
  const { id, created, educationWarning, review, presetRating } = useLocalSearchParams<{
    id: string;
    created?: string;
    educationWarning?: string;
    review?: string;
    presetRating?: string;
  }>();
  const { t, i18n } = useTranslation();
  const { session } = useSession();
  // Poll the status only while this screen is the one being looked at.
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const q = useBooking(id, { live: focused });
  const payment = useBookingPayment(id);
  const support = useSupportContact();
  const party = useBookingParty(id);
  const paymentStatusRef = useRef<string | undefined>(undefined);
  const b = q.data;
  const preparation = useProviderServicePreparationNotes(
    b?.provider_id,
    b?.service_id ?? (b?.service as { id?: string } | undefined)?.id,
  );
  const activeBooking =
    !!b &&
    (b.status === "pending" ||
      b.status === "confirmed" ||
      b.status === "on_the_way" ||
      b.status === "arrived" ||
      b.status === "arrival_confirmed" ||
      b.status === "in_progress" ||
      b.status === "completion_requested");
  const [fileError, setFileError] = useState(false);
  const [chatFeedback, setChatFeedback] = useState<"" | "unavailable" | "error">("");
  const conversation = useConversationByBooking(id, b?.status);
  const journeyHistory = useBookingStatusHistory(id);
  const chatOpen = b ? chatPhaseForStatus(b.status) !== "unavailable" : false;
  const openBookingChat = async () => {
    setChatFeedback("");
    if (!chatOpen) {
      setChatFeedback("unavailable");
      return;
    }
    // Resolve only this booking's authorized conversation; never create one client-side.
    const result = await conversation.refetch();
    if (result.isError) setChatFeedback("error");
    else if (!result.data) setChatFeedback("unavailable");
    else router.push({ pathname: "/chat/[id]", params: { id: result.data } });
  };
  const locale = i18n.language === "ar" ? "ar-EG-u-nu-latn" : "en-EG";
  const location = Array.isArray(b?.location) ? b.location[0] : b?.location;
  const durationHours = b ? Math.round((+new Date(b.end_at) - +new Date(b.start_at)) / 3600000) : 0;
  const durationUnit = t(bookingDurationUnitKey(durationHours, i18n.language));
  const info: BookingFileInfo | null = b
    ? {
        id: b.id.slice(0, 8).toUpperCase(),
        provider:
          party.party?.other_name || b.provider?.profile.full_name || t("provider2.unnamed"),
        service: localized(b.service, i18n.language),
        date: new Intl.DateTimeFormat(locale, {
          weekday: "short",
          month: "short",
          day: "numeric",
        }).format(new Date(b.start_at)),
        time: new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(
          new Date(b.start_at),
        ),
        duration: `${new Intl.NumberFormat(locale).format(durationHours)} ${durationUnit}`,
        address: location
          ? [location.street, location.building, location.compound, location.city]
              .filter(Boolean)
              .join(", ")
          : t("bookingDetail.addressMissing"),
        total: money(bookingAmountDue(b), i18n.language),
        start: b.start_at,
        end: b.end_at,
        online: (b as { service_mode?: string }).service_mode === "online",
        language: i18n.language,
      }
    : null;
  useEffect(() => {
    if (created === "1") openCustomerPushExplanationPrompt();
  }, [created]);

  useEffect(() => {
    const status = payment.data?.status;
    if (status === "captured" && paymentStatusRef.current !== "captured") {
      hapticSuccess();
    }
    paymentStatusRef.current = status;
  }, [payment.data?.status]);

  const initialRating = (() => {
    const n = Number(presetRating);
    return n >= 1 && n <= 5 ? n : 0;
  })();

  const share = async (calendar: boolean) => {
    if (!info) return;
    setFileError(false);
    try {
      await shareBookingFile(
        `famy-${calendar ? "booking" : "receipt"}-${info.id}.${calendar ? "ics" : "txt"}`,
        calendar ? calendarText(info) : receiptText(info),
        calendar ? "text/calendar" : "text/plain",
      );
    } catch {
      setFileError(true);
    }
  };
  const headline =
    b?.status === "pending"
      ? "customerDetail.pending"
      : b?.status === "confirmed"
        ? "bookingDetail.allSet"
        : `status.${b?.status}`;
  const supportPhone = support.data?.phone?.replace(/[^\d+]/g, "");
  const supportWhatsapp = support.data?.whatsapp?.replace(/\D/g, "");
  const fields = [
    "subtotal",
    "extras_total",
    "travel_fee",
    "platform_fee",
    "vat",
    "discount",
    "total",
  ] as const;
  return (
    <Page
      title={t("customerDetail.title")}
      queries={[q, payment, party]}
      header={
        <CustomerPageHeader
          title={t("customerDetail.title")}
          backTo="/bookings"
          right={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("bookingDetail.support")}
              onPress={() => router.push("/help")}
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                borderWidth: 1,
                borderColor: colors.border,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <LifeBuoy size={20} color={colors.foreground} />
            </Pressable>
          }
        />
      }
    >
      {educationWarning === "1" && <Text tone="danger">{t("studentEducation.saveFailed")}</Text>}
      <QueryState query={q} empty={!b} skeleton="detail">
        {b && info && (
          <>
            {created === "1" && (
              <View style={{ gap: space.md }}>
                <Text weight="bold">{t("bookFlow.created")}</Text>
                <Button label={t("bookFlow.goHome")} onPress={() => router.replace("/home")} />
                <Button
                  variant="secondary"
                  label={t("mobile.bookAgain")}
                  onPress={() =>
                    router.push({
                      pathname: "/book/[providerId]",
                      params: {
                        providerId: b.provider_id,
                        rebookFrom: b.id,
                        ...((b as { service_mode?: string }).service_mode === "online"
                          ? { serviceMode: "online" }
                          : {}),
                      },
                    })
                  }
                />
              </View>
            )}
            <View style={[ui.card, { backgroundColor: colors.surface2, gap: space.sm }]}>
              <Text testID="booking-status" size="xs" tone="muted" weight="bold">
                {t(`status.${b.status}`)}
              </Text>
              <Text size="xxl" weight="bold">
                {t(headline)}
              </Text>
              <Text size="xs" tone="muted">
                {t("customerDetail.code", { id: info.id })}
              </Text>
              {(b as { service_mode?: string }).service_mode === "online" ? (
                <OnlineLessonTimeline
                  status={b.status}
                  startAt={b.start_at}
                  endAt={b.end_at}
                  paymentCaptured={moneyHeld({
                    paymentStatus: payment.data?.status,
                    methodType: payment.data?.payment_method_type,
                    proofPath: payment.data?.proof_path,
                  })}
                  statusChangedAt={b.status_changed_at ?? null}
                  amountDue={bookingAmountDue(b)}
                />
              ) : (
                <BookingJourneyStepper
                  status={b.status}
                  booking={{
                    status: b.status,
                    session_started_at: b.session_started_at ?? null,
                    arrival_confirmed_at: b.arrival_confirmed_at ?? null,
                    completion_requested_at: b.completion_requested_at ?? null,
                    completed_at: b.completed_at ?? null,
                  }}
                  history={journeyHistory.data ?? []}
                  labelNamespace="bookingJourney"
                />
              )}
            </View>
            {party.isError && <QueryState query={party} />}
            {b.status === "confirmed" ? (
              <QueryState query={support}>
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  {[
                    {
                      key: "call",
                      Icon: Phone,
                      label: t("bookingDetail.supportCall"),
                      url: supportPhone ? `tel:${supportPhone}` : null,
                    },
                    {
                      key: "whatsapp",
                      Icon: MessageSquare,
                      label: t("bookingDetail.supportWhatsapp"),
                      url: supportWhatsapp ? `https://wa.me/${supportWhatsapp}` : null,
                    },
                  ].map(({ key, Icon, label, url }) => (
                    <Pressable
                      key={key}
                      accessibilityRole="button"
                      accessibilityLabel={label}
                      disabled={!url}
                      onPress={() => url && void Linking.openURL(url)}
                      style={{
                        flex: 1,
                        minHeight: 72,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: radius.lg,
                        backgroundColor: colors.surface,
                        alignItems: "center",
                        justifyContent: "center",
                        gap: space.sm,
                        padding: space.md,
                        opacity: url ? 1 : 0.5,
                      }}
                    >
                      <Icon size={20} color={colors.brand} />
                      <Text size="xs" weight="bold" style={{ textAlign: "center" }}>
                        {label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </QueryState>
            ) : null}
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
              <Avatar
                raw={party.party?.other_avatar_url || b.provider?.profile.avatar_url}
                size={48}
                round
              />
              <View style={{ flex: 1, gap: space.xs }}>
                <Text weight="bold">{info.provider}</Text>
                <Text size="sm" tone="muted">
                  {info.service}
                </Text>
              </View>
              {!!party.party?.other_phone && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("providerProfile.call")}
                  onPress={() => void Linking.openURL(`tel:${party.party!.other_phone}`)}
                  style={{
                    minHeight: 44,
                    minWidth: 44,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Phone size={20} color={colors.foreground} />
                </Pressable>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("provider.message")}
                accessibilityState={{ busy: conversation.isFetching }}
                disabled={conversation.isFetching}
                style={{
                  minHeight: 44,
                  minWidth: 44,
                  alignItems: "center",
                  justifyContent: "center",
                }}
                onPress={() => void openBookingChat()}
              >
                <Text size="sm" tone="brand" weight="bold">
                  {t("provider.message")}
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
            <View
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 16,
                padding: space.lg,
                gap: space.md,
              }}
            >
              <Text size="lg" weight="bold">
                {t("customerDetail.summary")}
              </Text>
              {[
                { Icon: Calendar, label: info.date },
                {
                  Icon: Clock,
                  label: info ? joinUiParts([info.time, info.duration], i18n.language) : "",
                },
                { Icon: MapPin, label: info.address },
                ...(isSupervisionMode(b.supervision_mode)
                  ? [
                      {
                        Icon: HelpCircle,
                        label: supervisionModeProviderLabel(b.supervision_mode, t) ?? "",
                      },
                    ]
                  : []),
              ].map(({ Icon, label }, index) => (
                <View key={index} style={ui.metaIconRow}>
                  <View
                    style={[
                      ui.metaIconSlot,
                      {
                        borderRadius: radius.md,
                        backgroundColor: colors.brandTint,
                      },
                    ]}
                  >
                    <Icon size={16} color={colors.brand} />
                  </View>
                  <Text style={{ flex: 1 }}>{label}</Text>
                </View>
              ))}
              {carriedFees(b) > 0 ? (
                <View style={ui.priceRow}>
                  <Text tone="muted">{t("bookFlow.carriedFees")}</Text>
                  <Text tone="muted">{money(carriedFees(b), i18n.language)}</Text>
                </View>
              ) : null}
              <View
                style={[
                  ui.priceRow,
                  { borderTopWidth: 1, borderColor: colors.border, paddingTop: space.md, marginTop: space.xs },
                ]}
              >
                <Text weight="bold">{t("customerDetail.total")}</Text>
                <Text weight="bold">{info.total}</Text>
              </View>
            </View>
            {activeBooking ? (
              <CustomerPreparationNotesSection notes={preparation.data} />
            ) : null}
            <RescheduleSection booking={b} />
            <View style={ui.card}>
              <Text size="xl" weight="heavy">
                {t("mobile.priceBreakdown")}
              </Text>
              {fields.map(
                (field) =>
                  b[`price_${field}`] != null && (
                    <View key={field} style={[ui.priceRow, field === "total" && ui.priceTotal]}>
                      <Text style={{ flex: 1 }} tone={field === "total" ? "default" : "muted"}>
                        {t(`mobile.price.${field}`)}
                      </Text>
                      <Text
                        size={field === "total" ? "xl" : "md"}
                        tone={field === "total" ? "brand" : "default"}
                        weight={field === "total" ? "heavy" : "regular"}
                        style={moneyTextStyle(i18n.language)}
                      >
                        {money(b[`price_${field}`], i18n.language)}
                      </Text>
                    </View>
                  ),
              )}
            </View>
            <OnlineSessionJoinButton
              booking={b}
              providerProfileId={b.provider?.profile?.id}
              viewerUserId={session?.user.id}
              paymentStatus={payment.data?.status}
              paymentMethodType={payment.data?.payment_method_type}
              proofPath={payment.data?.proof_path}
              party="customer"
              onJoin={() =>
                router.push({ pathname: "/booking/[id]/session", params: { id: b.id } })
              }
            />
            {(b as { service_mode?: string }).service_mode === "online" ? (
              <OnlineLessonIssueReport bookingId={b.id} startAt={b.start_at} endAt={b.end_at} />
            ) : null}
            {(b as { service_mode?: string }).service_mode === "online" &&
            b.status === "confirmed" ? (
              <OnlineLessonPaymentPanel
                bookingId={id}
                total={bookingAmountDue(b)}
                onPaid={() => void q.refetch()}
              />
            ) : (
              <PaymentBlock
                bookingId={id}
                status={b.status}
                total={b.price_total}
                refetchBooking={q.refetch}
              />
            )}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
              {[
                { Icon: Download, key: "receipt", onPress: () => void share(false) },
                { Icon: HelpCircle, key: "support", onPress: () => router.push("/help") },
              ].map(({ Icon, key, onPress }) => (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityLabel={t(`bookingDetail.${key}`)}
                  onPress={onPress}
                  style={{
                    flexGrow: 1,
                    flexBasis: "30%",
                    minWidth: 96,
                    minHeight: 72,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: radius.lg,
                    backgroundColor: colors.surface,
                    paddingHorizontal: space.sm,
                    paddingVertical: space.md,
                    gap: space.sm,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: radius.lg,
                      backgroundColor: colors.brandTint,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Icon size={18} color={colors.brand} />
                  </View>
                  <Text size="xs" weight="bold" style={{ textAlign: "center" }}>
                    {t(`bookingDetail.${key}`)}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={{ flexDirection: "row", gap: space.sm }}>
              {[
                { Icon: Calendar, key: "addCalendar", onPress: () => void share(true) },
                { Icon: Share2, key: "shareBooking", onPress: () => void share(true) },
              ].map(({ Icon, key, onPress }) => (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityLabel={t(`bookingDetail.${key}`)}
                  onPress={onPress}
                  style={{
                    flex: 1,
                    minHeight: 72,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: radius.lg,
                    backgroundColor: colors.surface,
                    paddingHorizontal: space.sm,
                    paddingVertical: space.md,
                    gap: space.sm,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: radius.lg,
                      backgroundColor: colors.brandTint,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Icon size={18} color={colors.brand} />
                  </View>
                  <Text size="xs" weight="bold" style={{ textAlign: "center" }}>
                    {t(`bookingDetail.${key}`)}
                  </Text>
                </Pressable>
              ))}
            </View>
            {fileError && (
              <Text tone="danger" accessibilityLiveRegion="polite">
                {t("common.somethingWentWrong")}
              </Text>
            )}
            <BookingActions
              booking={b}
              suppressRebook={created === "1"}
              initialRating={review === "1" ? initialRating : 0}
            />
          </>
        )}
      </QueryState>
    </Page>
  );
}
