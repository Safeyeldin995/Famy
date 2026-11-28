/**
 * «كمل ملفك» (PO, 28 Nov): one compact card with a percentage ring.
 * Items are ordered by impact, each opens its own editor, done items collapse,
 * and the card disappears at 100%. This card adds no requirement: the approval
 * rules stay in provider_onboarding_completion, and the items it already requires
 * are tagged `required` so the provider can tell them apart from the optional extras.
 */

export type CompletionKey =
  | "photo"
  | "subjects"
  | "babysitting"
  | "hours"
  | "about"
  | "experience"
  | "education"
  | "certificates"
  | "reference"
  | "personal";

export type ProfileCompletionData = {
  photo: boolean;
  about: boolean;
  hours: boolean;
  personal: boolean;
  reference: boolean;
  babysitting: boolean;
  subjects: boolean;
  /** Provider offers a babysitting service. */
  needsBabysitting: boolean;
  /** Provider offers tutoring, Quran or music. */
  needsSubjects: boolean;
  educationCount: number;
  experienceCount: number;
  certificateCount: number;
  verifiedCertificateCount?: number;
};

/** Impact order: what a parent sees first and what makes the provider findable comes first. */
const ORDER: CompletionKey[] = [
  "photo",
  "subjects",
  "babysitting",
  "hours",
  "about",
  "experience",
  "education",
  "certificates",
  "reference",
  "personal",
];

/** Already required by provider_onboarding_completion before approval (unchanged). */
const APPROVAL_REQUIRED: ReadonlySet<CompletionKey> = new Set([
  "photo",
  "about",
  "babysitting",
  "personal",
  "reference",
]);

export type CompletionItem = {
  key: CompletionKey;
  done: boolean;
  next: boolean;
  required: boolean;
};

/** `only` limits the card to the items the current screen can edit (e.g. after approval). */
export function profileCompletionModel(
  data: ProfileCompletionData,
  only?: readonly CompletionKey[],
) {
  const applicable = ORDER.filter((key) => {
    if (only && !only.includes(key)) return false;
    if (key === "babysitting") return data.needsBabysitting;
    if (key === "subjects") return data.needsSubjects;
    // Education is about teaching; experience and certificates (e.g. first aid) fit everyone.
    if (key === "education") return data.needsSubjects;
    return true;
  });
  const doneOf = (key: CompletionKey): boolean => {
    switch (key) {
      case "education":
        return data.educationCount > 0;
      case "experience":
        return data.experienceCount > 0;
      case "certificates":
        return data.certificateCount > 0;
      default:
        return data[key];
    }
  };
  const all = applicable.map((key) => ({ key, done: doneOf(key) }));
  const firstMissing = all.find((i) => !i.done)?.key;
  const items: CompletionItem[] = all.map((i) => ({
    ...i,
    next: i.key === firstMissing,
    required: APPROVAL_REQUIRED.has(i.key),
  }));
  const total = items.length;
  const doneCount = items.filter((i) => i.done).length;
  const percent = total ? Math.round((doneCount / total) * 100) : 100;
  return {
    items,
    todo: items.filter((i) => !i.done),
    done: items.filter((i) => i.done),
    doneCount,
    total,
    percent,
    complete: doneCount === total,
    /** SVG ring with r=24: circumference 150.8. */
    strokeDashoffset: Number((150.8 * (1 - percent / 100)).toFixed(1)),
  };
}
