/**
 * Turns a «أضيفها لموادي» prefill (ids from the demand card) into the starting
 * state of the add-subject screen. Shared by web and app.
 *
 * Saving a teaching group replaces the group's non-approved grades with the ones
 * selected, so the grades the tutor already has for the same subject and system
 * are kept selected, and the group's existing duration and price are reused.
 */
import type { DemandPrefill } from "./tutorDemandInsights";

type Ided = { id: string };
type CurriculumLike = { id: string; code: string };
type LinkLike = { subject_id: string; service_id: string };
type RowLike = {
  service_id: string;
  subject_id: string;
  curriculum_id: string;
  level_id: string;
  status: string;
  session_duration_min: number;
  session_price: number;
};

export type TeachingSetupPrefill = {
  serviceId: string;
  subjectId: string;
  /** Empty for services without a school system (Quran, music). */
  curriculumId: string;
  levelIds: string[];
  durationMin?: number;
  price?: number;
};

export function teachingSetupPrefill(
  initial: DemandPrefill | null | undefined,
  data: {
    services: readonly Ided[];
    subjects: readonly Ided[];
    curricula: readonly CurriculumLike[];
    links: readonly LinkLike[];
    rows: readonly RowLike[];
  },
): TeachingSetupPrefill | null {
  const serviceId = initial?.service;
  if (!serviceId || !data.services.some((s) => s.id === serviceId)) return null;

  const subjectId =
    initial?.subject &&
    data.subjects.some((s) => s.id === initial.subject) &&
    data.links.some((l) => l.service_id === serviceId && l.subject_id === initial.subject)
      ? initial.subject
      : "";
  if (!subjectId) return { serviceId, subjectId: "", curriculumId: "", levelIds: [] };

  const curriculum = initial?.curriculum
    ? data.curricula.find((c) => c.id === initial.curriculum)
    : undefined;
  const curriculumId = curriculum && curriculum.code !== "na" ? curriculum.id : "";

  const group = curriculum
    ? data.rows.filter(
        (r) =>
          r.service_id === serviceId &&
          r.subject_id === subjectId &&
          r.curriculum_id === curriculum.id,
      )
    : [];
  const keep = group.filter((r) => r.status !== "approved").map((r) => r.level_id);
  const levelIds = [...new Set([...keep, ...(initial?.level ? [initial.level] : [])])];
  const template = group[0];
  return {
    serviceId,
    subjectId,
    curriculumId,
    levelIds,
    durationMin: template?.session_duration_min,
    price: template?.session_price,
  };
}
