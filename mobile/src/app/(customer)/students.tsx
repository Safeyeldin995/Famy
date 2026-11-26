// «أبنائي وبياناتي الدراسية» (issue 536 PR 2): each learner's system and grade,
// add / edit / remove a child, and the «صح؟» grade confirmation after 1 September.
import { useState } from "react";
import { Alert, View } from "react-native";
import { useTranslation } from "react-i18next";
import { router, useLocalSearchParams } from "expo-router";
import { GraduationCap } from "lucide-react-native";
import {
  useActiveFamilyMembers,
  useCustomerEducationProfile,
  useDeactivateFamilyMember,
  useMyProfile,
  useTeachingLevels,
} from "@/lib/queries";
import { useSaveStudentEducationProfile } from "@/lib/bookingQueries";
import { useConfirmStudentGrade, useCurriculaWithStyle } from "@/lib/studentMatchQueries";
import {
  MYSELF_LEARNER_ID,
  buildLearnerOptions,
  findLearner,
  learnerFamilyMemberId,
  type LearnerOption,
} from "@shared/tutoring/studentLearnerFlow";
import { Page, QueryState } from "@/ui/Page";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { space } from "@/ui/theme";
import { CustomerPageHeader } from "@/ui/CustomerPageHeader";
import { customerStyle } from "@/ui/customer/Primitives";
import { StudentProfileSteps, gradeLabelFor } from "@/ui/customer/StudentMatchControls";

