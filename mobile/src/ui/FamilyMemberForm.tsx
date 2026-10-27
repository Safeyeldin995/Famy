import { CustomerBirthDateField } from "./customer/CustomerBirthDateField";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTeachingCurricula, useTeachingLevels, type FamilyMemberInput } from "@/lib/queries";
import { emptyMember, validMember, memberInput, relationships } from "@/lib/familyForm";
import { localized } from "@/lib/presentation";
import { Field, Choices, QueryState, ActionError, ui } from "./Page";
import { Text } from "./Text";
import { Button } from "./Button";
import { colors } from "./theme";
import { BottomSheetSelect } from "./provider/BottomSheetSelect";

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
  ] as const;
  return (
    <>
      <Field
        label={t("familyMembers.fullName")}
        placeholder={t("familyMembers.fullNamePlaceholder")}
        value={value.full_name}
        onChangeText={(v) => set("full_name", v)}
      />
      <FamilyChoiceGrid
        label={t("familyMembers.relationship")}
        columns={4}
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
      <CustomerBirthDateField
        value={value.date_of_birth}
        onChange={(v) => set("date_of_birth", v)}
      />
      <FamilyChoiceGrid
        label={t("familyMembers.gender")}
        value={value.gender ?? ""}
        onChange={(v) =>
          set("gender", (v === value.gender ? null : v) as FamilyMemberInput["gender"])
        }
        columns={2}
        options={[
          ...["male", "female"].map((v) => ({
            value: v,
            label: t(`familyMembers.genders.${v}`),
          })),
        ]}
      />
      {optionalFields.map(([key, label]) => (
        <Field
          key={key}
          label={t(`familyMembers.${label}`)}
          placeholder={t(`familyMembers.${label}Placeholder`)}
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
          accessibilityLabel={t("familyMembers.healthConsent")}
          accessibilityState={{ checked: consent }}
          onPress={() => setConsent((v) => !v)}
          style={[ui.card, { minHeight: 44, borderColor: consent ? colors.brand : colors.border }]}
        >
          <Text weight="bold">{t(consent ? "mobile.consentGiven" : "mobile.consentNeeded")}</Text>
          <Text>{t("familyMembers.healthConsent")}</Text>
        </Pressable>
      )}
      <View style={{ backgroundColor: colors.surface2, borderRadius: 16, padding: 16, gap: 12 }}>
        <Text size="xs" weight="bold" tone="muted">
          {t("studentEducation.sectionTitle")}
        </Text>
        <QueryState query={curricula} empty={!curricula.data?.length}>
          <BottomSheetSelect
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
          <BottomSheetSelect
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
      </View>
      <View style={{ backgroundColor: colors.surface2, borderRadius: 16, padding: 16, gap: 12 }}>
        <Text size="xs" weight="bold" tone="muted">
          {t("familyMembers.emergencyContact")} ({t("familyMembers.optional")})
        </Text>
        <Field
          label={t("familyMembers.emergencyContactName")}
          placeholder={t("familyMembers.emergencyContactNamePlaceholder")}
          value={value.emergency_contact_name ?? ""}
          onChangeText={(v) => set("emergency_contact_name", v)}
        />
        <Field
          label={t("familyMembers.emergencyContactPhone")}
          placeholder={t("familyMembers.phonePlaceholder")}
          value={value.emergency_contact_phone ?? ""}
          onChangeText={(v) => set("emergency_contact_phone", v)}
          keyboardType="phone-pad"
          ltr
        />
      </View>
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

function FamilyChoiceGrid({
  label,
  value,
  options,
  columns,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  columns: number;
  onChange: (value: string) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text size="xs" weight="bold" tone="muted">
        {label}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            accessibilityState={{ selected: value === option.value }}
            onPress={() => onChange(option.value)}
            style={{
              width: columns === 4 ? "23%" : "48%",
              flexGrow: 1,
              minHeight: 44,
              paddingVertical: 12,
              borderWidth: 1,
              borderRadius: 16,
              borderColor: value === option.value ? colors.brand : colors.border,
              backgroundColor: value === option.value ? colors.brandTint : colors.surface,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              size={columns === 4 ? "xs" : "md"}
              weight="bold"
              tone={value === option.value ? "brand" : "muted"}
            >
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
