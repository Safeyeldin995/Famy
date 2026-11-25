import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export function useStudentParentLinkStatus() {
  return useQuery({
    queryKey: ["student-parent-link", "status"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("student_parent_link_status");
      if (error) throw error;
      if (!data) return null;
      return data as {
        link_id: string;
        status: string;
        parent_id: string | null;
        requested_parent_phone: string;
        requested_at: string;
        decided_at: string | null;
        expires_at: string;
      };
    },
  });
}

export function useRequestParentLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (parentPhone: string) => {
      const { data, error } = await supabase.rpc("request_parent_link", {
        p_parent_phone: parentPhone,
      });
      if (error) throw error;
      return data as { outcome: "sent" | "not_on_famy"; link_id: string };
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["student-parent-link"] }),
  });
}

export function useRespondParentLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { linkId: string; approve: boolean }) => {
      const { data, error } = await supabase.rpc("respond_parent_link", {
        p_link_id: input.linkId,
        p_approve: input.approve,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["student-parent-link"] });
      void qc.invalidateQueries({ queryKey: ["parent-linked-students"] });
    },
  });
}

export function useParentLinkedStudents() {
  return useQuery({
    queryKey: ["parent-linked-students"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("parent_linked_students");
      if (error) throw error;
      return data ?? [];
    },
  });
}