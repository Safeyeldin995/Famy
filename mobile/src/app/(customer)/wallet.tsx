import { View } from "react-native";
import { space } from "@/ui/theme";
import { useTranslation } from "react-i18next";
import { CustomerPageHeader } from "@/ui/CustomerPageHeader";
import { Page, QueryState } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { customerMoney } from "@/lib/customerFormat";
import { useWalletBalances, useWalletEntries } from "@/lib/walletQueries";

export default function CustomerWalletScreen() {
  const { t, i18n } = useTranslation();
  const balances = useWalletBalances();
  const entries = useWalletEntries();

  return (
    <Page title={t("wallet.customer.title")} scrollHeader>
      <CustomerPageHeader title={t("wallet.customer.title")} />
      <Text tone="muted">{t("wallet.customer.terms")}</Text>
      <QueryState query={balances} />
      {balances.data ? (
        <View style={{ gap: space.sm, marginTop: space.md }}>
          <Text weight="bold">
            {t("wallet.customer.availableBalance", {
              amount: customerMoney(balances.data.available_amount, i18n.language),
            })}
          </Text>
        </View>
      ) : null}

      <QueryState query={entries} />
      {(entries.data ?? []).map((entry) => (
        <View key={entry.id} style={{ marginTop: space.md, gap: space.sm }}>
          <Text>
            {t(`wallet.customer.reason.${entry.reason}`, { defaultValue: entry.reason })} ·{" "}
            {entry.direction === "credit" ? "+" : "-"}
            {customerMoney(entry.amount, i18n.language)}
          </Text>
        </View>
      ))}
    </Page>
  );
}