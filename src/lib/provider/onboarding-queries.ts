/**
 * Provider onboarding data-access hooks (PATCH 5).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type OnboardingStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "NEEDS_CHANGES"
  | "APPROVED"
  | "REJECTED"
  | "SUSPENDED";

export type OnboardingSection =
  | "personal"
  | "experience"
  | "services"
  | "coverage"
  | "references"
  | "review";

export function useOnboardingSnapshot() {
  return useQuery({
    queryKey: ["provider-onboarding-snapshot"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("provider_onboarding_snapshot");
      if (error) throw error;
      return data as Record<string, unknown>;
    },
  });
}

export function useOnboardingCompletion(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ["provider-onboarding-completion", providerId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("provider_onboarding_completion", {
        p_provider_id: providerId!,
      });
      if (error) throw error;
      return data as { ok: boolean; complete?: boolean; errors?: Record<string, string> };
    },
  });
}

export function usePhase1Services() {
  return useQuery({
    queryKey: ["phase1-services"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("id, slug, name_en, name_ar, category:categories(slug, name_en, name_ar)")
        .eq("is_active", true)
        .order("name_en");
      if (error) throw error;
      return (data ?? []).filter((s: any) =>
        s.category?.slug === "home-cleaning" || s.category?.slug === "babysitting",
      );
    },
  });
}

export function useActiveZones() {
  return useQuery({
    queryKey: ["active-zones"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("zones")
        .select("id, name_en, name_ar")
        .eq("is_active", true)
        .order("name_en");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useMyReferences(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ["provider-references", providerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_references")
        .select("*")
        .eq("provider_id", providerId!)
        .order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useSaveOnboardingSection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ section, payload }: { section: OnboardingSection; payload: Record<string, unknown> }) => {
      const { data, error } = await supabase.rpc("provider_save_onboarding_section", {
        p_section: section,
        p_payload: payload as import("@/integrations/supabase/types").Json,
      });
      if (error) throw error;
      return data as { ok: boolean; complete?: boolean; errors?: Record<string, string> };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["provider-onboarding-snapshot"] });
      qc.invalidateQueries({ queryKey: ["my-provider"] });
      qc.invalidateQueries({ queryKey: ["provider-references"] });
      qc.invalidateQueries({ queryKey: ["provider-onboarding-completion"] });
    },
  });
}

export function useSubmitOnboarding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("provider_submit_onboarding");
      if (error) throw error;
      const result = data as { ok: boolean; errors?: Record<string, string>; already_submitted?: boolean };
      if (!result.ok && !result.already_submitted) {
        throw new Error("submission_incomplete");
      }
      return result;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["provider-onboarding-snapshot"] });
      qc.invalidateQueries({ queryKey: ["my-provider"] });
    },
  });
}

export function useSecureUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      type,
      file,
    }: {
      type: "id_card_front" | "id_card_back" | "profile_photo" | "certificate" | "other";
      file: File;
    }) => {
      if (file.size > 10 * 1024 * 1024) throw new Error("file_too_large");
      const allowed = ["image/jpeg", "image/png", "image/jpg", "application/pdf"];
      if (!allowed.includes(file.type)) throw new Error("invalid_file_type");

      const { data: prep, error: prepErr } = await supabase.rpc("provider_prepare_document_upload", {
        p_type: type,
        p_content_type: file.type,
        p_size_bytes: file.size,
      });
      if (prepErr) throw prepErr;
      const path = (prep as { path: string }).path;

      const { error: upErr } = await supabase.storage
        .from("provider-documents")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;

      const { data: docId, error: finErr } = await supabase.rpc("provider_finalize_document_upload", {
        p_path: path,
        p_type: type,
      });
      if (finErr) throw finErr;
      return { docId, path };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["provider-documents"] });
      qc.invalidateQueries({ queryKey: ["provider-onboarding-snapshot"] });
    },
  });
}

export function useAdminOnboardingReview(providerId: string) {
  return useQuery({
    queryKey: ["admin", "provider-onboarding-review", providerId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_provider_onboarding_review", {
        p_provider_id: providerId,
      });
      if (error) throw error;
      return data as Record<string, unknown>;
    },
    enabled: !!providerId,
  });
}

export function useReviewProviderDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      documentId: string;
      status: "approved" | "rejected";
      reason?: string;
    }) => {
      const { error } = await supabase.rpc("admin_review_provider_document", {
        p_document_id: input.documentId,
        p_status: input.status,
        p_reason: input.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin"] }),
  });
}

export function useAdminOnboardingAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      providerId: string;
      action: "start_review" | "approve" | "request_changes" | "reject" | "suspend" | "unsuspend";
      reasonCode?: string;
      reasonPublic?: string;
      notesInternal?: string;
    }) => {
      const { error } = await supabase.rpc("admin_provider_onboarding_action", {
        p_provider_id: input.providerId,
        p_action: input.action,
        p_reason_code: input.reasonCode,
        p_reason_public: input.reasonPublic,
        p_notes_internal: input.notesInternal,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["admin"] });
      qc.invalidateQueries({ queryKey: ["admin", "provider-onboarding-review", vars.providerId] });
    },
  });
}

export function onboardingEditable(status: OnboardingStatus | undefined) {
  return status === "DRAFT" || status === "NEEDS_CHANGES";
}
