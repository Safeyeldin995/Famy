import { useCallback, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { ChevronLeft, Tag, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { promoFitsMode, useFeaturedPromoCodes, type FeaturedPromoCode } from "@/lib/queries";
import { validatePromoCode } from "@/lib/bookingQueries";
import { money } from "@/lib/presentation";
import { colors, radius, space } from "@/ui/theme";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { Field, QueryState, ui } from "@/ui/Page";

export type AppliedCheckoutPromo = { id: string; discount: number; code: string };

export function CheckoutPromoPicker({
  serviceId,
  serviceMode,
  subtotal,
  applied,
  onApplied,
  bookingError,
  onClearBookingError,
}: {
  serviceId: string;
  /** Booking mode: codes limited to the other mode are hidden and refused. */
  serviceMode: "online" | "in_person";
  subtotal: number;
  applied: AppliedCheckoutPromo | null;
  onApplied: (value: AppliedCheckoutPromo | null) => void;
  bookingError?: string;
  onClearBookingError?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const promos = useFeaturedPromoCodes();
  const offers = (promos.data ?? []).filter((offer) =>
    promoFitsMode(offer.applicable_mode, serviceMode),
  );
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState("");
  const [checking, setChecking] = useState(false);
  const [sheetError, setSheetError] = useState("");
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const ar = i18n.language.startsWith("ar");
  const direction = {
    direction: "ltr" as const,
    flexDirection: ar ? ("row-reverse" as const) : ("row" as const),
  };

  const applyCode = useCallback(
    async (code: string) => {
      const trimmed = code.trim();
      if (!trimmed) return;
      setChecking(true);
      setSheetError("");
      onClearBookingError?.();
      try {
        const r = await validatePromoCode(trimmed, serviceId, subtotal, serviceMode);
        if (r.ok) {
          onApplied({ id: r.promo_code_id, discount: r.discount_amount, code: trimmed });
          setManual("");
          setOpen(false);
        } else {
          setSheetError(
            t(`bookFlow.promoError.${r.reason}`, {
              defaultValue: t("bookFlow.promoError.not_found"),
            }),
          );
        }
      } catch {
        setSheetError(t("common.somethingWentWrong"));
      } finally {
        setChecking(false);
        setApplyingId(null);
      }
    },
    [onApplied, onClearBookingError, serviceId, serviceMode, subtotal, t],
  );

  const remove = () => {
    onApplied(null);
    setManual("");
    setSheetError("");
    onClearBookingError?.();
  };

  return (
    <View style={{ gap: space.sm }}>
      {applied ? (
        <View style={[styles.chip, direction]}>
          <Tag size={16} color={colors.brand} />
          <View style={{ flex: 1, gap: space.xs }}>
            <Text weight="heavy" style={ui.ltr}>
              {applied.code}
            </Text>
            <Text size="xs" tone="muted">
              {t("bookFlow.promoApplied", { amount: money(applied.discount, i18n.language) })}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("bookFlow.promoRemove")}
            onPress={remove}
            style={styles.chipRemove}
          >
            <X size={18} color={colors.muted} />
          </Pressable>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("customerBooking.promo")}
          onPress={() => {
            setManual("");
            setSheetError("");
            setOpen(true);
          }}
          style={[styles.trigger, direction]}
        >
          <Text weight="heavy">{t("customerBooking.promo")}</Text>
          <ChevronLeft
            size={18}
            color={colors.muted}
            style={{ transform: [{ scaleX: ar ? 1 : -1 }] }}
          />
        </Pressable>
      )}
      {bookingError ? (
        <Text tone="danger" size="sm" accessibilityLiveRegion="polite">
          {bookingError}
        </Text>
      ) : null}
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.modal}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setOpen(false)}
            accessibilityRole="button"
            accessibilityLabel={t("providerApply.close")}
          />
          <View
            accessibilityViewIsModal
            style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space.xl) }]}
          >
            <View style={styles.grab} />
            <View style={[styles.heading, direction]}>
              <Text weight="heavy" size="lg">
                {t("customerBooking.promo")}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("providerApply.close")}
                onPress={() => setOpen(false)}
                style={styles.close}
              >
                <X size={18} color={colors.foreground} />
              </Pressable>
            </View>
            <Text weight="bold" tone="muted" size="sm">
              {t("bookFlow.promoAvailableTitle")}
            </Text>
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 280 }}>
              <QueryState query={promos} empty={!offers.length}>
                {!offers.length ? (
                  <Text tone="muted" size="sm">
                    {t("promoCodes.availableEmptyBody")}
                  </Text>
                ) : (
                  <View style={{ gap: space.md, paddingBottom: space.sm }}>
                    {offers.map((offer) => (
                      <CheckoutPromoOfferCard
                        key={offer.id}
                        offer={offer}
                        busy={applyingId === offer.id}
                        onUse={() => {
                          setApplyingId(offer.id);
                          void applyCode(offer.code);
                        }}
                      />
                    ))}
                  </View>
                )}
              </QueryState>
            </ScrollView>
            <View style={{ gap: space.sm, marginTop: space.xs }}>
              <Field
                label={t("bookFlow.promoPlaceholder")}
                value={manual}
                onChangeText={setManual}
                editable={!checking}
              />
              {sheetError ? (
                <Text tone="danger" size="sm" accessibilityLiveRegion="polite">
                  {sheetError}
                </Text>
              ) : null}
              <Button
                label={t("bookFlow.promoApply")}
                loading={checking && !applyingId}
                disabled={!manual.trim()}
                onPress={() => void applyCode(manual)}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function CheckoutPromoOfferCard({
  offer,
  onUse,
  busy,
}: {
  offer: FeaturedPromoCode;
  onUse: () => void;
  busy: boolean;
}) {
  const { t, i18n } = useTranslation();
  const description =
    (i18n.language === "ar" ? offer.description_ar : offer.description_en) || offer.description_en;
  const discount =
    offer.discount_type === "percentage"
      ? t("promoCodes.discountPercent", { value: offer.discount_value })
      : t("promoCodes.discountFixed", { amount: money(offer.discount_value, i18n.language) });
  return (
    <View style={[ui.card, { padding: space.lg, gap: space.sm, backgroundColor: colors.surface2 }]}>
      <View style={{ gap: space.xs }}>
        <Text weight="heavy" style={ui.ltr}>
          {offer.code}
        </Text>
        <Text weight="bold" tone="brand">
          {discount}
        </Text>
        {description ? (
          <Text size="sm" tone="muted">
            {description}
          </Text>
        ) : null}
      </View>
      <Button
        variant="secondary"
        label={busy ? "" : t("bookFlow.promoUse")}
        loading={busy}
        onPress={onUse}
        style={{ alignSelf: "flex-start", minHeight: 40, paddingHorizontal: space.lg }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
    paddingHorizontal: space.lg,
    alignItems: "center",
    justifyContent: "space-between",
  },
  chip: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.brand,
    backgroundColor: colors.brandTint,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    alignItems: "center",
    gap: space.md,
  },
  chipRemove: {
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  modal: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15,13,16,.42)" },
  sheet: {
    maxHeight: "88%",
    backgroundColor: colors.surface,
    borderTopStartRadius: radius.xl + 4,
    borderTopEndRadius: radius.xl + 4,
    padding: space.xl,
    gap: space.md,
  },
  grab: { height: 4, width: 40, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center" },
  heading: { alignItems: "center", justifyContent: "space-between" },
  close: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface2,
  },
});
