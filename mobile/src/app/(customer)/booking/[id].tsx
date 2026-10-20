import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useBooking, useBookingPayment, useBookingParty } from "@/lib/queries";
import { dateTime, localized, money } from "@/lib/presentation";
import { Page, QueryState, ui } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { Avatar } from "@/ui/ProviderCard";

export default function BookingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
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
            <Text size="xl" weight="heavy">
              {t("payment.title")}
            </Text>
            <QueryState query={payment} empty={!payment.data} emptyKey="payment.noneRecorded">
              {payment.data && (
                <View style={ui.card}>
                  <Text>
                    {t(`payment.status.${payment.data.status}`, {
                      defaultValue: t("mobile.paymentUnknown"),
                    })}
                  </Text>
                  <Text style={ui.ltr}>{money(payment.data.amount, i18n.language)}</Text>
                  <Text>
                    {(i18n.language === "ar"
                      ? payment.data.payment_method_name_ar
                      : payment.data.payment_method_name_en) || t("payment.title")}
                  </Text>
                </View>
              )}
            </QueryState>
          </>
        )}
      </QueryState>
    </Page>
  );
}
