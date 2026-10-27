import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { useFeaturedPromoCodes, useMyPromoRedemptions } from "@/lib/queries";
import { money } from "@/lib/presentation";
import { Tag } from "lucide-react-native";
import { CustomerEmpty, customerStyle } from "@/ui/customer/Primitives";
import { colors } from "@/ui/theme";
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
      contentStyle={{ paddingTop: 8, gap: 32 }}
    >
      <View style={{ gap: 12 }}>
        <View style={customerStyle.row}>
          <Tag size={16} color={colors.brand} />
          <Text weight="heavy" tone="muted">
            {t("promoCodes.available")}
          </Text>
        </View>
        <QueryState query={q}>
          {!q.data?.length ? (
            <CustomerEmpty
              Icon={Tag}
              title={t("promoCodes.availableEmpty")}
              body={t("promoCodes.availableEmptyBody")}
            />
          ) : null}
          {q.data?.map((p) => (
            <PromoCard key={p.id} offer={p} />
          ))}
        </QueryState>
      </View>
      <View style={{ gap: 12 }}>
        <Text weight="heavy" tone="muted">
          {t("promoCodes.history")}
        </Text>
        <QueryState query={used}>
          {!used.data?.length ? (
            <CustomerEmpty
              Icon={Tag}
              title={t("promoCodes.historyEmpty")}
              body={t("promoCodes.historyEmptyBody")}
            />
          ) : null}
          {used.data?.map((p) => (
            <View
              key={p.id}
              style={[customerStyle.card, { borderRadius: 28, backgroundColor: colors.surface2 }]}
            >
              <View style={customerStyle.row}>
                <Text weight="heavy" style={ui.ltr}>
                  {p.bookings?.promo_code || t("profile.promoCodes")}
                </Text>
                <View style={ui.badge}>
                  <Text size="xs" tone="muted">
                    {t("promoCodes.used")}
                  </Text>
                </View>
              </View>
              <Text size="xs" weight="bold" tone="muted">
                {new Date(p.redeemed_at).toLocaleDateString(
                  i18n.language === "ar" ? "ar-EG-u-nu-latn" : "en-EG",
                  { day: "numeric", month: "short", year: "numeric" },
                )}{" "}
                · {money(p.discount_amount, i18n.language)}
              </Text>
            </View>
          ))}
        </QueryState>
      </View>
    </Page>
  );
}
