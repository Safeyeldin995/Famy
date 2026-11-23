import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { CustomerPageHeader } from "@/ui/CustomerPageHeader";
import { Page, QueryState } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { customerMoney } from "@/lib/customerFormat";
import {
  useRequestWalletRefund,
  useWalletBalances,
  useWalletEntries,
  useWalletRefundRequests,
} from "@/lib/walletQueries";

export default function CustomerWalletScreen() {
  const { t, i18n } = useTranslation();
  const balances = useWalletBalances();
  const entries = useWalletEntries();
  const refunds = useWalletRefundRequests();
  const requestRefund = useRequestWalletRefund();

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
          {balances.data.held_amount > 0 ? (
            <Text size="sm" tone="muted">
              {t("wallet.pendingRefundHold", {
                amount: customerMoney(balances.data.held_amount, i18n.language),
              })}
            </Text>
          ) : null}
        </View>
      ) : null}

      <QueryState query={refunds} />
      {(refunds.data ?? []).length > 0 ? (
        <View style={{ gap: 8, marginTop: 16 }}>
          <Text weight="bold">{t("wallet.refundRequests")}</Text>
          {refunds.data!.map((r) => (
            <Text key={r.id} size="sm">
              {t(`wallet.refundStatus.${r.status}`, { defaultValue: r.status })} ·{" "}
              {customerMoney(r.amount, i18n.language)}
            </Text>
          ))}
        </View>
      ) : null}

      <QueryState query={entries} />
      {(entries.data ?? []).map((entry) => {
        const openRefund =
          entry.direction === "credit" &&
          entry.reason === "provider_cancelled" &&
          !(refunds.data ?? []).some(
            (r) =>
              r.wallet_entry_id === entry.id &&
              ["pending", "approved", "completed"].includes(r.status),
          );
        return (
          <View key={entry.id} style={{ marginTop: 12, gap: 6 }}>
            <Text>
              {t(`wallet.reason.${entry.reason}`, { defaultValue: entry.reason })} ·{" "}
              {entry.direction === "credit" ? "+" : "-"}
              {customerMoney(entry.amount, i18n.language)}
            </Text>
            {openRefund ? (
              <Button
                label={t("wallet.requestPaymentRefund")}
                variant="secondary"
                disabled={requestRefund.isPending}
                onPress={() => requestRefund.mutate(entry.id)}
              />
            ) : null}
          </View>
        );
      })}
    </Page>
  );
}