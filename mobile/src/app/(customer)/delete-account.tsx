import { useEffect, useMemo, useState } from "react";
import { router, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { View, TextInput, StyleSheet } from "react-native";
import { Page, ActionError } from "@/ui/Page";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";
import { supabase } from "@/lib/supabase";
import { revokeActivePushToken } from "@/lib/push";
import { requestMobileAccountDeletion } from "@/lib/accountDeletion";
import { CustomerPageHeader } from "@/ui/CustomerPageHeader";
import { bodyTextInputProps } from "@/ui/a11y";

type DeletionCheck = { ok: boolean; reason?: string; wallet_forfeit_amount?: number };

function leaveTo(backTo: Href) {
  if (router.canGoBack()) router.back();
  else router.navigate(backTo);
}

export default function DeleteAccountScreen({ backTo = "/profile" as Href }: { backTo?: Href }) {
  const { t } = useTranslation();
  const [check, setCheck] = useState<DeletionCheck | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [walletForfeitConfirmed, setWalletForfeitConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const confirmWord = t("accountDeletion.confirmWord");
  const confirmMatches = useMemo(
    () => confirmText.trim() === confirmWord,
    [confirmText, confirmWord],
  );

  const runDeletionCheck = async () => {
    setCheck(null);
    const { data, error } = await supabase.rpc("account_deletion_check");
    if (error) {
      setCheck({ ok: false, reason: "not_authenticated" });
      return;
    }
    setCheck((data ?? { ok: false, reason: "not_authenticated" }) as DeletionCheck);
  };

  useEffect(() => {
    void runDeletionCheck();
  }, []);

  const blockedReason = !check?.ok ? check?.reason : undefined;
  const walletForfeitAmount =
    check?.ok && check.wallet_forfeit_amount != null ? Number(check.wallet_forfeit_amount) : 0;
  const needsWalletForfeitConfirm = walletForfeitAmount > 0.005;

  const onDelete = async () => {
    if (!confirmMatches || !check?.ok) return;
    if (needsWalletForfeitConfirm && !walletForfeitConfirmed) return;
    setBusy(true);
    setActionError(false);
    setErrorKey(null);
    try {
      const result = await requestMobileAccountDeletion({
        confirmWalletForfeit: needsWalletForfeitConfirm && walletForfeitConfirmed,
      });
      if (!result.ok) {
        setErrorKey(`accountDeletion.errors.${result.error}`);
        setActionError(true);
        return;
      }
      await revokeActivePushToken();
      await supabase.auth.signOut();
      router.replace("/login");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page
      title={t("accountDeletion.title")}
      header={
        <CustomerPageHeader
          title={t("accountDeletion.title")}
          backTo={backTo}
          onBack={() => leaveTo(backTo)}
        />
      }
      contentStyle={{ gap: space.xxl }}
    >
      <Text tone="muted">{t("accountDeletion.intro")}</Text>
      <View style={styles.card}>
        <Text weight="bold">{t("accountDeletion.deletedTitle")}</Text>
        {(t("accountDeletion.deletedItems", { returnObjects: true }) as string[]).map((item) => (
          <Text key={item} tone="muted" size="sm">
            • {item}
          </Text>
        ))}
      </View>
      <View style={styles.card}>
        <Text weight="bold">{t("accountDeletion.keptTitle")}</Text>
        <Text tone="muted" size="sm">
          {t("accountDeletion.keptBody")}
        </Text>
      </View>
      {!check && (
        <Text size="sm" tone="muted">
          {t("accountDeletion.checking")}
        </Text>
      )}
      {blockedReason === "not_authenticated" && (
        <>
          <Text tone="danger">{t("accountDeletion.errors.unauthorized")}</Text>
          <Button
            variant="secondary"
            label={t("common.retry")}
            onPress={() => void runDeletionCheck()}
          />
        </>
      )}
      {blockedReason === "active_bookings" ? (
        <Text tone="danger">{t("accountDeletion.blockedActiveBookings")}</Text>
      ) : null}
      {blockedReason === "funds_owed_to_user" ? (
        <Text tone="danger">{t("accountDeletion.blockedFundsOwed")}</Text>
      ) : null}
      {blockedReason === "unpaid_balance" ? (
        <Text tone="danger">{t("accountDeletion.blockedUnpaid")}</Text>
      ) : null}
      {blockedReason === "admin" ? (
        <Text tone="danger">{t("accountDeletion.blockedAdmin")}</Text>
      ) : null}
      {check?.ok && needsWalletForfeitConfirm ? (
        <View style={styles.warnCard}>
          <Text weight="bold">
            {t("accountDeletion.walletForfeitWarning", {
              amount: walletForfeitAmount.toFixed(2),
            })}
          </Text>
          <Text
            tone="brand"
            size="sm"
            onPress={() => setWalletForfeitConfirmed((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: walletForfeitConfirmed }}
          >
            {walletForfeitConfirmed ? "☑ " : "☐ "}
            {t("accountDeletion.walletForfeitConfirm")}
          </Text>
        </View>
      ) : null}
      {check?.ok ? (
        <>
          <Text>{t("accountDeletion.typeConfirm", { word: confirmWord })}</Text>
          <TextInput
            {...bodyTextInputProps()}
            accessibilityLabel={t("accountDeletion.typeConfirm", { word: confirmWord })}
            style={styles.input}
            value={confirmText}
            onChangeText={setConfirmText}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text size="xs" tone="muted">
            {t("accountDeletion.confirmHint")}
          </Text>
        </>
      ) : null}
      {errorKey ? <Text tone="danger">{t(errorKey)}</Text> : null}
      <ActionError error={actionError} />
      <Button
        style={{ backgroundColor: colors.destructive }}
        label={busy ? t("accountDeletion.deleting") : t("accountDeletion.deleteButton")}
        disabled={
          !check?.ok ||
          !confirmMatches ||
          busy ||
          (needsWalletForfeitConfirm && !walletForfeitConfirmed)
        }
        onPress={() => void onDelete()}
      />
      <Button
        variant="secondary"
        label={t("common.cancel")}
        disabled={busy}
        onPress={() => leaveTo(backTo)}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space.sm,
    padding: space.lg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  warnCard: {
    gap: space.md,
    padding: space.lg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: colors.surface,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.md,
    color: colors.foreground,
  },
});
