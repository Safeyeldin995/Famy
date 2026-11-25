import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export function useStudentParentLinkStatus() {
  return useQuery({
    queryKey: ["student-parent-link", "status"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("student_parent_link_status");
      if (error) throw error;
      if (!data || data === null) return null;
      return data;
    },
  });
}

export function useRegisterParentGuardianContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { parentPhone: string; parentEmail: string }) => {
      const { data, error } = await supabase.rpc("register_parent_guardian_contact", {
        p_parent_phone: input.parentPhone,
        p_parent_email: input.parentEmail,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["student-parent-link"] }),
  });
}

export function useUpdateParentGuardianContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { parentPhone: string; parentEmail: string }) => {
      const { data, error } = await supabase.rpc("update_parent_guardian_contact", {
        p_parent_phone: input.parentPhone,
        p_parent_email: input.parentEmail,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["student-parent-link"] }),
  });
}

export function useParentAcknowledgeStudentLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (linkId: string) => {
      const { data, error } = await supabase.rpc("parent_acknowledge_student_link", {
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
      const { data, error } = await supabase.rpc("parent_flag_not_my_child", {
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
      const { data, error } = await supabase.rpc("parent_linked_students");
      if (error) throw error;
      return data ?? [];
    },
  });
}