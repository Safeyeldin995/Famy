import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { isClosedBetaCategorySlug } from "@shared/catalog/closedBetaCategories";
import { isQaCatalogService } from "@shared/catalog/qaCatalog";
import { File } from "expo-file-system";
import { Platform } from "react-native";
import type { PickedFile } from "./documentUpload";

export function useProviderDocuments(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ["provider-documents", providerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_documents")
        .select("id, type, status, rejected_reason, created_at")
        .eq("provider_id", providerId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAllServices() {
  return useQuery({
    queryKey: ["all-services"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("*, category:categories(slug, name_en, name_ar)")
        .eq("is_active", true)
        .order("name_en");
      if (error) throw error;
      return (data ?? []).filter(
        (row: { category?: { slug?: string | null } | null }) =>
          isClosedBetaCategorySlug(row.category?.slug) && !isQaCatalogService(row),
      );
    },
  });
}

export function useMyProviderServicesDetailed(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ["my-provider-services", providerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_services")
        .select(
          "service_id, price_override, status, service:services(id, name_en, name_ar, is_active, provider_pricing_allowed, minimum_price, maximum_price, pricing_model, category:categories(slug, name_en, name_ar))",
        )
        .eq("provider_id", providerId!);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useProviderRequestService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      serviceId,
      payload,
      idempotencyKey,
    }: {
      serviceId: string;
      payload: Record<string, unknown>;
      idempotencyKey?: string;
    }) => {
      const { data, error } = await supabase.rpc("provider_request_service", {
        p_service_id: serviceId,
        p_payload: payload as never,
        p_idempotency_key: idempotencyKey ?? null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["my-provider-services"] });
    },
  });
}

export function useCancelProviderServiceRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (serviceId: string) => {
      const { error } = await supabase.rpc("provider_cancel_service_request", {
        p_service_id: serviceId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["my-provider-services"] });
    },
  });
}

export function useToggleProviderService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      providerId,
      serviceId,
      on,
    }: {
      providerId: string;
      serviceId: string;
      on: boolean;
    }) => {
      if (on) {
        const { error } = await supabase
          .from("provider_services")
          .insert({ provider_id: providerId, service_id: serviceId });
        if ((error as { code?: string } | null)?.code === "23505") {
          const { error: resubmitError } = await supabase.rpc("provider_resubmit_rejected_service", {
            p_service_id: serviceId,
          });
          if (resubmitError) throw resubmitError;
        } else if (error) {
          throw error;
        }
      } else {
        const { error } = await supabase
          .from("provider_services")
          .delete()
          .eq("provider_id", providerId)
          .eq("service_id", serviceId);
        if (error) throw error;
      }
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ["my-provider-services", vars.providerId] }),
  });
}

export function useSetProviderPrice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      providerId,
      serviceId,
      price,
    }: {
      providerId: string;
      serviceId: string;
      price: number | null;
    }) => {
      const { error } = await supabase
        .from("provider_services")
        .update({ price_override: price })
        .eq("provider_id", providerId)
        .eq("service_id", serviceId);
      if (error) throw error;
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ["my-provider-services", vars.providerId] }),
  });
}

export type NotificationPreferences = {
  user_id: string;
  booking_push: boolean;
  chat_push: boolean;
  reminder_push: boolean;
  support_push: boolean;
  campaign_push: boolean;
  campaign_in_app: boolean;
};

const DEFAULT_NOTIFICATION_PREFERENCES: Omit<NotificationPreferences, "user_id"> = {
  booking_push: true,
  chat_push: true,
  reminder_push: true,
  support_push: true,
  campaign_push: false,
  campaign_in_app: true,
};

export function useNotificationPreferences() {
  return useQuery({
    queryKey: ["notification-preferences"],
    queryFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return null;
      const { data, error } = await supabase
        .from("notification_preferences")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? {
        user_id: user.id,
        ...DEFAULT_NOTIFICATION_PREFERENCES,
      }) as NotificationPreferences;
    },
  });
}

export function useUpdateNotificationPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Omit<NotificationPreferences, "user_id">>) => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error("auth required");
      const { error } = await supabase
        .from("notification_preferences")
        .upsert({ user_id: user.id, ...patch }, { onConflict: "user_id" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notification-preferences"] }),
  });
}

export async function uploadRequirementEvidence(
  providerId: string,
  requirementId: string,
  asset: PickedFile,
) {
  const nativeFile = Platform.OS !== "web" ? new File(asset.uri) : null;
  const bytes = nativeFile
    ? await nativeFile.arrayBuffer()
    : await (await fetch(asset.uri)).arrayBuffer();
  if (bytes.byteLength > 10 * 1024 * 1024) throw new Error("file_too_large");
  const ext = asset.fileName?.split(".").pop() ?? "jpg";
  const path = `${providerId}/requirement-${requirementId}-${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from("provider-documents")
    .upload(path, bytes, { contentType: asset.mimeType || "image/jpeg", upsert: false });
  if (upErr) throw upErr;
  const { error } = await supabase
    .from("provider_requirement_fulfillments")
    .upsert(
      { provider_id: providerId, requirement_id: requirementId, evidence_storage_path: path },
      { onConflict: "provider_id,requirement_id" },
    );
  if (error) throw error;
}
