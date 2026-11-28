import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { createTrustStatsLoader } from "@/lib/provider/trustBatch";
import type { PublicReviewRow } from "@/lib/provider/trustBadges";

// The generated Database types don't include these RPCs yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (name: string, args?: Record<string, unknown>) => (supabase.rpc as any)(name, args);

const trustLoader = createTrustStatsLoader(async (ids) => {
  const { data, error } = await rpc("public_provider_trust_stats", { p_provider_ids: ids });
  if (error) throw error;
  return (data ?? []) as Record<string, unknown>[];
});

/** Public trust facts for one provider; cards rendered together share one request. */
export function useProviderTrustStats(providerId: string | undefined) {
  return useQuery({
    enabled: Boolean(providerId),
    queryKey: ["provider-trust-stats", providerId],
    queryFn: () => trustLoader.load(providerId!),
    staleTime: 5 * 60_000,
  });
}

export const PUBLIC_REVIEWS_PAGE = 5;

/** Visible reviews with the lesson's subject, grade and system; works for guests (#565). */
export function usePublicProviderReviews(providerId: string | undefined) {
  return useInfiniteQuery({
    enabled: Boolean(providerId),
    queryKey: ["public-provider-reviews", providerId],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await rpc("public_provider_reviews", {
        p_provider_id: providerId,
        p_limit: PUBLIC_REVIEWS_PAGE,
        p_offset: pageParam,
      });
      if (error) throw error;
      return (data ?? []) as PublicReviewRow[];
    },
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, page) => n + page.length, 0);
      const total = last[0]?.total_count ?? 0;
      return last.length === PUBLIC_REVIEWS_PAGE && loaded < total ? loaded : undefined;
    },
  });
}
