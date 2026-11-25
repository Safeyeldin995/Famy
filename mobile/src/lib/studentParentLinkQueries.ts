import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { appConfig, supabase } from "@/lib/supabase";

export function useStudentParentLinkStatus(options: { enabled?: boolean } = {}) {
  return useQuery({
    enabled: options.enabled ?? true,
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
/** Emails the parent through the website (Resend). Never throws: booking must not depend on it. */
export async function sendParentGuardianEmailFromApp(linkId: string | null): Promise<boolean> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return false;
    const response = await fetch(
      `${appConfig.webOrigin.replace(/\/$/, "")}/api/mobile/parent-guardian-email`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(linkId ? { linkId } : {}),
      },
    );
    const result = await response.json().catch(() => null);
    return response.ok && !!result?.ok;
  } catch {
    return false;
  }
}

/**
 * Saves (or replaces) the parent's phone and email, then emails the parent. Same rules as
 * the website: the email is best effort and never blocks the student.
 */
export function useSaveParentGuardianContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { parentPhone: string; parentEmail: string }) => {
      const { data, error } = await supabase.rpc("register_parent_guardian_contact", {
        p_parent_phone: input.parentPhone,
        p_parent_email: input.parentEmail,
      });
      if (error) throw error;
      const linkId = (data as { link_id?: string } | null)?.link_id ?? null;
      const emailSent = await sendParentGuardianEmailFromApp(linkId);
      return { linkId, emailSent };
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["student-parent-link"] }),
  });
}
