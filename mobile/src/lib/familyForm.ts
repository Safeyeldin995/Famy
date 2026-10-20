import { normalizePhoneE164 } from "@shared/otp/normalizePhone";
import type { FamilyMemberInput } from "./queries";

// Source: src/components/famio/FamilyMemberForm.tsx — pure validation/normalization.
export const relationships = [
  "spouse",
  "son",
  "daughter",
  "father",
  "mother",
  "sibling",
  "grandparent",
  "other",
] as const;
export function emptyMember(): FamilyMemberInput {
  return {
    full_name: "",
    relationship: "son",
    relationship_other: "",
    date_of_birth: "",
    gender: null,
    phone: "",
    allergies: "",
    medical_notes: "",
    access_notes: "",
    emergency_contact_name: "",
    emergency_contact_phone: "",
    education_curriculum_id: null,
    education_level_id: null,
  };
}
export function validMember(value: FamilyMemberInput, consent: boolean, today: string) {
  const dob = value.date_of_birth;
  const date = new Date(`${dob}T12:00:00Z`);
  const dateValid =
    /^\d{4}-\d{2}-\d{2}$/.test(dob) &&
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === dob &&
    dob <= today;
  const phoneValid = (s?: string | null) =>
    !s?.trim() || /^\+\d{8,15}$/.test(normalizePhoneE164(s.trim()));
  return (
    !!value.full_name.trim() &&
    dateValid &&
    relationships.includes(value.relationship) &&
    (value.relationship !== "other" || !!value.relationship_other?.trim()) &&
    phoneValid(value.phone) &&
    phoneValid(value.emergency_contact_phone) &&
    (!value.emergency_contact_name?.trim() || !!value.emergency_contact_phone?.trim()) &&
    (!(value.allergies?.trim() || value.medical_notes?.trim()) || consent)
  );
}
export function memberInput(value: FamilyMemberInput): FamilyMemberInput {
  return {
    ...value,
    full_name: value.full_name.trim(),
    relationship_other: value.relationship === "other" ? value.relationship_other?.trim() : null,
    phone: value.phone?.trim() ? normalizePhoneE164(value.phone) : null,
    emergency_contact_phone: value.emergency_contact_phone?.trim()
      ? normalizePhoneE164(value.emergency_contact_phone)
      : null,
  };
}