export default function Students() {
  const { t, i18n } = useTranslation();
  const lang: "ar" | "en" = i18n.language === "en" ? "en" : "ar";
  const { confirm } = useLocalSearchParams<{ confirm?: string }>();
  const members = useActiveFamilyMembers();
  const education = useCustomerEducationProfile();
  const profile = useMyProfile();
  const curricula = useCurriculaWithStyle();
  const levels = useTeachingLevels();
  const save = useSaveStudentEducationProfile();
  const confirmGrade = useConfirmStudentGrade();
  const deactivate = useDeactivateFamilyMember();
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDismissed, setConfirmDismissed] = useState(false);

  const learners = buildLearnerOptions({
    selfFullName: profile.data?.full_name,
    selfProfile: education.data,
    children: (members.data ?? []).map((m) => ({
      id: m.id,
      full_name: m.full_name,
      education_curriculum_id: m.education_curriculum_id,
      education_level_id: m.education_level_id,
    })),
  });
  const confirmId = confirm === "self" ? MYSELF_LEARNER_ID : confirm;
  const confirmLearner = !confirmDismissed && confirmId ? findLearner(learners, confirmId) : null;

  const nameFor = (l: LearnerOption) =>
    l.kind === "self" ? t("studentMatch.page.self") : (l.firstName ?? t("studentMatch.page.self"));
  const summaryFor = (l: LearnerOption) => {
    const curriculum = (curricula.data ?? []).find((c) => c.id === l.curriculumId) ?? null;
    const level = (levels.data ?? []).find((x) => x.id === l.levelId) ?? null;
    if (!curriculum || !level) return t("studentMatch.page.notSet");
    return `${lang === "ar" ? curriculum.name_ar : curriculum.name_en} · ${gradeLabelFor(level, curriculum, lang)}`;
  };
  const gradeFor = (l: LearnerOption) => {
    const curriculum = (curricula.data ?? []).find((c) => c.id === l.curriculumId) ?? null;
    const level = (levels.data ?? []).find((x) => x.id === l.levelId) ?? null;
    return gradeLabelFor(level, curriculum, lang);
  };

  const doConfirm = async (l: LearnerOption) => {
    try {
      await confirmGrade.mutateAsync(learnerFamilyMemberId(l.id));
      setConfirmDismissed(true);
      Alert.alert(t("studentMatch.page.confirmed"));
    } catch {
      Alert.alert(t("studentMatch.saveFailed"));
    }
  };

  const doSave = async (l: LearnerOption, picked: { curriculumId: string; levelId: string }) => {
    try {
      await save.save({
        forWhom: l.id,
        education_curriculum_id: picked.curriculumId,
        education_level_id: picked.levelId,
      });
      // Correcting the grade from the «صح؟» card also answers it.
      if (confirmLearner?.id === l.id) {
        await confirmGrade.mutateAsync(learnerFamilyMemberId(l.id)).catch(() => undefined);
        setConfirmDismissed(true);
      }
      setEditing(null);
      Alert.alert(t("studentMatch.saved"));
    } catch {
      Alert.alert(t("studentMatch.saveFailed"));
    }
  };

  const remove = (l: LearnerOption) => {
    Alert.alert(
      t("studentMatch.page.remove"),
      t("studentMatch.page.removeConfirm", { name: nameFor(l) }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("studentMatch.page.remove"),
          style: "destructive",
          onPress: () =>
            deactivate.mutate(l.id, {
              onSuccess: () => Alert.alert(t("studentMatch.page.removed")),
              onError: () => Alert.alert(t("studentMatch.saveFailed")),
            }),
        },
      ],
    );
  };

  const queries = [members, education, profile, curricula, levels];
  return (
    <Page
      title={t("studentMatch.page.title")}
      queries={queries}
      header={
        <CustomerPageHeader
          hero
          title={t("studentMatch.page.title")}
          subtitle={t("studentMatch.page.lead")}
          backTo="/profile"
        />
      }
    >
      <QueryState
        query={{
          isLoading: queries.some((q) => q.isLoading),
          isError: queries.some((q) => q.isError),
          refetch: () => Promise.all(queries.map((q) => q.refetch())),
        }}
      >
        {confirmLearner && confirmLearner.levelId ? (
          <View style={[customerStyle.card, { gap: space.sm }]} accessibilityRole="summary">
            <Text weight="heavy">
              {confirmLearner.kind === "child" && confirmLearner.firstName
                ? t("studentMatch.page.confirmTitle", {
                    name: confirmLearner.firstName,
                    grade: gradeFor(confirmLearner),
                  })
                : t("studentMatch.page.confirmTitleSelf", { grade: gradeFor(confirmLearner) })}
            </Text>
            <Button
              label={t("studentMatch.page.confirmYes")}
              disabled={confirmGrade.isPending}
              onPress={() => void doConfirm(confirmLearner)}
            />
            <Button
              variant="secondary"
              label={t("studentMatch.page.confirmEdit")}
              onPress={() => setEditing(confirmLearner.id)}
            />
          </View>
        ) : null}

        {learners.map((l) =>
          editing === l.id ? (
            <StudentProfileSteps
              key={l.id}
              title={
                l.kind === "child" && l.firstName
                  ? t("studentMatch.profileTitle", { name: l.firstName })
                  : t("studentMatch.profileTitleSelf")
              }
              curricula={curricula.data ?? []}
              levels={(levels.data ?? []) as never}
              initialCurriculumId={l.curriculumId}
              initialLevelId={l.levelId}
              saving={save.isPending}
              onDone={(picked) => void doSave(l, picked)}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <View key={l.id} style={[customerStyle.card, { gap: space.sm }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <GraduationCap size={20} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text weight="heavy">{nameFor(l)}</Text>
                  <Text size="sm" tone="muted">
                    {summaryFor(l)}
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <Button
                  variant="secondary"
                  label={t("studentMatch.page.edit")}
                  accessibilityLabel={`${t("studentMatch.page.edit")} ${nameFor(l)}`}
                  onPress={() => setEditing(l.id)}
                  style={{ flex: 1 }}
                />
                {l.kind === "child" ? (
                  <Button
                    variant="ghost"
                    label={t("studentMatch.page.remove")}
                    accessibilityLabel={`${t("studentMatch.page.remove")} ${nameFor(l)}`}
                    disabled={deactivate.isPending}
                    onPress={() => remove(l)}
                    style={{ flex: 1 }}
                  />
                ) : null}
              </View>
            </View>
          ),
        )}

        {learners.length === 1 ? (
          <Text size="sm" tone="muted" style={{ textAlign: "center" }}>
            {t("studentMatch.page.empty")}
          </Text>
        ) : null}
        <Button
          variant="secondary"
          label={`+ ${t("studentMatch.page.addChild")}`}
          onPress={() => router.push("/family-members/new")}
        />
      </QueryState>
    </Page>
  );
}
