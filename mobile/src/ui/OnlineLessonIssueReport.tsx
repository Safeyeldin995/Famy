import { useState } from "react";
import { TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { onlineLessonReportWindow } from "@shared/livekit/sessionAccess";
import { Text } from "./Text";
import { Button } from "./Button";
import { Choices, ui } from "./Page";
import { colors } from "./theme";
import { bodyTextInputProps } from "@/ui/a11y";

type Props = { bookingId: string; startAt: string; endAt: string };

const CATEGORIES = ["absence", "connection", "behavior"] as const;

export function OnlineLessonIssueReport({ bookingId, startAt, endAt }: Props) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("connection");
  const [detail, setDetail] = useState("");
  const [done, setDone] = useState(false);
  const window = onlineLessonReportWindow(new Date(startAt), new Date(endAt));
  const submit = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("report_online_lesson_issue", {
        p_booking_id: bookingId,
        p_category: category,
        p_description: detail,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => setDone(true),
  });

  if (!window.open) return null;
  if (done) {
    return (
      <View style={[ui.card, { gap: 8 }]}>
        <Text weight="bold">{t("onlineSession.lessonReportSubmitted")}</Text>
        <Text tone="muted">{t("onlineSession.lessonReportReviewEta")}</Text>
      </View>
    );
  }

  return (
    <View style={[ui.card, { gap: 10 }]}>
      <Text weight="bold">{t("onlineSession.lessonReportTitle")}</Text>
      <Choices
        layout="chips"
        label={t("onlineSession.lessonReportCategory")}
        value={category}
        onChange={(v) => setCategory(v as (typeof CATEGORIES)[number])}
        options={CATEGORIES.map((value) => ({
          value,
          label: t(`onlineSession.lessonReportCategories.${value}`),
        }))}
      />
      <TextInput
        value={detail}
        onChangeText={setDetail}
        placeholder={t("onlineSession.lessonReportPlaceholder")}
        multiline
        style={{
          minHeight: 88,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          padding: 12,
          textAlignVertical: "top",
        }}
        {...bodyTextInputProps()}
      />
      <Button
        label={t("onlineSession.lessonReportSubmit")}
        disabled={detail.trim().length < 10 || submit.isPending}
        onPress={() => submit.mutate()}
      />
    </View>
  );
}