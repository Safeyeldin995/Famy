import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useResolveOnlineLessonIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      status,
      adminNotes,
    }: {
      id: string;
      status: "resolved" | "rejected";
      adminNotes: string;
    }) => {
      const { error } = await (supabase.rpc as any)("admin_resolve_online_lesson_issue", {
        p_id: id,
        p_status: status,
        p_admin_notes: adminNotes,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-online-lesson-issues"] });
      void qc.invalidateQueries({ queryKey: ["admin", "work-queue"] });
    },
  });
}

export function useResolveOnlineSessionReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: "resolved" | "dismissed";
    }) => {
      const { error } = await (supabase.rpc as any)("admin_resolve_online_session_review", {
        p_id: id,
        p_status: status,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "online-session-reviews"] });
      void qc.invalidateQueries({ queryKey: ["admin", "work-queue"] });
    },
  });
}