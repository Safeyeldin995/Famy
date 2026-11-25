import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type StudentParentLinkStatus = {
  link_id: string;
  status: "notified" | "linked" | "flagged_not_my_child" | "revoked";
  parent_id: string | null;
  requested_parent_phone: string;
  parent_email: string;
  requested_at: string;
  decided_at: string | null;
} | null;

export type ParentLinkedStudent = {
  link_id: string;
  student_id: string;
  student_name: string;
  status: string;
  requested_at: string;
  decided_at: string | null;
};

export type RegisterParentGuardianResult = {
  link_id: string;
  status: string;
  flag_token: string;
  parent_on_famy: boolean;
  parent_email: string;
  student_name: string;
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

export function useRegisterParentGuardianContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { parentPhone: string; parentEmail: string }) => {
      const { data, error } = await (supabase.rpc as any)("register_parent_guardian_contact", {
        p_parent_phone: input.parentPhone,
        p_parent_email: input.parentEmail,
      });
      if (error) throw error;
      return data as RegisterParentGuardianResult;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["student-parent-link"] });
    },
  });
}

export function useUpdateParentGuardianContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { parentPhone: string; parentEmail: string }) => {
      const { data, error } = await (supabase.rpc as any)("update_parent_guardian_contact", {
        p_parent_phone: input.parentPhone,
        p_parent_email: input.parentEmail,
      });
      if (error) throw error;
      return data as RegisterParentGuardianResult;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["student-parent-link"] });
    },
  });
}

export function useParentAcknowledgeStudentLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (linkId: string) => {
      const { data, error } = await (supabase.rpc as any)("parent_acknowledge_student_link", {
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

export function useParentFlagNotMyChild() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (linkId: string) => {
      const { data, error } = await (supabase.rpc as any)("parent_flag_not_my_child", {
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

export function useAdminStudentLinks(status: string | null, search: string) {
  return useQuery({
    queryKey: ["admin", "student-links", status, search],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("admin_list_student_links", {
        p_status: status,
        p_search: search.trim() || null,
      });
      if (error) throw error;
      return (data ?? []) as Record<string, unknown>[];
    },
  });
}

export function useAdminRevokeStudentLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { linkId: string; reason: string }) => {
      const { data, error } = await (supabase.rpc as any)("admin_revoke_student_link", {
        p_link_id: input.linkId,
        p_reason: input.reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "student-links"] });
      void qc.invalidateQueries({ queryKey: ["admin", "student-parent-flags"] });
    },
  });
}

export function useAdminStudentParentFlagCount() {
  return useQuery({
    queryKey: ["admin", "student-parent-flags"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("admin_student_parent_flag_count");
      if (error) throw error;
      return Number(data ?? 0);
    },
  });
}