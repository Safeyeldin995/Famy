import { useState } from "react";
import { Linking, Pressable, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Button } from "@/ui/Button";
import { BrandLogo } from "@/ui/PaymentLogos";
import { useFamyInstapay } from "@/lib/provider/payoutQueries";
import { useTranslation } from "react-i18next";
import { Text } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";
import { money, dateTime } from "@/lib/presentation";
import { moneyTextStyle } from "@/ui/Page";
import {
  useProviderCashDebtBlocked,
  useProviderSettlementBalance,
  useProviderSettlementSettings,
  useProviderWalletBookings,
  useProviderWalletLedger,
} from "@/lib/provider/settlementQueries";
import { walletBookingRows, walletState, walletTransferRows } from "@shared/settlement/walletView";

function Signed({ value, language }: { value: number; language: string }) {
  // Sign and amount in separate texts so right-to-left layout never flips them.
  const color = value < 0 ? colors.destructive : colors.success;
  return (
    <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
      <Text weight="heavy" style={{ color }}>
        {value < 0 ? "-" : "+"}
      </Text>
      <Text weight="heavy" style={[{ color }, moneyTextStyle(language)]}>
        {money(Math.abs(value), language)}
      </Text>
    </View>
  );
}

/** Uber-style wallet for providers: balance, how it works, bookings and transfers. */
export function ProviderWalletPanel({ providerId }: { providerId: string | undefined }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const balance = useProviderSettlementBalance(providerId);
  const settings = useProviderSettlementSettings();
  const ledger = useProviderWalletLedger(providerId);
  const bookings = useProviderWalletBookings(ledger.data);
  const blockedQ = useProviderCashDebtBlocked(providerId);
  const [howOpen, setHowOpen] = useState(false);
  const famyInstapay = useFamyInstapay();
  const [copied, setCopied] = useState(false);

  if (!providerId) return null;

  const net = balance.data?.net ?? 0;
  const state = walletState(net);
  const limit = settings.data?.cash_debt_limit ?? 1000;
  const blocked = blockedQ.data === true;
  const bookingRows = walletBookingRows(ledger.data ?? [], bookings.data ?? new Map());
  const transfers = walletTransferRows(ledger.data ?? []);
  const amountColor =
    state === "providerOwes"
      ? colors.destructive
      : state === "famyOwes"
        ? colors.success
        : colors.foreground;

  const card = {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: space.md,
    gap: space.sm,
  } as const;
  const row = {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: space.sm,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
  } as const;

  return (
    <View style={{ gap: 12 }}>
      <View style={card}>
        <Text weight="heavy">{t("wallet.pro.title")}</Text>
        <Text tone="muted" size="xs">
          {t("wallet.pro.balanceLabel")}
        </Text>
        {balance.isLoading ? (
          <Text tone="muted">{t("common.loading")}</Text>
        ) : balance.isError ? (
          <Text tone="danger">{t("wallet.pro.loadError")}</Text>
        ) : (
          <>
            <Text
              size="hero"
              weight="heavy"
              style={[{ color: amountColor }, state === "even" ? null : moneyTextStyle(lang)]}
            >
              {state === "even" ? t("wallet.pro.even") : money(Math.abs(net), lang)}
            </Text>
            {state !== "even" ? <Text weight="bold">{t(`wallet.pro.${state}`)}</Text> : null}
            <Text tone="muted" size="sm">
              {t(`wallet.pro.${state}Hint`)}
            </Text>
            {blocked ? (
              <View
                style={{ backgroundColor: "#FBE7E6", borderRadius: radius.md, padding: space.sm }}
              >
                <Text size="sm" weight="bold" tone="danger">
                  {t("wallet.pro.blocked", { limit: money(limit, lang) })}
                </Text>
              </View>
            ) : null}
            {state === "providerOwes" &&
            (famyInstapay.data?.handle || famyInstapay.data?.payLink) ? (
              <View
                style={{
                  gap: 8,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: colors.border,
                  padding: space.sm,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <BrandLogo brand="instapay" height={12} />
                  <Text weight="bold" style={{ flexShrink: 1 }}>
                    {t("payout.pro.payInTitle")}
                  </Text>
                </View>
                <Text size="sm" tone="muted">
                  {t("payout.pro.payInBody")}
                </Text>
                {famyInstapay.data.handle ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("payout.pro.copy")}
                    onPress={() =>
                      void Clipboard.setStringAsync(famyInstapay.data!.handle).then(() =>
                        setCopied(true),
                      )
                    }
                    style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}
                  >
                    <Text weight="bold" style={{ writingDirection: "ltr" }}>
                      {famyInstapay.data.handle}
                    </Text>
                    <Text size="sm" weight="bold" tone="brand">
                      {copied ? t("payout.pro.copied") : t("payout.pro.copy")}
                    </Text>
                  </Pressable>
                ) : null}
                {famyInstapay.data.payLink ? (
                  <Button
                    label={t("payout.pro.payInOpen")}
                    onPress={() => void Linking.openURL(famyInstapay.data!.payLink).catch(() => {})}
                  />
                ) : null}
              </View>
            ) : null}
          </>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("wallet.pro.howTitle")}
          onPress={() => setHowOpen((v) => !v)}
          style={{ paddingVertical: 6 }}
        >
          <Text size="sm" weight="heavy" tone="brand">
            {t("wallet.pro.howTitle")}
          </Text>
        </Pressable>
        {howOpen ? (
          <View style={{ gap: 4 }}>
            {(["how1", "how2", "how3"] as const).map((k) => (
              <Text key={k} size="sm" tone="muted">
                {`• ${t(`wallet.pro.${k}`)}`}
              </Text>
            ))}
          </View>
        ) : null}
      </View>

      <View style={card}>
        <Text weight="heavy">{t("wallet.pro.bookingsTitle")}</Text>
        {ledger.isLoading ? (
          <Text tone="muted" size="sm">
            {t("common.loading")}
          </Text>
        ) : ledger.isError ? (
          <Text tone="danger" size="sm">
            {t("wallet.pro.loadError")}
          </Text>
        ) : bookingRows.length === 0 ? (
          <Text tone="muted" size="sm">
            {t("wallet.pro.bookingsEmpty")}
          </Text>
        ) : (
          bookingRows.map((r) => (
            <View key={`${r.bookingId}-${r.method}`} style={row}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text weight="bold" size="sm">
                  {r.method === "fee"
                    ? t("wallet.pro.cancellationFee")
                    : r.method === "carried"
                      ? t("wallet.pro.carriedFee")
                      : r.price != null
                        ? t(r.method === "cash" ? "wallet.pro.paidCash" : "wallet.pro.paidOnline", {
                            amount: money(r.price, lang),
                          })
                        : t(
                            r.method === "cash"
                              ? "wallet.pro.cashBooking"
                              : "wallet.pro.onlineBooking",
                          )}
                </Text>
                <Text size="xs" tone="muted">
                  {dateTime(r.at, lang)}
                </Text>
                <Text size="xs" tone="muted">
                  {[
                    r.commission != null
                      ? `${t("wallet.pro.commission")}: ${money(r.commission, lang)}`
                      : null,
                    r.providerNet != null
                      ? `${t("wallet.pro.providerNet")}: ${money(r.providerNet, lang)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </View>
              <Signed value={r.effect} language={lang} />
            </View>
          ))
        )}
      </View>

      <View style={card}>
        <Text weight="heavy">{t("wallet.pro.transfersTitle")}</Text>
        {ledger.isLoading ? (
          <Text tone="muted" size="sm">
            {t("common.loading")}
          </Text>
        ) : ledger.isError ? (
          <Text tone="danger" size="sm">
            {t("wallet.pro.loadError")}
          </Text>
        ) : transfers.length === 0 ? (
          <Text tone="muted" size="sm">
            {t("wallet.pro.transfersEmpty")}
          </Text>
        ) : (
          transfers.map((r) => (
            <View key={r.id} style={row}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text weight="bold" size="sm">
                  {t(`wallet.pro.transfer.${r.kind}`)}
                </Text>
                <Text size="xs" tone="muted">
                  {dateTime(r.at, lang)}
                  {r.reference ? ` · ${r.reference}` : ""}
                </Text>
              </View>
              <Signed value={r.effect} language={lang} />
            </View>
          ))
        )}
      </View>
    </View>
  );
}
