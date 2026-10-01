export const SESSION_DURATIONS_MIN = [60, 90, 120, 180] as const;
export type SessionDurationMin = (typeof SESSION_DURATIONS_MIN)[number];
export const DEFAULT_SESSION_DURATION_MIN: SessionDurationMin = 120;

export function isTutoringCategorySlug(slug: string | null | undefined): boolean {
  return slug === "tutoring";
}

export function isTutoringServiceSlug(slug: string | null | undefined): boolean {
  return (
    slug === "homework-support" ||
    slug === "school-subject-tutoring" ||
    slug === "language-tutoring"
  );
}

export function allowedDurationsForSubject(
  maxSessionDurationMin: number,
  serviceAllowed: number[] | null | undefined,
): SessionDurationMin[] {
  const allowed = (serviceAllowed?.length ? serviceAllowed : [...SESSION_DURATIONS_MIN]).filter(
    (value): value is SessionDurationMin =>
      (SESSION_DURATIONS_MIN as readonly number[]).includes(value),
  );
  return allowed.filter((duration) => duration <= maxSessionDurationMin);
}

export type TeachingCapabilityLabelInput = {
  subject: string;
  curriculum: string;
  level: string;
  durationMin: number;
  price: number;
};

export function formatTeachingCapabilityLine(input: TeachingCapabilityLabelInput): string {
  return `${input.subject} · ${input.curriculum} · ${input.level} — ${input.durationMin} min — EGP ${input.price}`;
}

export type TutoringSessionQuote = {
  durationMin: number;
  sessionPrice: number;
  subtotal: number;
  labelKey: "bookFlow.sessionLine";
};

export function tutoringSessionQuote(
  durationMin: number,
  sessionPrice: number,
): TutoringSessionQuote {
  return {
    durationMin,
    sessionPrice,
    subtotal: sessionPrice,
    labelKey: "bookFlow.sessionLine",
  };
}

export function bookingFlowQuotesMatch(
  step: TutoringSessionQuote,
  summary: TutoringSessionQuote,
  payment: TutoringSessionQuote,
): boolean {
  return (
    step.durationMin === summary.durationMin &&
    step.durationMin === payment.durationMin &&
    step.sessionPrice === summary.sessionPrice &&
    step.sessionPrice === payment.sessionPrice &&
    step.subtotal === summary.subtotal &&
    step.subtotal === payment.subtotal
  );
}

export type TeachingCapabilityOption = {
  id: string;
  providerId: string;
  serviceId: string;
  subjectCode: string;
  subjectNameEn: string;
  subjectNameAr: string;
  curriculumCode: string;
  curriculumNameEn: string;
  curriculumNameAr: string;
  levelCode: string;
  levelNameEn: string;
  levelNameAr: string;
  durationMin: number;
  price: number;
  status: string;
  maxSessionDurationMin: number;
};

export function localizedTaxonomyName(
  row: { name_en?: string | null; name_ar?: string | null },
  lang: "en" | "ar",
): string {
  if (lang === "ar") return row.name_ar || row.name_en || "";
  return row.name_en || row.name_ar || "";
}
