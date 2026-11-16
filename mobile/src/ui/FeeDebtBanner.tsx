import { useState } from "react";
import { Linking, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSession } from "@/lib/session";
import { useMyFeeDebts, useSubmitDebtInstapay } from "@/lib/debtQueries";
import { useFamyInstapay } from "@/lib/provider/payoutQueries";
import { startFeeDebtCheckout } from "@/lib/mobilePayments";
import { money } from "@/lib/presentation";
import { Button } from "./Button";
import { Text } from "./Text";
import { Field } from "./Page";
import { BrandLogo, PaymentLogos } from "./PaymentLogos";
import { colors, radius, space } from "./theme";

/**
 * Unpaid cancellation fees: the customer cannot book again until they pay them
 * (card through Paymob, or InstaPay confirmed by Famy). Renders nothing when clear.
 */
export function FeeDebtBanner() {
  const { t, i18n } = useTranslation();
  const { session } = useSession();
  const uid = session?.user.id;
  const debts = useMyFeeDebts(uid);
  const submit = useSubmitDebtInstapay(uid);
  const famyInstapay = useFamyInstapay();
  const [mode, setMode] = useState<"choose" | "instapay">("choose");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState(false);

  const d = debts.data;
  if (!d || d.total <= 0) return null;
  const lang = i18n.language;

  return (
    <View
      style={{
        gap: space.sm,
        padding: space.md,
        borderRadius: radius.xl,
        borderWidth: 1,
        borderColor: colors.destructive,
        backgroundColor: colors.surface,
      }}
    >
      <Text weight="heavy">{t("feeDebt.title", { amount: money(d.total, lang) })}</Text>
      <Text size="sm" tone="muted">
        {t("feeDebt.body")}
      </Text>
      {confirming ? (
        <Text size="sm" weight="bold">
          {t("feeDebt.confirming")}
        </Text>
      ) : null}
      {d.inReview ? (
        <Text size="sm" weight="bold">
          {t("feeDebt.inReview")}
        </Text>
      ) : mode === "choose" ? (
        <>
          {d.lastRejected ? (
            <Text size="sm" tone="danger">
              {t("feeDebt.rejected", { reason: d.lastRejected.rejection_reason ?? "" })}
            </Text>
          ) : null}
          <PaymentLogos height={14} />
          <Button
            label={t("feeDebt.payCard")}
            loading={busy}
            onPress={async () => {
              setBusy(true);
              setMessage("");
              try {
                await startFeeDebtCheckout();
                // Paymob confirms through the webhook a few seconds later: wait for it
                // instead of offering to pay again.
                setConfirming(true);
                for (let i = 0; i < 10; i++) {
                  await new Promise((r) => setTimeout(r, 3000));
                  const next = await debts.refetch();
                  if ((next.data?.total ?? 0) <= 0) break;
                }
              } catch {
                setMessage(t("feeDebt.cardFailed"));
              } finally {
                setConfirming(false);
                setBusy(false);
              }
            }}
          />
          <Button
            variant="secondary"
            label={t("feeDebt.payInstapay")}
            onPress={() => setMode("instapay")}
          />
        </>
      ) : (
        <>
          <BrandLogo brand="instapay" height={12} />
          <Text size="sm">{t("feeDebt.instapaySteps", { amount: money(d.total, lang) })}</Text>
          {famyInstapay.data?.payLink ? (
            <Button
              variant="secondary"
              label={t("payout.pro.payInOpen")}
              onPress={() => void Linking.openURL(famyInstapay.data!.payLink).catch(() => {})}
            />
          ) : null}
          {famyInstapay.data?.handle ? (
            <Text size="sm" weight="bold" style={{ writingDirection: "ltr" }}>
              {famyInstapay.data.handle}
            </Text>
          ) : null}
          <Field
            label={t("feeDebt.reference")}
            value={reference}
            onChangeText={setReference}
            autoCapitalize="characters"
            ltr
          />
          <Button
            label={t("feeDebt.sendReference")}
            loading={submit.isPending}
            disabled={reference.trim().length < 4}
            onPress={() =>
              submit.mutate(reference.trim(), {
                onSuccess: () => {
                  setMode("choose");
                  setReference("");
                },
                onError: () => setMessage(t("common.somethingWentWrong")),
              })
            }
          />
          <Button
            variant="secondary"
            label={t("payout.pro.cancel")}
            onPress={() => setMode("choose")}
          />
        </>
      )}
      {message ? (
        <Text size="sm" tone="danger">
          {message}
        </Text>
      ) : null}
    </View>
  );
}
