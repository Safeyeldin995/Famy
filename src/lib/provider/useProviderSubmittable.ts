import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SubmitCompletion } from "./changesHomeModel";

export function useProviderSubmittable(providerId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["provider-submittable", providerId],
    enabled,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const { data, error } = await supabase.rpc("provider_onboarding_submittable", {
        p_provider_id: providerId,
      });
      if (error) throw error;
      return data as SubmitCompletion;
    },
  });
}
