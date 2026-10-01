const TEACHING_ERROR_CODE_TO_I18N_KEY: Record<string, string> = {
  TEACHING_UNAUTHORIZED: "teaching.errors.unauthorized",
  TEACHING_INVALID_DURATION: "teaching.errors.invalidDuration",
  TEACHING_INVALID_PRICE: "teaching.errors.invalidPrice",
  TEACHING_SUBJECT_NOT_LINKED: "teaching.errors.subjectNotLinked",
  TEACHING_SELF_REVIEW: "teaching.errors.selfReview",
};

/** Map RPC/DB teaching upsert errors to a safe i18n key (never surface raw SQL text). */
export function teachingUpsertErrorKey(message: string | undefined): string {
  if (!message?.trim()) return "teaching.errors.generic";
  const prefix = message.split(":")[0]?.trim() ?? "";
  if (prefix.startsWith("TEACHING_")) {
    return TEACHING_ERROR_CODE_TO_I18N_KEY[prefix] ?? "teaching.errors.generic";
  }
  return "teaching.errors.generic";
}
