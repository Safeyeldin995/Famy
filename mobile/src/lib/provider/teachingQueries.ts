import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const TAXONOMY_SELECT = "id, code, name_en, name_ar, is_active, sort_order";
const SUBJECT_SELECT = `${TAXONOMY_SELECT}, max_session_duration_min`;

export function useMyTeachingCapabilities(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ["my-teaching-capabilities", providerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_teaching_capabilities")
        .select(
          "id, provider_id, service_id, subject_id, curriculum_id, level_id, session_duration_min, session_price, status, submitted_at, subject:teaching_subjects(code, name_en, name_ar, max_session_duration_min), curriculum:teaching_curricula(code, name_en, name_ar), level:teaching_levels(code, name_en, name_ar)",
        )
        .eq("provider_id", providerId!);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useTeachingSubjects() {
  return useQuery({
    queryKey: ["teaching-subjects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teaching_subjects")
        .select(SUBJECT_SELECT)
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useTeachingCurricula() {
  return useQuery({
    queryKey: ["teaching-curricula"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teaching_curricula")
        .select(TAXONOMY_SELECT)
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useTeachingLevels() {
  return useQuery({
    queryKey: ["teaching-levels"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teaching_levels")
        .select(TAXONOMY_SELECT)
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useTeachingSubjectServices() {
  return useQuery({
    queryKey: ["teaching-subject-services"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teaching_subject_services")
        .select("subject_id, service_id");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useSaveTeachingGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      serviceId: string;
      subjectId: string;
      curriculumId: string;
      levelIds: string[];
      sessionDurationMin: number;
      sessionPrice: number;
    }) => {
      const { error } = await supabase.rpc("provider_save_teaching_group", {
        p_service_id: input.serviceId,
        p_subject_id: input.subjectId,
        p_curriculum_id: input.curriculumId,
        p_level_ids: input.levelIds,
        p_session_duration_min: input.sessionDurationMin,
        p_session_price: input.sessionPrice,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-teaching-capabilities"] });
    },
  });
}

export function useRemoveTeachingCapability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from("provider_teaching_capabilities")
        .delete()
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-teaching-capabilities"] }),
  });
}
