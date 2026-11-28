import { useState } from "react";
import { TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ShieldCheck } from "lucide-react-native";
import {
  guaranteeCardState,
  guaranteeCoversCategory,
  guaranteeDeadlineLabel,
  guaranteeErrorKey,
} from "@shared/offers/launchOffers";
import {
  useClaimFirstLessonGuarantee,
  useFirstLessonGuaranteeSettings,
  useFirstLessonGuaranteeStatus,
} from "@/lib/launchOffersQueries";
import { money } from "@/lib/presentation";
import { bodyTextInputProps } from "@/ui/a11y";
import { Button } from "./Button";
import { Text } from "./Text";
import { ui } from "./Page";
import { colors, radius, space } from "./theme";

/** «لو أول حصة مع المدرس مش مناسبة، فلوسها بترجع لمحفظتك», only where it applies. */
export function FirstLessonGuaranteePromise({
  categorySlug,
}: {
  categorySlug: string | null | undefined;
}) {
  const { t } = useTranslation();
  const q = useFirstLessonGuaranteeSettings();
  if (!guaranteeCoversCategory(q.data, categorySlug)) return null;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: space.sm,
        padding: space.md,
        borderRadius: radius.lg,
        backgroundColor: colors.successTint,
      }}
    >
      <ShieldCheck size={18} color={colors.success} accessible={false} />
      <Text size="sm" weight="bold" tone="success" style={{ flexShrink: 1 }}>
        {t("firstLessonGuarantee.promise")}
      </Text>
    </View>
  );
}

/** Completed booking: «الحصة مكانتش مناسبة» puts the lesson price back in the wallet. */
export function FirstLessonGuaranteeCard({ bookingId }: { bookingId: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const q = useFirstLessonGuaranteeStatus(bookingId);
  const claim = useClaimFirstLessonGuarantee();
  const [confirming, setConfirming] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [message, setMessage] = useState<{ text: string; tone: "success" | "danger" } | null>(null);
  const state = guaranteeCardState(q.data);
  if (!state || !q.data) return null;

  const title = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      <ShieldCheck size={18} color={colors.success} accessible={false} />
      <Text weight="bold" style={{ flexShrink: 1 }}>
        {state === "claimed"
          ? t("firstLessonGuarantee.claimedTitle")
          : t("firstLessonGuarantee.offerTitle")}
      </Text>
    </View>
  );

  if (state === "claimed") {
    return (
      <View style={[ui.card, { gap: space.sm, backgroundColor: colors.successTint }]}>
        {title}
        <Text tone="muted">
          {t("firstLessonGuarantee.claimedBody", {
            amount: money(q.data.claim?.amount ?? 0, lang),
          })}
        </Text>
        {message ? (
          <Text tone={message.tone} accessibilityLiveRegion="polite">
            {message.text}
          </Text>
        ) : null}
      </View>
    );
  }

  if (state === "waiting") {
    return (
      <View style={[ui.card, { gap: space.sm }]}>
        {title}
        <Text tone="muted">{t("firstLessonGuarantee.waitingBody")}</Text>
      </View>
    );
  }

  const amount = money(q.data.amount, lang);
  return (
    <View style={[ui.card, { gap: space.md }]}>
      {title}
      <Text tone="muted">
        {t("firstLessonGuarantee.offerBody", {
          amount,
          time: q.data.expires_at ? guaranteeDeadlineLabel(q.data.expires_at, lang) : "",
        })}
      </Text>
      {!confirming ? (
        <Button
          variant="secondary"
          label={t("firstLessonGuarantee.offerButton")}
          onPress={() => {
            setMessage(null);
            setConfirming(true);
          }}
        />
      ) : (
        <View style={{ gap: space.sm }}>
          <Text weight="bold">{t("firstLessonGuarantee.confirmTitle")}</Text>
          <Text tone="muted">{t("firstLessonGuarantee.confirmBody", { amount })}</Text>
          <TextInput
            value={feedback}
            onChangeText={setFeedback}
            maxLength={500}
            placeholder={t("firstLessonGuarantee.feedbackLabel")}
            accessibilityLabel={t("firstLessonGuarantee.feedbackLabel")}
            multiline
            style={{
              minHeight: 72,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: radius.lg,
              padding: space.md,
              textAlignVertical: "top",
            }}
            {...bodyTextInputProps()}
          />
          <Button
            label={t("firstLessonGuarantee.confirm")}
            loading={claim.isPending}
            onPress={() =>
              claim.mutate(
                { bookingId, feedback: feedback.trim() || null },
                {
                  onSuccess: (r) => {
                    setConfirming(false);
                    setMessage({
                      text: t("firstLessonGuarantee.success", { amount: money(r.amount, lang) }),
                      tone: "success",
                    });
                  },
                  onError: (e) =>
                    setMessage({
                      text: t(guaranteeErrorKey((e as { message?: string })?.message)),
                      tone: "danger",
                    }),
                },
              )
            }
          />
          <Button
            variant="ghost"
            label={t("firstLessonGuarantee.cancel")}
            disabled={claim.isPending}
            onPress={() => setConfirming(false)}
          />
        </View>
      )}
      {message ? (
        <Text tone={message.tone} accessibilityLiveRegion="polite">
          {message.text}
        </Text>
      ) : null}
    </View>
  );
}
