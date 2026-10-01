import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TeachingCapabilityOption } from "@/lib/tutoring/teachingCapabilities";

const TAXONOMY_SELECT = "id, code, name_en, name_ar, is_active, sort_order";
const SUBJECT_SELECT = `${TAXONOMY_SELECT}, max_session_duration_min`;

export type TeachingCurriculumRow = {
  id: string;
  code: string;
  name_en: string;
  name_ar: string;
  is_active: boolean;
  sort_order: number;
};

export type TeachingLevelRow = TeachingCurriculumRow;

export type TeachingSubjectRow = TeachingCurriculumRow & {
  max_session_duration_min: number;
};

export type TeachingSubjectServiceRow = {
  subject_id: string;
  service_id: string;
};

export type ProviderTeachingCapabilityRow = {
  id: string;
  provider_id: string;
  service_id: string;
  subject_id: string;
  curriculum_id: string;
  level_id: string;
  session_duration_min: number;
  session_price: number;
  status: "pending" | "approved" | "rejected" | "suspended";
  submitted_at: string;
  subject?: {
    code: string;
    name_en: string;
    name_ar: string;
    max_session_duration_min: number;
  } | null;
  curriculum?: { code: string; name_en: string; name_ar: string } | null;
  level?: { code: string; name_en: string; name_ar: string } | null;
};

export type AdminTeachingCapabilityRow = ProviderTeachingCapabilityRow & {
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  subject_code: string;
  subject_name_en: string;
  subject_name_ar: string;
  curriculum_code: string;
  curriculum_name_en: string;
  curriculum_name_ar: string;
  level_code: string;
  level_name_en: string;
  level_name_ar: string;
};

const CAPABILITY_SELECT =
  "id, provider_id, service_id, subject_id, curriculum_id, level_id, session_duration_min, session_price, status, submitted_at, subject:teaching_subjects(code, name_en, name_ar, max_session_duration_min), curriculum:teaching_curricula(code, name_en, name_ar), level:teaching_levels(code, name_en, name_ar)";

export function mapCapabilityOption(row: ProviderTeachingCapabilityRow): TeachingCapabilityOption {
  return {
    id: row.id,
    providerId: row.provider_id,
    serviceId: row.service_id,
    subjectCode: row.subject?.code ?? "",
    subjectNameEn: row.subject?.name_en ?? "",
    subjectNameAr: row.subject?.name_ar ?? "",
    curriculumCode: row.curriculum?.code ?? "",
    curriculumNameEn: row.curriculum?.name_en ?? "",
    curriculumNameAr: row.curriculum?.name_ar ?? "",
    levelCode: row.level?.code ?? "",
    levelNameEn: row.level?.name_en ?? "",
    levelNameAr: row.level?.name_ar ?? "",
    durationMin: row.session_duration_min,
    price: row.session_price,
    status: row.status,
    maxSessionDurationMin: row.subject?.max_session_duration_min ?? 120,
  };
}

export function useTeachingCurricula(includeInactive = false) {
  return useQuery({
    queryKey: ["teaching-curricula", includeInactive],
    queryFn: async () => {
      let query = supabase
        .from("teaching_curricula")
        .select(TAXONOMY_SELECT)
        .order("sort_order", { ascending: true });
      if (!includeInactive) query = query.eq("is_active", true);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as TeachingCurriculumRow[];
    },
  });
}

export function useTeachingLevels(includeInactive = false) {
  return useQuery({
    queryKey: ["teaching-levels", includeInactive],
    queryFn: async () => {
      let query = supabase
        .from("teaching_levels")
        .select(TAXONOMY_SELECT)
        .order("sort_order", { ascending: true });
      if (!includeInactive) query = query.eq("is_active", true);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as TeachingLevelRow[];
    },
  });
}

export function useTeachingSubjects(includeInactive = false) {
  return useQuery({
    queryKey: ["teaching-subjects", includeInactive],
    queryFn: async () => {
      let query = supabase
        .from("teaching_subjects")
        .select(SUBJECT_SELECT)
        .order("sort_order", { ascending: true });
      if (!includeInactive) query = query.eq("is_active", true);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as TeachingSubjectRow[];
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
      return (data ?? []) as TeachingSubjectServiceRow[];
    },
  });
}

