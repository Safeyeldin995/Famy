/**
 * Student learning profile, booking flow (issue #536, PR 2): data hooks for the website.
 * The RPCs come from migration 20261126160000 (PR 1).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { matchRpcArgs } from "@/lib/tutoring/studentLearnerFlow";

export type MatchedTutorRow = {
  provider_id: string;
  capability_id: string;
  subject_id: string;
  curriculum_id: string;
  level_id: string;
  session_duration_min: number;
  session_price: number;
};

export type CurriculumWithStyle = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  sort_order: number;
  level_label_style: string | null;
};

// The generated Database types don't include the PR 1 RPCs yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (name: string, args?: Record<string, unknown>) => (supabase.rpc as any)(name, args);

export function useMatchTutorsForStudent(args: ReturnType<typeof matchRpcArgs> | null) {
  return useQuery({
    enabled: Boolean(args?.p_service_id),
    queryKey: ["match-tutors-for-student", args],
    queryFn: async () => {
      const { data, error } = await rpc("match_tutors_for_student", args ?? undefined);
      if (error) throw error;
      return (data ?? []) as MatchedTutorRow[];
    },
  });
}

/** Active systems with the grade label style («3 ابتدائي», Year N, Grade N, PYP/MYP/DP). */
export function useCurriculaWithStyle() {
  return useQuery({
    queryKey: ["teaching-curricula-style"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teaching_curricula")
        .select("id, code, name_ar, name_en, sort_order, level_label_style" as "id")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as CurriculumWithStyle[];
    },
  });
}

export function useRequestTutorAvailability() {
  return useMutation({
    mutationFn: async (input: {
      serviceId: string;
      subjectId: string | null;
      curriculumId: string | null;
      levelId: string | null;
      serviceMode: "online" | "in_person";
      familyMemberId: string | null;
    }) => {
      const { data, error } = await rpc("request_tutor_availability", {
        p_service_id: input.serviceId,
        p_subject_id: input.subjectId,
        p_curriculum_id: input.curriculumId,
        p_level_id: input.levelId,
        p_service_mode: input.serviceMode,
        p_family_member_id: input.familyMemberId,
      });
      if (error) throw error;
      return data as { status?: string } | null;
    },
  });
}

/** «صح؟»: the parent confirms the grade after the 1 September move-up (null = the account owner). */
export function useConfirmStudentGrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (familyMemberId: string | null) => {
      const { error } = await rpc("confirm_student_grade", { p_family_member_id: familyMemberId });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["family-members"] });
      void qc.invalidateQueries({ queryKey: ["customer-education-profile"] });
    },
  });
}
