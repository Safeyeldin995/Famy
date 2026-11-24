import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  expandAdminPriceChangeQueue,
  type AdminPriceChangeKind,
} from "@/lib/admin/priceChangeQueue";

export function useAdminPriceChangeRequests() {
  return useQuery({
    queryKey: ["admin", "price-change-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_services")
        .select(
          "id, provider_id, service_id, price_override, pending_price_override, online_price_override, pending_online_price_override, price_change_requested_at, online_price_change_requested_at, provider:providers(profile:profiles(full_name)), service:services(name_en, name_ar)",
        )
        .eq("status", "approved")
        .or(
          "pending_price_override.not.is.null,pending_online_price_override.not.is.null",
        )
        .order("price_change_requested_at", { ascending: true })
        .limit(100);
      if (error) throw error;
      return expandAdminPriceChangeQueue(data ?? []);
    },
  });
}

export function useReviewProviderPriceChange(
  providerServiceId: string,
  kind: AdminPriceChangeKind,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      decision,
      reason,
    }: {
      decision: "approved" | "rejected";
      reason?: string;
    }) => {
      if (kind === "online") {
        const { error } = await supabase.rpc("admin_review_online_price_change", {
          p_provider_service_id: providerServiceId,
          p_decision: decision,
          p_reason: reason ?? null,
        });
        if (error) throw error;
        return;
      }
      const { error } = await supabase.rpc("admin_review_price_change", {
        p_provider_service_id: providerServiceId,
        p_decision: decision,
        p_reason: reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "price-change", providerServiceId] });
      void qc.invalidateQueries({ queryKey: ["admin", "price-change-requests"] });
      void qc.invalidateQueries({ queryKey: ["admin", "work-queue"] });
    },
  });
}