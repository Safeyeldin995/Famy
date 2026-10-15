import { customerDayKey, isCompleteBirthDate } from "./customerDates";
import { CustomerBirthDateField } from "./CustomerBirthDateField";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { PrimaryButton } from "@/components/famio/ui";
import { normalizePhoneE164 } from "@/lib/otp/normalizePhone";
import type { FamilyMemberInput, Relationship } from "@/lib/db/family-members-queries";
import {
  EducationProfileFields,
  educationIdsFromValue,
  educationValueFromIds,
  type EducationProfileValue,
} from "@/components/famio/EducationProfileFields";

const RELATIONSHIPS: Relationship[] = [
  "spouse",
  "son",
  "daughter",
  "father",
  "mother",
  "sibling",
  "grandparent",
  "other",
];
const GENDERS = ["male", "female"] as const;
const PHONE_RE = /^\+\d{8,15}$/;

export function isValidOptionalPhone(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  return PHONE_RE.test(normalizePhoneE164(trimmed));
}

export function validateFamilyMemberFormValue(
  value: FamilyMemberFormValue,
  today: string,
): {
  valid: boolean;
  dobValid: boolean;
  relationshipOtherValid: boolean;
  phoneValid: boolean;
  emergencyPhoneValid: boolean;
  emergencyValid: boolean;
} {
  const dobValid = isCompleteBirthDate(value.dateOfBirth) && value.dateOfBirth <= today;
  const relationshipOtherValid =
    value.relationship !== "other" || value.relationshipOther.trim().length > 0;
  const emergencyValid =
    !value.emergencyContactName.trim() || value.emergencyContactPhone.trim().length > 0;
  const phoneValid = isValidOptionalPhone(value.phone);
  const emergencyPhoneValid = isValidOptionalPhone(value.emergencyContactPhone);
  const valid =
    value.fullName.trim().length > 0 &&
    !!value.relationship &&
    relationshipOtherValid &&
    dobValid &&
    emergencyValid &&
    phoneValid &&
    emergencyPhoneValid;
  return {
    valid,
    dobValid,
    relationshipOtherValid,
    phoneValid,
    emergencyPhoneValid,
    emergencyValid,
  };
}

export type FamilyMemberFormValue = {
  fullName: string;
  relationship: Relationship | "";
  relationshipOther: string;
  dateOfBirth: string;
  gender: "" | "male" | "female" | "other";
  phone: string;
  allergies: string;
  medicalNotes: string;
  accessNotes: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  education: EducationProfileValue;
};

export function emptyFamilyMemberFormValue(): FamilyMemberFormValue {
  return {
    fullName: "",
    relationship: "",
    relationshipOther: "",
    dateOfBirth: "",
    gender: "",
    phone: "",
    allergies: "",
    medicalNotes: "",
    accessNotes: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    education: educationValueFromIds(null, null),
  };
}

export function familyMemberFormValueToInput(v: FamilyMemberFormValue): FamilyMemberInput {
  return {
    full_name: v.fullName.trim(),
    relationship: v.relationship as Relationship,
    relationship_other: v.relationship === "other" ? v.relationshipOther.trim() : null,
    date_of_birth: v.dateOfBirth,
    gender: v.gender || null,
    phone: v.phone.trim() ? normalizePhoneE164(v.phone.trim()) : null,
    allergies: v.allergies.trim() || null,
    medical_notes: v.medicalNotes.trim() || null,
    access_notes: v.accessNotes.trim() || null,
    emergency_contact_name: v.emergencyContactName.trim() || null,
    emergency_contact_phone: v.emergencyContactPhone.trim()
      ? normalizePhoneE164(v.emergencyContactPhone.trim())
      : null,
    ...educationIdsFromValue(v.education),
  };
}

export function familyMemberRowToFormValue(row: any): FamilyMemberFormValue {
  return {
    fullName: row.full_name ?? "",
    relationship: (row.relationship ?? "") as Relationship,
    relationshipOther: row.relationship_other ?? "",
    dateOfBirth: row.date_of_birth ?? "",
    gender: (row.gender ?? "") as FamilyMemberFormValue["gender"],
    phone: row.phone ?? "",
    allergies: row.allergies ?? "",
    medicalNotes: row.medical_notes ?? "",
    accessNotes: row.access_notes ?? "",
    emergencyContactName: row.emergency_contact_name ?? "",
    emergencyContactPhone: row.emergency_contact_phone ?? "",
    education: educationValueFromIds(row.education_curriculum_id, row.education_level_id),
  };
}

