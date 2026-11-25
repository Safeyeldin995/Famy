import { View } from "react-native";
import { router } from "expo-router";
import { space } from "@/ui/theme";
import { useTranslation } from "react-i18next";
import { CustomerPageHeader } from "@/ui/CustomerPageHeader";
import { Page, QueryState } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { CustomerEmpty } from "@/ui/customer/Primitives";
import { Wallet } from "lucide-react-native";
import { customerMoney } from "@/lib/customerFormat";
import { useWalletBalances, useWalletEntries } from "@/lib/walletQueries";

export default function CustomerWalletScreen() {
  const { t, i18n } = useTranslation();
  const balances = useWalletBalances();
  const entries = useWalletEntries();
  const hasEntries = (entries.data ?? []).length > 0;

  return (
    <Page title={t("wallet.customer.title")} scrollHeader>
      <CustomerPageHeader title={t("wallet.customer.title")} />
      <QueryState query={balances} />
      {balances.data ? (
        <View style={{ gap: space.sm, marginTop: space.md }}>
          <Text weight="bold">
            {t("wallet.customer.availableBalance", {
              amount: customerMoney(balances.data.available_amount, i18n.language),
            })}
          </Text>
          <Text tone="muted" size="sm">
            {t("wallet.customer.balanceHint")}
          </Text>
        </View>
      ) : null}

      <QueryState query={entries} />
      {!entries.isLoading && !entries.isError && !hasEntries ? (
        <CustomerEmpty
          Icon={Wallet}
          title={t("wallet.customer.emptyTitle")}
          body={t("wallet.customer.emptyBody")}
        >
          <Button label={t("wallet.customer.bookNow")} onPress={() => router.push("/home")} />
        </CustomerEmpty>
      ) : null}
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