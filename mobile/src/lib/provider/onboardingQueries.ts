import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { isClosedBetaCategorySlug } from "@shared/catalog/closedBetaCategories";
import { isQaCatalogService, isQaFixtureName } from "@shared/catalog/qaCatalog";
import { uploadProviderDocument, type PickedFile } from "./documentUpload";

export type OnboardingStatus =
  "DRAFT" | "SUBMITTED" | "UNDER_REVIEW" | "NEEDS_CHANGES" | "APPROVED" | "REJECTED" | "SUSPENDED";

export type OnboardingSection =
  "personal" | "experience" | "services" | "coverage" | "references" | "review";

export type DocumentUploadType =
  "id_card_front" | "id_card_back" | "profile_photo" | "certificate" | "other";

export function onboardingEditable(status: OnboardingStatus | undefined) {
  return status === "DRAFT" || status === "NEEDS_CHANGES";
}

export function canUploadDocument(
  status: OnboardingStatus | undefined,
  type: string,
): type is DocumentUploadType {
  if (!["id_card_front", "id_card_back", "profile_photo", "certificate", "other"].includes(type)) {
    return false;
  }
  return (
    onboardingEditable(status) ||
    (type === "profile_photo" && (status === "SUBMITTED" || status === "UNDER_REVIEW"))
  );
}

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

export function useProviderSubmittable(providerId: string | undefined, enabled: boolean) {
  return useQuery({
    enabled: !!providerId && enabled,
    queryKey: ["provider-onboarding-submittable", providerId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("provider_onboarding_submittable", {
        p_provider_id: providerId!,
      });
      if (error) throw error;
      return data as { ok: boolean; complete?: boolean; errors?: Record<string, string> };
    },
  });
}

export function useChildAgeGroups() {
  return useQuery({
    queryKey: ["child-age-groups"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("child_age_groups")
        .select("code, name_en, name_ar, min_months, max_months, sort_order")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function usePhase1Services() {
  return useQuery({
    queryKey: ["phase1-services"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select(
          "id, slug, name_en, name_ar, pricing_model, duration_min, fixed_start_time, provider_pricing_allowed, minimum_price, maximum_price, allowed_session_durations, category:categories(slug, name_en, name_ar)",
        )
        .eq("is_active", true)
        .order("name_en");
      if (error) throw error;
      return (data ?? []).filter((s) => {
        const row = s as { category?: { slug?: string | null } | null; slug?: string };
        return isClosedBetaCategorySlug(row.category?.slug) && !isQaCatalogService(row);
      });
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
      return (data ?? []).filter(
        (z: { name_en?: string; name_ar?: string }) => !isQaFixtureName(z.name_en, z.name_ar),
      );
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

export function useMySavedSelections(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ["provider-saved-selections", providerId],
    queryFn: async () => {
      const [servicesRes, zonesRes] = await Promise.all([
        supabase
          .from("provider_services")
          .select("service_id, status, price_override")
          .eq("provider_id", providerId!),
        supabase.from("zone_providers").select("zone_id").eq("provider_id", providerId!),
      ]);
      if (servicesRes.error) throw servicesRes.error;
      if (zonesRes.error) throw zonesRes.error;
      return {
        services: servicesRes.data ?? [],
        zones: zonesRes.data ?? [],
      };
    },
  });
}

export function useSaveOnboardingSection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      section,
      payload,
    }: {
      section: OnboardingSection;
      payload: Record<string, unknown>;
    }) => {
      const { data, error } = await supabase.rpc("provider_save_onboarding_section", {
        p_section: section,
        p_payload: payload,
      });
      if (error) throw error;
      const result = data as { ok: boolean; complete?: boolean; errors?: Record<string, string> };
      if (result?.ok === false) {
        throw Object.assign(new Error("section_save_incomplete"), {
          sectionErrors: result.errors ?? {},
        });
      }
      return result;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["provider-onboarding-snapshot"] });
      qc.invalidateQueries({ queryKey: ["my-provider"] });
      qc.invalidateQueries({ queryKey: ["provider-references"] });
      qc.invalidateQueries({ queryKey: ["provider-saved-selections"] });
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
      const result = data as {
        ok: boolean;
        errors?: Record<string, string>;
        already_submitted?: boolean;
      };
      if (!result.ok && !result.already_submitted) {
        throw Object.assign(new Error("submission_incomplete"), {
          completionErrors: result.errors ?? {},
        });
      }
      return result;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["provider-onboarding-snapshot"] });
      qc.invalidateQueries({ queryKey: ["my-provider"] });
    },
  });
}

export function useStartOnboarding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("provider_start_onboarding");
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-provider"] });
      qc.invalidateQueries({ queryKey: ["provider-onboarding-snapshot"] });
    },
  });
}

export function useSecureUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ type, file }: { type: DocumentUploadType; file: PickedFile }) =>
      uploadProviderDocument(type, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["provider-documents"] });
      qc.invalidateQueries({ queryKey: ["provider-onboarding-snapshot"] });
    },
  });
}

export function useRemoveOnboardingService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (serviceId: string) => {
      const { error } = await supabase.rpc("provider_remove_onboarding_service", {
        p_service_id: serviceId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["provider-saved-selections"] });
      qc.invalidateQueries({ queryKey: ["my-provider-services"] });
    },
  });
}
