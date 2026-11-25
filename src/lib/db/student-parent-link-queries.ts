import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type StudentParentLinkStatus = {
  link_id: string;
  status: "pending" | "approved" | "rejected" | "revoked";
  parent_id: string | null;
  requested_parent_phone: string;
  requested_at: string;
  decided_at: string | null;
  expires_at: string;
} | null;

export type ParentLinkedStudent = {
  link_id: string;
  student_id: string;
  student_name: string;
  status: string;
  requested_at: string;
  decided_at: string | null;
};

export function useStudentParentLinkStatus() {
  return useQuery({
    queryKey: ["student-parent-link", "status"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("student_parent_link_status");
      if (error) throw error;
      if (!data || data === null) return null;
      return data as StudentParentLinkStatus;
    },
  });
}

export function useRequestParentLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (parentPhone: string) => {
      const { data, error } = await (supabase.rpc as any)("request_parent_link", {
        p_parent_phone: parentPhone,
      });
      if (error) throw error;
      return data as { outcome: "sent" | "not_on_famy"; link_id: string };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["student-parent-link"] });
    },
  });
}

export function useRespondParentLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { linkId: string; approve: boolean }) => {
      const { data, error } = await (supabase.rpc as any)("respond_parent_link", {
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

export function useRevokeParentLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (linkId: string) => {
      const { data, error } = await (supabase.rpc as any)("revoke_parent_link", {
        p_link_id: linkId,
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
      const { data, error } = await (supabase.rpc as any)("parent_linked_students");
      if (error) throw error;
      return (data ?? []) as ParentLinkedStudent[];
    },
  });
}

export function useParentStudentLessons(studentId: string | undefined) {
  return useQuery({
    enabled: !!studentId,
    queryKey: ["parent-student-lessons", studentId],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("parent_student_lessons", {
        p_student_id: studentId!,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}