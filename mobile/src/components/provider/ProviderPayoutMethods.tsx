import { useState } from "react";
import { Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react-native";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Page";
import { BrandLogo, payoutBrand } from "@/ui/PaymentLogos";
import { colors, radius, space } from "@/ui/theme";
import {
  PAYOUT_METHODS,
  buildPayoutInsert,
  emptyPayoutDraft,
  payoutDestination,
  type PayoutFieldError,
  type PayoutMethodDraft,
  type PayoutMethodKind,
} from "@shared/payout/payoutMethods";
import { usePayoutMethodMutations, usePayoutMethods } from "@/lib/provider/payoutQueries";

export function PayoutMethodIcon({ method, size = 14 }: { method: string; size?: number }) {
  const brand = payoutBrand(method);
  if (brand) return <BrandLogo brand={brand} height={brand === "instapay" ? size - 3 : size} />;
  return (
    <View
      style={{
        height: size + 10,
        width: size + 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.surface,
      }}
    >
      <Landmark size={size} color={colors.foreground} />
    </View>
  );
}

/** Provider's payout methods: where Famy sends their money. */
export function ProviderPayoutMethods({ providerId }: { providerId: string | undefined }) {
  const { t } = useTranslation();
  const list = usePayoutMethods(providerId);
  const { add, remove, makeDefault } = usePayoutMethodMutations(providerId);
  const [draft, setDraft] = useState<PayoutMethodDraft | null>(null);
  const [errors, setErrors] = useState<PayoutFieldError[]>([]);
  const [message, setMessage] = useState("");

  if (!providerId) return null;
  const rows = list.data ?? [];
  const busy = add.isPending || remove.isPending || makeDefault.isPending;

  const card = {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: space.md,
    gap: space.sm,
  } as const;

  const set = (patch: Partial<PayoutMethodDraft>) => draft && setDraft({ ...draft, ...patch });
  const err = (f: PayoutFieldError) =>
    errors.includes(f) ? (
      <Text size="xs" tone="danger">
        {t(`payout.pro.errors.${f}`)}
      </Text>
    ) : null;

  const save = () => {
    if (!draft) return;
    const built = buildPayoutInsert(providerId, draft, false);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors([]);
    add.mutate(built.row, {
      onSuccess: () => {
        setDraft(null);
        setMessage(t("payout.pro.saved"));
      },
      onError: () => setMessage(t("payout.pro.failed")),
    });
  };

  return (
    <View style={card}>
      <Text weight="heavy">{t("payout.pro.title")}</Text>
      <Text tone="muted" size="sm">
        {t("payout.pro.subtitle")}
      </Text>

      {list.isLoading ? (
        <Text tone="muted" size="sm">
          {t("common.loading")}
        </Text>
      ) : list.isError ? (
        <Text tone="danger" size="sm">
          {t("payout.pro.loadError")}
        </Text>
      ) : rows.length === 0 && !draft ? (
        <Text tone="muted" size="sm">
          {t("payout.pro.empty")}
        </Text>
      ) : null}

      {rows.map((r) => (
        <View
          key={r.id}
          style={{
            borderTopWidth: 1,
            borderTopColor: colors.border,
            paddingTop: space.sm,
            gap: 6,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <PayoutMethodIcon method={r.method} />
            <Text weight="bold" style={{ flexShrink: 1 }}>
              {t(`payout.methods.${r.method}`)}
            </Text>
            {r.is_default ? (
              <View
                style={{
                  marginStart: "auto",
                  backgroundColor: colors.brandTint,
                  borderRadius: radius.pill,
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                }}
              >
                <Text size="xs" weight="bold" tone="brand">
                  {t("payout.pro.default")}
                </Text>
              </View>
            ) : null}
          </View>
          <Text size="sm">{r.holder_name}</Text>
          {r.bank_name ? (
            <Text size="sm" tone="muted">
              {r.bank_name}
            </Text>
          ) : null}
          <Text size="sm" style={{ writingDirection: "ltr", textAlign: "left" }}>
            {payoutDestination(r)}
          </Text>
          <View style={{ flexDirection: "row", gap: 16 }}>
            {!r.is_default ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("payout.pro.makeDefault")}
                disabled={busy}
                onPress={() =>
                  makeDefault.mutate(r, { onError: () => setMessage(t("payout.pro.failed")) })
                }
                style={{ paddingVertical: 6 }}
              >
                <Text size="sm" weight="bold" tone="brand">
                  {t("payout.pro.makeDefault")}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${t("payout.pro.remove")} ${t(`payout.methods.${r.method}`)}`}
              disabled={busy}
              onPress={() =>
                remove.mutate(r, {
                  onSuccess: () => setMessage(t("payout.pro.removed")),
                  onError: () => setMessage(t("payout.pro.failed")),
                })
              }
              style={{ paddingVertical: 6 }}
            >
              <Text size="sm" weight="bold" tone="danger">
                {t("payout.pro.remove")}
              </Text>
            </Pressable>
          </View>
        </View>
      ))}

      {draft ? (
        <View
          style={{
            gap: space.sm,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            paddingTop: space.sm,
          }}
        >
          <Text weight="bold">{t("payout.pro.method")}</Text>
          <View style={{ gap: 8 }}>
            {PAYOUT_METHODS.map((m: PayoutMethodKind) => {
              const on = draft.method === m;
              return (
                <Pressable
                  key={m}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={t(`payout.methods.${m}`)}
                  onPress={() => {
                    setErrors([]);
                    set({ method: m });
                  }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    minHeight: 48,
                    paddingHorizontal: space.md,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: on ? colors.brand : colors.border,
                    backgroundColor: on ? colors.brandTint : colors.surface,
                  }}
                >
                  <PayoutMethodIcon method={m} />
                  <Text weight="bold" tone={on ? "brand" : "default"}>
                    {t(`payout.methods.${m}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Field
            label={t("payout.pro.holderName")}
            placeholder={t("payout.pro.holderPlaceholder")}
            value={draft.holderName}
            onChangeText={(v) => set({ holderName: v })}
            autoComplete="name"
          />
          {err("holderName")}
          {draft.method === "bank" ? (
            <>
              <Field
                label={t("payout.pro.bankName")}
                placeholder={t("payout.pro.bankPlaceholder")}
                value={draft.bankName}
                onChangeText={(v) => set({ bankName: v })}
              />
              {err("bankName")}
              <Field
                label={t("payout.pro.accountNumber")}
                value={draft.accountNumber}
                onChangeText={(v) => set({ accountNumber: v })}
                autoCapitalize="characters"
                ltr
              />
              {err("accountNumber")}
            </>
          ) : draft.method === "instapay" ? (
            <>
              <Field
                label={t("payout.pro.instapayAddress")}
                placeholder="name@instapay"
                value={draft.instapayAddress}
                onChangeText={(v) => set({ instapayAddress: v })}
                autoCapitalize="none"
                ltr
              />
              {err("instapayAddress")}
            </>
          ) : (
            <>
              <Field
                label={t("payout.pro.walletPhone")}
                placeholder="01012345678"
                value={draft.walletPhone}
                onChangeText={(v) => set({ walletPhone: v })}
                keyboardType="phone-pad"
                ltr
              />
              {err("walletPhone")}
            </>
          )}
          <Button label={t("payout.pro.save")} loading={add.isPending} onPress={save} />
          <Button
            variant="secondary"
            label={t("payout.pro.cancel")}
            onPress={() => {
              setDraft(null);
              setErrors([]);
            }}
          />
        </View>
      ) : (
        <Button
          variant="secondary"
          label={t("payout.pro.add")}
          onPress={() => {
            setMessage("");
            setDraft(emptyPayoutDraft());
          }}
        />
      )}
      {message ? (
        <Text size="sm" tone="muted">
          {message}
        </Text>
      ) : null}
    </View>
  );
}
