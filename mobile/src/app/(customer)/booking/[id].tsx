import { PaymentBlock } from "@/ui/PaymentBlock";
import { BookingActions } from "@/ui/BookingActions";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useBooking, useBookingPayment, useBookingParty } from "@/lib/queries";
import { dateTime, localized, money } from "@/lib/presentation";
import { Page, QueryState, ui } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { Avatar } from "@/ui/ProviderCard";

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
    <Page title={t("customerDetail.title")} queries={[q, payment, party]}>
      {created === "1" && <Text>{t("bookFlow.created")}</Text>}
      {educationWarning === "1" && <Text tone="danger">{t("studentEducation.saveFailed")}</Text>}
      <QueryState query={q} empty={!b}>
        {b && (
          <>
            <View style={ui.card}>
              <QueryState query={party} />
              <Avatar raw={party.party?.other_avatar_url || b.provider?.profile.avatar_url} />
              <Text size="xl" weight="heavy">
                {party.party?.other_name || b.provider?.profile.full_name || t("provider2.unnamed")}
              </Text>
              <Text>{localized(b.service, i18n.language)}</Text>
              <Text tone="brand" weight="bold">
                {t(`status.${b.status}`)}
              </Text>
              <Text style={ui.ltr}>{t("customerDetail.code", { id: b.id.slice(0, 8) })}</Text>
              <Text>{t("mobile.starts", { date: dateTime(b.start_at, i18n.language) })}</Text>
              <Text>{t("mobile.ends", { date: dateTime(b.end_at, i18n.language) })}</Text>
            </View>
            <View style={ui.card}>
              <Text size="xl" weight="heavy">
                {t("mobile.priceBreakdown")}
              </Text>
              {fields.map(
                (field) =>
                  b[`price_${field}`] != null && (
                    <View key={field} style={[ui.wrap, { justifyContent: "space-between" }]}>
                      <Text>{t(`mobile.price.${field}`)}</Text>
                      <Text weight={field === "total" ? "heavy" : "regular"} style={ui.ltr}>
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
