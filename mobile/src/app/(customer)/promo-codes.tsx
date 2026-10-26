import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { useFeaturedPromoCodes, useMyPromoRedemptions } from "@/lib/queries";
import { dateTime, money } from "@/lib/presentation";
import { Page, QueryState, ui } from "@/ui/Page";
import { PromoCard } from "@/ui/PromoCard";
import { Text } from "@/ui/Text";
import { CustomerPageHeader } from "@/ui/CustomerPageHeader";
export default function Promos() {
  const { t, i18n } = useTranslation();
  const q = useFeaturedPromoCodes();
  const used = useMyPromoRedemptions();
  return (
    <Page
      title={t("profile.promoCodes")}
      queries={[q, used]}
      header={<CustomerPageHeader hero title={t("promoCodes.title")} backTo="/profile" />}
    >
      <QueryState query={q} empty={!q.data?.length}>
        {q.data?.map((p) => (
          <PromoCard key={p.id} offer={p} />
        ))}
      </QueryState>
      <Text size="xl" weight="heavy">
        {t("mobile.promoHistory")}
      </Text>
      <QueryState query={used} empty={!used.data?.length}>
        {used.data?.map((p) => (
          <View key={p.id} style={ui.card}>
            <Text weight="heavy" style={ui.ltr}>
              {p.bookings?.promo_code || t("profile.promoCodes")}
            </Text>
            <Text style={ui.ltr}>{money(p.discount_amount, i18n.language)}</Text>
            <Text tone="muted">{dateTime(p.redeemed_at, i18n.language)}</Text>
          </View>
        ))}
      </QueryState>
    </Page>
  );
}
