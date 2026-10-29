import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSetProviderServiceStatus } from "@/lib/db/admin-queries";

export function useAdminNewServiceRequests() {
  return useQuery({
    queryKey: ["admin", "new-service-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_services")
        .select(
          "id, provider_id, service_id, created_at, status, provider:providers!inner(id, onboarding_status, profile:profiles(full_name)), service:services(name_en, name_ar)",
        )
        .eq("status", "pending")
        .eq("provider.onboarding_status", "APPROVED")
        .order("created_at", { ascending: true })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAdminProviderServiceRequest(providerServiceId: string | undefined) {
  return useQuery({
    enabled: !!providerServiceId,
    queryKey: ["admin", "provider-service-request", providerServiceId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_provider_service_request", {
        p_provider_service_id: providerServiceId!,
      });
      if (error) throw error;
      return data as Record<string, unknown>;
    },
  });
}

export function useReviewProviderServiceRequest(providerServiceId: string) {
  const qc = useQueryClient();
  const review = useSetProviderServiceStatus();
  return useMutation({
    mutationFn: async ({
      status,
      reason,
    }: {
      status: "approved" | "rejected";
      reason?: string;
    }) => {
      await review.mutateAsync({ providerServiceId, status, reason });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "provider-service-request", providerServiceId] });
      void qc.invalidateQueries({ queryKey: ["admin", "new-service-requests"] });
      void qc.invalidateQueries({ queryKey: ["admin", "work-queue-counts"] });
    },
  });
}
