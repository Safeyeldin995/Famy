import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
export type SaveTeachingGroup = {
  serviceId: string;
  subjectId: string;
  curriculumId: string;
  levelIds: string[];
  sessionDurationMin: number;
  sessionPrice: number;
};
export function useSaveTeachingGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveTeachingGroup) => {
      const { data, error } = await supabase.rpc("provider_save_teaching_group", {
        p_service_id: input.serviceId,
        p_subject_id: input.subjectId,
        p_curriculum_id: input.curriculumId,
        p_level_ids: input.levelIds,
        p_session_duration_min: input.sessionDurationMin,
        p_session_price: input.sessionPrice,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["my-teaching-capabilities"] });
    },
  });
}
export function useAdminReviewTeachingGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      ids: string[];
      status: "approved" | "rejected" | "suspended";
      note?: string;
    }) => {
      const { error } = await supabase.rpc("admin_review_teaching_group", {
        p_ids: input.ids,
        p_status: input.status,
        p_review_note: input.note,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-teaching-capabilities"] });
      void qc.invalidateQueries({ queryKey: ["approved-teaching-capabilities"] });
    },
  });
}
