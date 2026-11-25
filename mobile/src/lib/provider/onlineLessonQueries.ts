import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { ProviderOfferingMode } from "@shared/online/offeringMode";

export function useUpdateOfferingMode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (mode: ProviderOfferingMode) => {
      const { error } = await supabase.rpc("provider_update_offering_mode", {
        p_offering_mode: mode,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["my-provider"] });
    },
  });
}

export function useSetOnlineServicePrice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      providerId,
      serviceId,
      price,
    }: {
      providerId: string;
      serviceId: string;
      price: number;
    }) => {
      const { error } = await supabase.rpc("provider_set_online_service_price", {
        p_service_id: serviceId,
        p_price: price,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ["my-provider-services", vars.providerId] });
    },
  });
}

export function useRequestOnlinePriceChange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      providerId,
      serviceId,
      price,
    }: {
      providerId: string;
      serviceId: string;
      price: number;
    }) => {
      const { error } = await supabase.rpc("provider_request_online_price_change", {
        p_service_id: serviceId,
        p_price: price,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ["my-provider-services", vars.providerId] });
    },
  });
}

export function useCancelOnlinePriceChange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ providerId, serviceId }: { providerId: string; serviceId: string }) => {
      const { error } = await supabase.rpc("provider_cancel_online_price_change", {
        p_service_id: serviceId,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ["my-provider-services", vars.providerId] });
    },
  });
}

export function useUpdateTeachingOnlinePrice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      providerId,
      capabilityId,
      price,
    }: {
      providerId: string;
      capabilityId: string;
      price: number | null;
    }) => {
      const { error } = await supabase.rpc("provider_update_teaching_online_session_price", {
        p_capability_id: capabilityId,
        p_price: price,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ["my-teaching-capabilities", vars.providerId] });
    },
  });
}