/** Students 12+ book online themselves; guardian consent flow removed (PO 2026-11-23). */
export function requiresOnlineGuardianConsent(_input: {
  serviceMode: "in_person" | "online";
  forWhom: string;
  familyMemberDateOfBirth: string | null | undefined;
}): boolean {
  return false;
}