export function useApprovedTeachingCapabilities(
  providerId: string | undefined,
  serviceId?: string,
) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ["approved-teaching-capabilities", providerId, serviceId ?? null],
    queryFn: async () => {
      let query = supabase
        .from("provider_teaching_capabilities")
        .select(CAPABILITY_SELECT)
        .eq("provider_id", providerId!)
        .eq("status", "approved");
      if (serviceId) query = query.eq("service_id", serviceId);
      const { data, error } = await query;
      if (error) throw error;
      return ((data ?? []) as ProviderTeachingCapabilityRow[]).map(mapCapabilityOption);
    },
  });
}

export function useApprovedTeachingCapabilitiesForProviders(providerIds: string[]) {
  const ids = [...providerIds].sort();
  return useQuery({
    enabled: ids.length > 0,
    queryKey: ["approved-teaching-capabilities-many", ids],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_teaching_capabilities")
        .select(CAPABILITY_SELECT)
        .eq("status", "approved")
        .in("provider_id", ids);
      if (error) throw error;
      return ((data ?? []) as ProviderTeachingCapabilityRow[]).map(mapCapabilityOption);
    },
  });
}

export function useMyTeachingCapabilities(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ["my-teaching-capabilities", providerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_teaching_capabilities")
        .select(CAPABILITY_SELECT)
        .eq("provider_id", providerId!)
        .order("submitted_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ProviderTeachingCapabilityRow[];
    },
  });
}

export function useUpsertTeachingCapability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      serviceId: string;
      subjectId: string;
      curriculumId: string;
      levelId: string;
      sessionDurationMin: number;
      sessionPrice: number;
      id?: string | null;
    }) => {
      const { data, error } = await supabase.rpc("provider_upsert_teaching_capability", {
        p_service_id: input.serviceId,
        p_subject_id: input.subjectId,
        p_curriculum_id: input.curriculumId,
        p_level_id: input.levelId,
        p_session_duration_min: input.sessionDurationMin,
        p_session_price: input.sessionPrice,
        p_id: input.id ?? undefined,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-teaching-capabilities"] });
      qc.invalidateQueries({ queryKey: ["approved-teaching-capabilities"] });
    },
  });
}

export function useRemoveTeachingCapability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("provider_remove_teaching_capability", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-teaching-capabilities"] });
      qc.invalidateQueries({ queryKey: ["approved-teaching-capabilities"] });
    },
  });
}

export function useAdminTeachingCapabilities(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ["admin-teaching-capabilities", providerId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_provider_teaching_capabilities", {
        p_provider_id: providerId!,
      });
      if (error) throw error;
      return (data ?? []) as AdminTeachingCapabilityRow[];
    },
  });
}

export function useAdminReviewTeachingCapability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      status: "approved" | "rejected" | "suspended";
      note?: string;
    }) => {
      const { error } = await supabase.rpc("admin_review_teaching_capability", {
        p_id: input.id,
        p_status: input.status,
        p_review_note: input.note ?? undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-teaching-capabilities"] });
      qc.invalidateQueries({ queryKey: ["approved-teaching-capabilities"] });
    },
  });
}

export async function upsertTeachingTaxonomyRow(
  table: "teaching_curricula" | "teaching_levels" | "teaching_subjects",
  row: {
    id?: string;
    code?: string;
    name_en: string;
    name_ar: string;
    is_active?: boolean;
    sort_order?: number;
    max_session_duration_min?: number;
  },
) {
  if (row.id) {
    const patch: Record<string, unknown> = {
      name_en: row.name_en,
      name_ar: row.name_ar,
    };
    if (row.is_active != null) patch.is_active = row.is_active;
    if (row.sort_order != null) patch.sort_order = row.sort_order;
    if (table === "teaching_subjects" && row.max_session_duration_min != null) {
      patch.max_session_duration_min = row.max_session_duration_min;
    }
    const { error } = await supabase
      .from(table)
      .update(patch as never)
      .eq("id", row.id);
    if (error) throw error;
    return;
  }
  const insert: Record<string, unknown> = {
    code: row.code,
    name_en: row.name_en,
    name_ar: row.name_ar,
    is_active: row.is_active ?? true,
    sort_order: row.sort_order ?? 99,
  };
  if (table === "teaching_subjects") {
    insert.max_session_duration_min = row.max_session_duration_min ?? 120;
  }
  const { error } = await supabase.from(table).insert(insert as never);
  if (error) throw error;
}
