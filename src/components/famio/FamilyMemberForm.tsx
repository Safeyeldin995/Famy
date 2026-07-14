import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { PrimaryButton } from "@/components/famio/ui";
import { normalizePhone } from "@/lib/otp/OtpService";
import type { FamilyMemberInput, Relationship } from "@/lib/db/family-members-queries";

const RELATIONSHIPS: Relationship[] = ["spouse", "son", "daughter", "father", "mother", "sibling", "grandparent", "other"];
const GENDERS = ["male", "female", "other"] as const;
const PHONE_RE = /^\+\d{8,15}$/;

function isValidOptionalPhone(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  return PHONE_RE.test(normalizePhone(trimmed));
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
  };
}

export function familyMemberFormValueToInput(v: FamilyMemberFormValue): FamilyMemberInput {
  return {
    full_name: v.fullName.trim(),
    relationship: v.relationship as Relationship,
    relationship_other: v.relationship === "other" ? v.relationshipOther.trim() : null,
    date_of_birth: v.dateOfBirth,
    gender: v.gender || null,
    phone: v.phone.trim() ? normalizePhone(v.phone.trim()) : null,
    allergies: v.allergies.trim() || null,
    medical_notes: v.medicalNotes.trim() || null,
    access_notes: v.accessNotes.trim() || null,
    emergency_contact_name: v.emergencyContactName.trim() || null,
    emergency_contact_phone: v.emergencyContactPhone.trim() ? normalizePhone(v.emergencyContactPhone.trim()) : null,
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
  };
}

export function FamilyMemberForm({
  value,
  onChange,
  onSubmit,
  submitting,
  submitLabel,
}: {
  value: FamilyMemberFormValue;
  onChange: (v: FamilyMemberFormValue) => void;
  onSubmit: () => void;
  submitting: boolean;
  submitLabel: string;
}) {
  const { t } = useTranslation();
  const [touched, setTouched] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  const set = <K extends keyof FamilyMemberFormValue>(k: K, v: FamilyMemberFormValue[K]) => onChange({ ...value, [k]: v });

  const dobValid = !!value.dateOfBirth && value.dateOfBirth <= today;
  const relationshipOtherValid = value.relationship !== "other" || value.relationshipOther.trim().length > 0;
  const emergencyValid = !value.emergencyContactName.trim() || value.emergencyContactPhone.trim().length > 0;
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

  const submit = () => {
    setTouched(true);
    if (!valid || submitting) return;
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
      {touched && value.fullName.trim().length === 0 && <ErrorText>{t("validation.required")}</ErrorText>}

      <div>
        <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {t("familyMembers.relationship", "Relationship")}
        </label>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {RELATIONSHIPS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => set("relationship", r)}
              className={`rounded-2xl border py-3 text-[11px] font-bold transition-all ${
                value.relationship === r ? "border-navy bg-navy/[0.04] text-navy" : "border-border bg-surface text-muted-foreground"
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
              className="mt-2 h-12 w-full rounded-2xl border border-border bg-surface px-4 text-sm font-medium outline-none focus:border-navy"
            />
            {touched && !relationshipOtherValid && <ErrorText>{t("validation.required")}</ErrorText>}
          </>
        )}
      </div>

      <div>
        <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {t("familyMembers.dateOfBirth", "Date of birth")}
        </label>
        <input
          type="date"
          value={value.dateOfBirth}
          max={today}
          onChange={(e) => set("dateOfBirth", e.target.value)}
          className="mt-2 h-14 w-full rounded-2xl border border-border bg-surface px-4 text-[15px] font-medium outline-none focus:border-navy"
        />
        {touched && !dobValid && <ErrorText>{t("familyMembers.dobFuture", "Date of birth cannot be in the future")}</ErrorText>}
      </div>

      <div>
        <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {t("familyMembers.gender", "Gender")} <span className="normal-case text-muted-foreground/70">({t("familyMembers.optional", "optional")})</span>
        </label>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {GENDERS.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => set("gender", value.gender === g ? "" : g)}
              className={`rounded-2xl border py-3 text-[11px] font-bold transition-all ${
                value.gender === g ? "border-navy bg-navy/[0.04] text-navy" : "border-border bg-surface text-muted-foreground"
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
        placeholder={t("familyMembers.medicalNotesPlaceholder", "Anything the provider should know")}
      />
      <TextArea
        label={`${t("familyMembers.accessNotes", "Access notes")} (${t("familyMembers.optional", "optional")})`}
        value={value.accessNotes}
        onChange={(v) => set("accessNotes", v)}
        placeholder={t("familyMembers.accessNotesPlaceholder", "e.g. Needs help with stairs")}
      />

      <div className="space-y-3 rounded-2xl bg-surface-2 p-4">
        <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {t("familyMembers.emergencyContact", "Emergency contact")} <span className="normal-case text-muted-foreground/70">({t("familyMembers.optional", "optional")})</span>
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
        {touched && !emergencyValid && <ErrorText>{t("familyMembers.emergencyPhoneRequired", "Emergency contact phone is required when a name is provided")}</ErrorText>}
        {touched && emergencyValid && !emergencyPhoneValid && <ErrorText>{t("validation.invalidPhone")}</ErrorText>}
      </div>

      <PrimaryButton onClick={submit} disabled={submitting}>
        {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : submitLabel}
      </PrimaryButton>
    </div>
  );
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[11px] font-semibold text-coral">{children}</p>;
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-2 h-14 w-full rounded-2xl border border-border bg-surface px-4 text-[15px] font-medium outline-none focus:border-navy"
      />
    </div>
  );
}

function TextArea({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</label>
      <textarea
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-2 w-full resize-none rounded-2xl border border-border bg-surface px-4 py-3 text-[15px] outline-none focus:border-navy"
      />
    </div>
  );
}
