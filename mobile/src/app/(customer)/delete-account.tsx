import { useEffect, useMemo, useState } from "react";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { View, TextInput, StyleSheet } from "react-native";
import { Page, ActionError } from "@/ui/Page";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";
import { supabase } from "@/lib/supabase";
import { requestMobileAccountDeletion } from "@/lib/accountDeletion";
import { CustomerPageHeader } from "@/ui/CustomerPageHeader";

type DeletionCheck = { ok: boolean; reason?: string };

export default function DeleteAccountScreen() {
  const { t } = useTranslation();
  const [check, setCheck] = useState<DeletionCheck | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const confirmWord = t("accountDeletion.confirmWord");
  const confirmMatches = useMemo(
    () => confirmText.trim() === confirmWord,
    [confirmText, confirmWord],
  );

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase.rpc("account_deletion_check");
      if (error) {
        setCheck({ ok: false, reason: "not_authenticated" });
        return;
      }
      setCheck((data ?? { ok: false, reason: "not_authenticated" }) as DeletionCheck);
    })();
  }, []);

  const blockedReason = !check?.ok ? check?.reason : undefined;

  const onDelete = async () => {
    if (!confirmMatches || !check?.ok) return;
    setBusy(true);
    setActionError(false);
    setErrorKey(null);
    const result = await requestMobileAccountDeletion();
    if (!result.ok) {
      setErrorKey(`accountDeletion.errors.${result.error}`);
      setActionError(true);
      setBusy(false);
      return;
    }
    await supabase.auth.signOut();
    router.replace("/login");
  };

  return (
    <Page
      title={t("accountDeletion.title")}
      header={<CustomerPageHeader title={t("accountDeletion.title")} backTo="/profile" />}
      contentStyle={{ gap: 24 }}
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
        <Text tone="danger">{t("accountDeletion.errors.unauthorized")}</Text>
      )}
      {blockedReason === "active_bookings" ? (
        <Text tone="danger">{t("accountDeletion.blockedActiveBookings")}</Text>
      ) : null}
      {blockedReason === "admin" ? (
        <Text tone="danger">{t("accountDeletion.blockedAdmin")}</Text>
      ) : null}
      {check?.ok ? (
        <>
          <Text>{t("accountDeletion.typeConfirm", { word: confirmWord })}</Text>
          <TextInput
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
        disabled={!check?.ok || !confirmMatches || busy}
        onPress={() => void onDelete()}
      />
      <Button
        variant="secondary"
        label={t("common.cancel")}
        disabled={busy}
        onPress={() => router.navigate("/profile")}
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
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.md,
    color: colors.foreground,
  },
});
