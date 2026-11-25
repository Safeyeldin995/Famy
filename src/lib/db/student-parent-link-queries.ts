import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type StudentParentLinkStatus = "pending" | "approved" | "rejected" | "revoked";

export type AdminStudentLinkRow = {
  link_id: string;
  student_id: string;
  student_name: string;
  parent_id: string | null;
  parent_name: string | null;
  parent_phone_masked: string | null;
  status: StudentParentLinkStatus;
  requested_at: string;
  decided_at: string | null;
  revoke_reason: string | null;
};

export type AdminCustomerParentLink = {
  link_id: string;
  student_id: string;
  parent_id: string | null;
  parent_name: string | null;
  parent_phone_masked: string | null;
  status: StudentParentLinkStatus;
  requested_at: string;
  decided_at: string | null;
  revoke_reason: string | null;
};

export type AdminLinkedStudentRow = {
  link_id: string;
  student_id: string;
  student_name: string;
  status: StudentParentLinkStatus;
  requested_at: string;
  decided_at: string | null;
};

export type AdminBookingBlockRow = {
  student_id: string;
  student_name: string;
  attempted_at: string;
};

export type ParentLinkedStudentRow = {
  link_id: string;
  student_id: string;
  student_name: string;
  status: StudentParentLinkStatus;
  requested_at: string;
  decided_at: string | null;
};

export type ParentStudentLessonRow = {
  booking_id: string;
  start_at: string;
  end_at: string;
  status: string;
  price_total: number | null;
  payment_status: string | null;
};

export type MyStudentParentLink = {
  id: string;
  student_id: string;
  parent_id: string | null;
  requested_parent_phone: string;
  status: StudentParentLinkStatus;
  requested_at: string;
  decided_at: string | null;
};

type UntypedRpc = (
  fn: string,
  args?: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await (supabase.rpc as unknown as UntypedRpc)(fn, args);
  if (error) throw error;
  return data as T;
}

export function useAdminStudentLinks(status: string, search: string) {
  return useQuery({
    queryKey: ["admin", "student-parent-links", status, search],
    queryFn: () =>
      rpc<AdminStudentLinkRow[]>("admin_list_student_links", {
        p_status: status || null,
        p_search: search || null,
      }).then((rows) => rows ?? []),
  });
}

export function useAdminRevokeStudentLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { linkId: string; reason: string }) =>
      rpc("admin_revoke_student_link", {
        p_link_id: input.linkId,
        p_reason: input.reason,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin"] });
      void qc.invalidateQueries({ queryKey: ["admin", "work-queue"] });
    },
  });
}

export function useAdminCustomerParentLink(customerId: string) {
  return useQuery({
    queryKey: ["admin", "customer-parent-link", customerId],
    enabled: !!customerId,
    queryFn: () =>
      rpc<AdminCustomerParentLink | null>("admin_customer_student_parent_link", {
        p_customer_id: customerId,
      }),
  });
}

export function useAdminCustomerLinkedStudents(parentId: string) {
  return useQuery({
    queryKey: ["admin", "customer-linked-students", parentId],
    enabled: !!parentId,
    queryFn: () =>
      rpc<AdminLinkedStudentRow[]>("admin_customer_linked_students", {
        p_parent_id: parentId,
      }).then((rows) => rows ?? []),
  });
}

export function useAdminStudentBookingBlocks(customerId?: string) {
  return useQuery({
    queryKey: ["admin", "student-parent-booking-blocks", customerId ?? "all"],
    queryFn: () =>
      rpc<AdminBookingBlockRow[]>("admin_student_parent_booking_blocks", {
        p_customer_id: customerId ?? null,
      }).then((rows) => rows ?? []),
  });
}

export function useMyStudentParentLink(userId: string | undefined) {
  return useQuery({
    queryKey: ["student-parent-link", "mine", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("student_parent_links" as never)
        .select(
          "id, student_id, parent_id, requested_parent_phone, status, requested_at, decided_at",
        )
        .eq("student_id", userId!)
        .in("status", ["pending", "approved"])
        .order("requested_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as MyStudentParentLink | null) ?? null;
    },
  });
}

export function useRequestParentLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (phone: string) =>
      rpc<{ link_id: string; status: string; parent_found: boolean }>("request_parent_link", {
        p_parent_phone: phone,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["student-parent-link"] });
    },
  });
}

export function useRespondParentLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { linkId: string; approve: boolean }) =>
      rpc("respond_parent_link", {
        p_link_id: input.linkId,
        p_approve: input.approve,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["student-parent-link"] });
      void qc.invalidateQueries({ queryKey: ["parent-linked-students"] });
    },
  });
}

export function useRevokeParentLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) => rpc("revoke_parent_link", { p_link_id: linkId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["student-parent-link"] });
      void qc.invalidateQueries({ queryKey: ["parent-linked-students"] });
    },
  });
}

export function useParentLinkedStudents() {
  return useQuery({
    queryKey: ["parent-linked-students"],
    queryFn: () =>
      rpc<ParentLinkedStudentRow[]>("parent_linked_students").then((rows) => rows ?? []),
  });
}

export function useParentStudentLessons(studentId: string | undefined) {
  return useQuery({
    queryKey: ["parent-student-lessons", studentId],
    enabled: !!studentId,
    queryFn: () =>
      rpc<ParentStudentLessonRow[]>("parent_student_lessons", {
        p_student_id: studentId,
      }).then((rows) => rows ?? []),
  });
}

export async function isApprovedParentOfStudent(parentId: string, studentId: string) {
  return rpc<boolean>("is_approved_parent_of_student", {
    p_parent_id: parentId,
    p_student_id: studentId,
  });
}
