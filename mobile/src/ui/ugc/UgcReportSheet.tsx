import { useState } from "react";
import { Modal, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import {
  UGC_REASONS,
  type UgcReason,
  type UgcSubjectType,
  ugcReportErrorKey,
  useReportUgc,
} from "@/lib/ugcQueries";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { Choices, ui } from "@/ui/Page";
import { colors, space } from "@/ui/theme";
import { bodyTextInputProps } from "@/ui/a11y";

type Props = {
  visible: boolean;
  subjectType: UgcSubjectType;
  conversationId?: string;
  messageId?: string;
  reviewId?: string;
  onClose: () => void;
  onSubmitted?: () => void;
};

export function UgcReportSheet({
  visible,
  subjectType,
  conversationId,
  messageId,
  reviewId,
  onClose,
  onSubmitted,
}: Props) {
  const { t } = useTranslation();
  const [reason, setReason] = useState<UgcReason>("harassment");
  const [detail, setDetail] = useState("");
  const [done, setDone] = useState(false);
  const report = useReportUgc();

  const reset = () => {
    setReason("harassment");
    setDetail("");
    setDone(false);
    report.reset();
  };

  const handleClose = () => {
    if (report.isPending) return;
    reset();
    onClose();
  };

  const handleSubmit = () => {
    report.mutate(
      {
        subjectType,
        reason,
        detail: detail.trim() || undefined,
        conversationId,
        messageId,
        reviewId,
      },
      {
        onSuccess: () => {
          setDone(true);
          onSubmitted?.();
        },
      },
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View
        style={{
          flex: 1,
          justifyContent: "flex-end",
          backgroundColor: "rgba(0,0,0,0.35)",
        }}
      >
        <View
          accessibilityViewIsModal
          style={[
            ui.card,
            {
              borderBottomStartRadius: 0,
              borderBottomEndRadius: 0,
              gap: space.md,
              paddingBottom: space.xxxl,
            },
          ]}
        >
          {done ? (
            <>
              <Text weight="bold">{t("ugc.reportSubmittedTitle")}</Text>
              <Text tone="muted">{t("ugc.reportSubmittedBody")}</Text>
              <Button label={t("common.close")} onPress={handleClose} />
            </>
          ) : (
            <>
              <Text weight="bold">{t("ugc.reportTitle")}</Text>
              <Text tone="muted" size="sm">
                {t(`ugc.subject.${subjectType}`)}
              </Text>
              <Choices
                layout="chips"
                label={t("ugc.reasonLabel")}
                value={reason}
                onChange={(v) => setReason(v as UgcReason)}
                options={UGC_REASONS.map((value) => ({
                  value,
                  label: t(`ugc.reasons.${value}`),
                }))}
              />
              <TextInput
                value={detail}
                onChangeText={setDetail}
                placeholder={t("ugc.detailPlaceholder")}
                multiline
                style={{
                  minHeight: 72,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 12,
                  padding: space.md,
                  textAlignVertical: "top",
                }}
                {...bodyTextInputProps()}
              />
              {report.isError ? (
                <Text tone="danger" size="sm" accessibilityRole="alert">
                  {t(ugcReportErrorKey(report.error))}
                </Text>
              ) : null}
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <Button
                  label={t("common.cancel")}
                  variant="secondary"
                  style={{ flex: 1 }}
                  onPress={handleClose}
                />
                <Button
                  label={t("ugc.reportSubmit")}
                  style={{ flex: 1 }}
                  disabled={report.isPending}
                  onPress={handleSubmit}
                />
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}