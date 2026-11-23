import { View } from "react-native";
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
    <Page title={t("wallet.title")} scrollHeader>
      <CustomerPageHeader title={t("wallet.title")} />
      <QueryState query={balances} />
      {balances.data ? (
        <View style={{ gap: 8 }}>
          <Text weight="bold">
            {t("wallet.availableBalance", {
              amount: customerMoney(balances.data.available_amount, i18n.language),
            })}
          </Text>
          <Text size="sm" tone="muted">
            {t("wallet.terms")}
          </Text>
        </View>
      ) : null}

      <QueryState query={entries} />
      {(entries.data ?? []).map((entry) => (
        <View key={entry.id} style={{ marginTop: 12, gap: 6 }}>
          <Text>
            {t(`wallet.reason.${entry.reason}`, { defaultValue: entry.reason })} ·{" "}
            {entry.direction === "credit" ? "+" : "-"}
            {customerMoney(entry.amount, i18n.language)}
          </Text>
        </View>
      ))}
    </Page>
  );
}