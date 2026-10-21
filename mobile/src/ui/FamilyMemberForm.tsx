import { DateField } from "./DateField";
import { useState } from "react";
import { Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import { useTeachingCurricula, useTeachingLevels, type FamilyMemberInput } from "@/lib/queries";
import { emptyMember, validMember, memberInput, relationships } from "@/lib/familyForm";
import { localized } from "@/lib/presentation";
import { Field, Choices, QueryState, ActionError, ui } from "./Page";
import { Text } from "./Text";
import { Button } from "./Button";
import { colors } from "./theme";

export function FamilyMemberForm({
  initial,
  onSave,
  busy,
  error,
}: {
  initial?: FamilyMemberInput;
  onSave: (value: FamilyMemberInput) => void;
  busy: boolean;
  error: unknown;
}) {
  const { t, i18n } = useTranslation();
  const [value, setValue] = useState(initial ?? emptyMember());
  const [consent, setConsent] = useState(false);
  const [touched, setTouched] = useState(false);
  const curricula = useTeachingCurricula();
  const levels = useTeachingLevels();
  const set = <K extends keyof FamilyMemberInput>(key: K, next: FamilyMemberInput[K]) =>
    setValue((v) => ({ ...v, [key]: next }));
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  // Source: src/lib/tutoring/teachingLevelFilters.ts - British secondary levels only.
  const curriculum = curricula.data?.find((c) => c.id === value.education_curriculum_id);
  const filteredLevels = (levels.data ?? []).filter(
    (l) => curriculum?.code !== "british" || ["g10", "g11", "g12"].includes(l.code),
  );
  const valid = validMember(value, consent, today);
  const optionalFields = [
    ["phone", "phone"],
    ["allergies", "allergies"],
    ["medical_notes", "medicalNotes"],
    ["access_notes", "accessNotes"],
    ["emergency_contact_name", "emergencyContactName"],
    ["emergency_contact_phone", "emergencyContactPhone"],
  ] as const;
  return (
    <>
      <Field
        label={t("familyMembers.fullName")}
        value={value.full_name}
        onChangeText={(v) => set("full_name", v)}
      />
      <Choices
        label={t("familyMembers.relationship")}
        value={value.relationship}
        onChange={(v) => set("relationship", v as FamilyMemberInput["relationship"])}
        options={relationships.map((v) => ({
          value: v,
          label: t(`familyMembers.relationships.${v}`),
        }))}
      />
      {value.relationship === "other" && (
        <Field
          label={t("familyMembers.relationshipOtherPlaceholder")}
          value={value.relationship_other ?? ""}
          onChangeText={(v) => set("relationship_other", v)}
        />
      )}
      <DateField
        label={t("familyMembers.dateOfBirth")}
        value={value.date_of_birth}
        maximumDate={new Date()}
        onChange={(v) => set("date_of_birth", v)}
      />
      <Choices
        label={t("familyMembers.gender")}
        value={value.gender ?? ""}
        onChange={(v) => set("gender", (v || null) as FamilyMemberInput["gender"])}
        options={[
          { value: "", label: t("familyMembers.optional") },
          ...["male", "female", "other"].map((v) => ({
            value: v,
            label: t(`familyMembers.genders.${v}`),
          })),
        ]}
      />
      <Text tone="muted">{t("familyMembers.privacyNotice")}</Text>
      {optionalFields.map(([key, label]) => (
        <Field
          key={key}
          label={t(`familyMembers.${label}`)}
          value={value[key] ?? ""}
          onChangeText={(v) => set(key, v)}
          ltr={key.includes("phone")}
          keyboardType={key.includes("phone") ? "phone-pad" : "default"}
          multiline={["allergies", "medical_notes", "access_notes"].includes(key)}
        />
      ))}
      {(value.allergies?.trim() || value.medical_notes?.trim()) && (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: consent }}
          onPress={() => setConsent((v) => !v)}
          style={[ui.card, { minHeight: 44, borderColor: consent ? colors.brand : colors.border }]}
        >
          <Text weight="bold">{t(consent ? "mobile.consentGiven" : "mobile.consentNeeded")}</Text>
          <Text>{t("familyMembers.healthConsent")}</Text>
        </Pressable>
      )}
      <Text size="xl" weight="heavy">
        {t("studentEducation.sectionTitle")}
      </Text>
      <QueryState query={curricula} empty={!curricula.data?.length}>
        <Choices
          label={t("studentEducation.curriculum")}
          value={value.education_curriculum_id ?? ""}
          onChange={(v) =>
            setValue((current) => ({
              ...current,
              education_curriculum_id: v || null,
              education_level_id: null,
            }))
          }
          options={[
            { value: "", label: t("studentEducation.optionalNone") },
            ...(curricula.data ?? []).map((r) => ({
              value: r.id,
              label: localized(r, i18n.language),
            })),
          ]}
        />
      </QueryState>
      <QueryState query={levels} empty={!levels.data?.length}>
        <Choices
          label={t("studentEducation.grade")}
          value={value.education_level_id ?? ""}
          onChange={(v) => set("education_level_id", v || null)}
          options={[
            { value: "", label: t("studentEducation.optionalNone") },
            ...(value.education_curriculum_id ? filteredLevels : []).map((r) => ({
              value: r.id,
              label: localized(r, i18n.language),
            })),
          ]}
        />
      </QueryState>
      {touched && !valid && (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {t("mobile.memberInvalid")}
        </Text>
      )}
      <ActionError error={error} />
      <Button
        label={t("common.save")}
        loading={busy}
        onPress={() => {
          setTouched(true);
          if (valid) onSave(memberInput(value));
        }}
      />
    </>
  );
}
