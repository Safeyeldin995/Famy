/** Maps PostgREST / trigger errors from family_members writes to user-safe i18n keys. */
export function familyMemberErrorMessageKey(error: unknown): string {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return "common.somethingWentWrong";
  if (e.code === "23514") {
    const msg = (e.message ?? "").toLowerCase();
    if (msg.includes("phone number must be in a valid international format")) {
      return "validation.invalidPhone";
    }
    if (msg.includes("emergency contact phone")) {
      return "validation.invalidPhone";
    }
    if (msg.includes("custom relationship label")) {
      return "validation.required";
    }
    if (msg.includes("date of birth cannot be in the future")) {
      return "familyMembers.dobFuture";
    }
    if (msg.includes("emergency contact phone is required")) {
      return "familyMembers.emergencyPhoneRequired";
    }
  }
  return "common.somethingWentWrong";
}
