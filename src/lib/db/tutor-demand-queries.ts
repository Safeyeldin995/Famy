/**
 * «الطلبة بيدوروا على إيه»: approved tutors read aggregated open demand
 * (migration 20261128153000_tutor_demand_insights.sql).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TutorDemandInsightRow } from "@/lib/provider/tutorDemandInsights";

// The generated Database types don't include this RPC yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (name: string, args?: Record<string, unknown>) => (supabase.rpc as any)(name, args);

export const TUTOR_DEMAND_QUERY_KEY = ["tutor-demand-insights"] as const;

export function useTutorDemandInsights(enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: TUTOR_DEMAND_QUERY_KEY,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await rpc("provider_tutor_demand_insights");
      if (error) throw error;
      return (data ?? []) as TutorDemandInsightRow[];
    },
  });
}
