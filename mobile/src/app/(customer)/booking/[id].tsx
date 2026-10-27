import { PaymentBlock } from "@/ui/PaymentBlock";
import { BookingActions } from "@/ui/BookingActions";
import { useState } from "react";
import { Linking, Pressable, View } from "react-native";
import {
  Calendar,
  Clock,
  Download,
  HelpCircle,
  LifeBuoy,
  MapPin,
  Phone,
} from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useBooking, useBookingPayment, useBookingParty } from "@/lib/queries";
import { chatPhaseForStatus, useConversationByBooking } from "@/lib/chatQueries";
import { dateTime, localized, money } from "@/lib/presentation";
import { Page, QueryState, ui } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { Avatar } from "@/ui/ProviderCard";
import { CustomerPageHeader } from "@/ui/CustomerPageHeader";
import { RescheduleSection } from "@/ui/RescheduleSection";
import { receiptText, calendarText, type BookingFileInfo } from "@/lib/bookingFiles";
import { shareBookingFile } from "@/lib/shareBookingFile";
import { colors } from "@/ui/theme";

export default function BookingDetail() {
  const { id, created, educationWarning } = useLocalSearchParams<{
    id: string;
    created?: string;
    educationWarning?: string;
  }>();
  const { t, i18n } = useTranslation();
  const q = useBooking(id);
  const payment = useBookingPayment(id);
  const party = useBookingParty(id);
  const b = q.data;
  const [fileError, setFileError] = useState(false);
  const [chatFeedback, setChatFeedback] = useState<"" | "unavailable" | "error">("");
  const conversation = useConversationByBooking(id, b?.status);
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
  const durationUnit =
    i18n.language === "ar"
      ? new Intl.PluralRules("ar").select(durationHours) === "few"
        ? "ساعات"
        : "ساعة"
      : durationHours === 1
        ? "hour"
        : "hours";
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
        total: money(b.price_total ?? 0, i18n.language),
        start: b.start_at,
        end: b.end_at,
      }
    : null;
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
      {created === "1" && <Text>{t("bookFlow.created")}</Text>}
      {educationWarning === "1" && <Text tone="danger">{t("studentEducation.saveFailed")}</Text>}
      <QueryState query={q} empty={!b}>
        {b && info && (
          <>
            <View
              style={[
                {
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.surface2,
                  borderRadius: 16,
                  padding: 16,
                  gap: 4,
                },
              ]}
            >
              <Text size="xs" tone="muted" weight="bold">
                {t(`status.${b.status}`)}
              </Text>
              <Text size="xxl" weight="bold">
                {t(headline)}
              </Text>
              <Text size="xs" tone="muted" style={{ marginTop: 4 }}>
                {t("customerDetail.code", { id: info.id })}
              </Text>
            </View>
            {party.isError && <QueryState query={party} />}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Avatar
                raw={party.party?.other_avatar_url || b.provider?.profile.avatar_url}
                size={56}
                round
              />
              <View style={{ flex: 1, gap: 4 }}>
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
                padding: 16,
                gap: 12,
              }}
            >
              <Text size="lg" weight="bold">
                {t("customerDetail.summary")}
              </Text>
              {[
                { Icon: Calendar, label: info.date },
                { Icon: Clock, label: `${info.time} · ${info.duration}` },
                { Icon: MapPin, label: info.address },
              ].map(({ Icon, label }, index) => (
                <View key={index} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 12,
                      backgroundColor: colors.brandTint,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Icon size={16} color={colors.brand} />
                  </View>
                  <Text style={{ flex: 1 }}>{label}</Text>
                </View>
              ))}
              <View
                style={[
                  ui.priceRow,
                  { borderTopWidth: 1, borderColor: colors.border, paddingTop: 12, marginTop: 4 },
                ]}
              >
                <Text weight="bold">{t("customerDetail.total")}</Text>
                <Text weight="bold">{info.total}</Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {[
                { Icon: Download, key: "receipt", onPress: () => void share(false) },
                { Icon: Calendar, key: "addCalendar", onPress: () => void share(true) },
                { Icon: HelpCircle, key: "support", onPress: () => router.push("/help") },
              ].map(({ Icon, key, onPress }) => (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityLabel={t(`bookingDetail.${key}`)}
                  onPress={onPress}
                  style={{
                    flex: 1,
                    minHeight: 90,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 20,
                    backgroundColor: colors.surface,
                    padding: 12,
                    gap: 8,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      backgroundColor: colors.brandTint,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Icon size={20} color={colors.brand} />
                  </View>
                  <Text size="xs" weight="bold">
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
                        style={ui.ltr}
                      >
                        {money(b[`price_${field}`], i18n.language)}
                      </Text>
                    </View>
                  ),
              )}
            </View>
            <PaymentBlock
              bookingId={id}
              status={b.status}
              total={b.price_total}
              refetchBooking={q.refetch}
            />
            <BookingActions booking={b} />
          </>
        )}
      </QueryState>
    </Page>
  );
}
