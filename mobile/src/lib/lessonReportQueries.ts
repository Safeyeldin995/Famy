// Lesson reports and learner progress: app data hooks.
// Mirrors src/lib/db/lesson-report-queries.ts. The RPCs come from migration 20261128140000.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import {
  fetchLearnerProgress,
  fetchLessonReport,
  fetchQuranCatalog,
  lessonReportQueryKeys,
  submitLessonReport,
  type LessonReportDraft,
  type LessonReportKind,
} from "@shared/lessonReports/lessonReports";

export function useLessonReport(bookingId: string | undefined, enabled = true) {
  return useQuery({
    enabled: Boolean(bookingId) && enabled,
    queryKey: lessonReportQueryKeys.report(bookingId ?? ""),
    queryFn: () => fetchLessonReport(supabase, bookingId!),
    staleTime: 30_000,
  });
}

export function useLearnerProgress(learnerId: string | null, enabled = true) {
  return useQuery({
    enabled,
    queryKey: lessonReportQueryKeys.progress(learnerId),
    queryFn: () => fetchLearnerProgress(supabase, learnerId),
  });
}

export function useQuranCatalog(enabled = true) {
  return useQuery({
    enabled,
    queryKey: lessonReportQueryKeys.catalog,
    queryFn: () => fetchQuranCatalog(supabase),
    staleTime: Infinity,
  });
}

export function useSubmitLessonReport(bookingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { kind: LessonReportKind; draft: LessonReportDraft }) =>
      submitLessonReport(supabase, bookingId, args.kind, args.draft),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: lessonReportQueryKeys.report(bookingId) });
      void qc.invalidateQueries({ queryKey: ["learner-progress"] });
    },
  });
}
