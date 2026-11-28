// «الطلبة بيدوروا على إيه»: approved tutors read aggregated open demand.
// Mirrors src/lib/db/tutor-demand-queries.ts (migration 20261128153000).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../supabase";
import type { TutorDemandInsightRow } from "@shared/provider/tutorDemandInsights";

// The generated Database types don't include this RPC yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (name: string, args?: Record<string, unknown>) => (supabase.rpc as any)(name, args);

export function useTutorDemandInsights(enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: ["tutor-demand-insights"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await rpc("provider_tutor_demand_insights");
      if (error) throw error;
      return (data ?? []) as TutorDemandInsightRow[];
    },
  });
}
