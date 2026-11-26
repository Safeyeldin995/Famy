import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { parseProviderPerformanceStats } from "@shared/provider/performanceStats";

export function useProviderPerformanceStats(days = 30) {
  return useQuery({
    queryKey: ["provider-performance", days],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as (name: string, args: object) => ReturnType<typeof supabase.rpc>)(
        "provider_performance_stats",
        { p_days: days },
      );
      if (error) throw error;
      return parseProviderPerformanceStats(data);
    },
  });
}

export function useProviderWarnings(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ["provider-warnings", providerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_warnings")
        .select("id, reason, created_at")
        .eq("provider_id", providerId!)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export type ProviderReviewRow = {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  customer?: { full_name?: string | null } | null;
};

export function useProviderMyReviews(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ["provider-my-reviews", providerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reviews")
        .select("id, rating, comment, created_at, customer:profiles!reviews_customer_id_fkey(full_name)")
        .eq("provider_id", providerId!)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as ProviderReviewRow[];
    },
  });
}

export function useProviderReviewSlaHours() {
  return useQuery({
    queryKey: ["provider-review-sla-hours"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as (name: string) => ReturnType<typeof supabase.rpc>)(
        "provider_review_sla_hours",
      );
      if (error) throw error;
      const hours = Number(data);
      return Number.isFinite(hours) && hours > 0 ? hours : 24;
    },
    staleTime: 300_000,
  });
}