export function FamilyMemberForm({
  value,
  onChange,
  onSubmit,
  submitting,
  submitLabel,
  nestedDatePicker = false,
}: {
  value: FamilyMemberFormValue;
  onChange: (v: FamilyMemberFormValue) => void;
  onSubmit: () => void;
  submitting: boolean;
  submitLabel: string;
  nestedDatePicker?: boolean;
}) {
  const { t } = useTranslation();
  const [touched, setTouched] = useState(false);
  // Health notes about a child are sensitive data under Egypt's PDPL (Law 151/2020):
  // saving them needs the guardian's explicit consent each time they are submitted.
  const [healthConsent, setHealthConsent] = useState(false);
  const today = customerDayKey();

  const set = <K extends keyof FamilyMemberFormValue>(k: K, v: FamilyMemberFormValue[K]) =>
    onChange({ ...value, [k]: v });

  const {
    valid,
    phoneValid,
    emergencyPhoneValid,
    emergencyValid,
    dobValid,
    relationshipOtherValid,
  } = useMemo(() => validateFamilyMemberFormValue(value, today), [value, today]);

  const hasHealthNotes = hasFamilyMemberHealthNotes(value);
  const consentMissing = hasHealthNotes && !healthConsent;

  const submit = () => {
    setTouched(true);
    if (!valid || consentMissing || submitting) return;
    onSubmit();
  };

  return (
    <div className="space-y-5">
      <Field
        label={t("familyMembers.fullName", "Full name")}
        value={value.fullName}
        onChange={(v) => set("fullName", v)}
        placeholder={t("familyMembers.fullNamePlaceholder", "e.g. Layla Ahmed")}
      />
      {touched && value.fullName.trim().length === 0 && (
        <ErrorText>{t("validation.required")}</ErrorText>
      )}

      <div>
        <label className="block text-pro-12 font-bold uppercase tracking-wide text-muted-foreground">
          {t("familyMembers.relationship", "Relationship")}
        </label>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {RELATIONSHIPS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => set("relationship", r)}
              aria-pressed={value.relationship === r}
              className={`min-h-11 rounded-2xl border py-3 text-pro-12 font-bold transition-all ${
                value.relationship === r
                  ? "border-brand bg-brand/5 text-brand"
                  : "border-border bg-surface text-muted-foreground"
              }`}
            >
              {t(`familyMembers.relationships.${r}`)}
            </button>
          ))}
        </div>
        {touched && !value.relationship && <ErrorText>{t("validation.required")}</ErrorText>}
        {value.relationship === "other" && (
          <>
            <input
              value={value.relationshipOther}
              onChange={(e) => set("relationshipOther", e.target.value)}
              placeholder={t("familyMembers.relationshipOtherPlaceholder", "e.g. Cousin")}
              className="mt-2 h-12 w-full rounded-2xl border border-border bg-surface px-4 text-pro-14 font-medium outline-none focus:border-brand"
            />
            {touched && !relationshipOtherValid && (
              <ErrorText>{t("validation.required")}</ErrorText>
            )}
          </>
        )}
      </div>

      <div>
        <CustomerBirthDateField
          nested={nestedDatePicker}
          value={value.dateOfBirth}
          onChange={(v) => set("dateOfBirth", v)}
        />
        {touched && !dobValid && (
          <ErrorText>
            {t("familyMembers.dobFuture", "Date of birth cannot be in the future")}
          </ErrorText>
        )}
      </div>

      <div>
        <label className="block text-pro-12 font-bold uppercase tracking-wide text-muted-foreground">
          {t("familyMembers.gender", "Gender")}{" "}
          <span className="normal-case text-muted-foreground/70">
            ({t("familyMembers.optional", "optional")})
          </span>
        </label>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {GENDERS.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => set("gender", value.gender === g ? "" : g)}
              aria-pressed={value.gender === g}
              className={`min-h-11 rounded-2xl border py-3 text-pro-14 font-bold transition-all ${
                value.gender === g
                  ? "border-brand bg-brand/5 text-brand"
                  : "border-border bg-surface text-muted-foreground"
              }`}
            >
              {t(`familyMembers.genders.${g}`)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <Field
          label={`${t("familyMembers.phone", "Phone")} (${t("familyMembers.optional", "optional")})`}
          value={value.phone}
          onChange={(v) => set("phone", v)}
          placeholder={t("familyMembers.phonePlaceholder", "01xxxxxxxxx")}
        />
        {touched && !phoneValid && <ErrorText>{t("validation.invalidPhone")}</ErrorText>}
      </div>

      <TextArea
        label={`${t("familyMembers.allergies", "Allergies")} (${t("familyMembers.optional", "optional")})`}
        value={value.allergies}
        onChange={(v) => set("allergies", v)}
        placeholder={t("familyMembers.allergiesPlaceholder", "e.g. Peanuts, penicillin")}
      />
      <TextArea
        label={`${t("familyMembers.medicalNotes", "Medical notes")} (${t("familyMembers.optional", "optional")})`}
        value={value.medicalNotes}
        onChange={(v) => set("medicalNotes", v)}
        placeholder={t(
          "familyMembers.medicalNotesPlaceholder",
          "Anything the provider should know",
        )}
      />
      {hasHealthNotes && (
        <div>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl border border-border bg-surface p-4">
            <input
              type="checkbox"
              checked={healthConsent}
              onChange={(e) => setHealthConsent(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-brand"
              data-testid="family-member-health-consent"
            />
            <span className="text-pro-13 font-medium leading-relaxed text-foreground">
              {t("familyMembers.healthConsent")}
            </span>
          </label>
          {touched && consentMissing && (
            <ErrorText>{t("familyMembers.healthConsentRequired")}</ErrorText>
          )}
        </div>
      )}
      <TextArea
        label={`${t("familyMembers.accessNotes", "Access notes")} (${t("familyMembers.optional", "optional")})`}
        value={value.accessNotes}
        onChange={(v) => set("accessNotes", v)}
        placeholder={t("familyMembers.accessNotesPlaceholder", "e.g. Needs help with stairs")}
      />

      <div className="space-y-3 rounded-2xl bg-surface-2 p-4">
        <div className="text-pro-12 font-bold uppercase tracking-wide text-muted-foreground">
          {t("studentEducation.sectionTitle", "School details")}{" "}
          <span className="normal-case text-muted-foreground/70">
            ({t("familyMembers.optional", "optional")})
          </span>
        </div>
        <EducationProfileFields
          value={value.education}
          onChange={(education) => onChange({ ...value, education })}
        />
      </div>

      <div className="space-y-3 rounded-2xl bg-surface-2 p-4">
        <div className="text-pro-12 font-bold uppercase tracking-wide text-muted-foreground">
          {t("familyMembers.emergencyContact", "Emergency contact")}{" "}
          <span className="normal-case text-muted-foreground/70">
            ({t("familyMembers.optional", "optional")})
          </span>
        </div>
        <Field
          label={t("familyMembers.emergencyContactName", "Name")}
          value={value.emergencyContactName}
          onChange={(v) => set("emergencyContactName", v)}
          placeholder={t("familyMembers.emergencyContactNamePlaceholder", "Contact's full name")}
        />
        <Field
          label={t("familyMembers.emergencyContactPhone", "Phone")}
          value={value.emergencyContactPhone}
          onChange={(v) => set("emergencyContactPhone", v)}
          placeholder={t("familyMembers.phonePlaceholder", "01xxxxxxxxx")}
        />
        {touched && !emergencyValid && (
          <ErrorText>
            {t(
              "familyMembers.emergencyPhoneRequired",
              "Emergency contact phone is required when a name is provided",
            )}
          </ErrorText>
        )}
        {touched && emergencyValid && !emergencyPhoneValid && (
          <ErrorText>{t("validation.invalidPhone")}</ErrorText>
        )}
      </div>

      <PrimaryButton onClick={submit} disabled={submitting} data-testid="family-member-save">
        {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : submitLabel}
      </PrimaryButton>
    </div>
  );
}

export function hasFamilyMemberHealthNotes(
  v: Pick<FamilyMemberFormValue, "allergies" | "medicalNotes">,
) {
  return v.allergies.trim().length > 0 || v.medicalNotes.trim().length > 0;
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-pro-12 font-semibold text-brand">{children}</p>;
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      <label className="block text-pro-12 font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-2 h-14 w-full rounded-2xl border border-border bg-surface px-4 text-pro-16 font-medium outline-none focus:border-brand"
      />
    </div>
  );
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      <label className="block text-pro-12 font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <textarea
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-2 w-full resize-none rounded-2xl border border-border bg-surface px-4 py-3 text-pro-16 outline-none focus:border-brand"
      />
    </div>
  );
}
