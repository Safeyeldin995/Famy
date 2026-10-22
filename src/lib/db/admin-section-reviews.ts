import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const ADMIN_REVIEW_SECTIONS = [
  "identity_documents",
  "personal_details",
  "references",
  "services_prices",
  "babysitting_ages",
  "teaching_groups",
  "hours_zones",
] as const;

export type AdminReviewSection = (typeof ADMIN_REVIEW_SECTIONS)[number];
export type AdminSectionReviewRow = {
  section: AdminReviewSection;
  decision: "approved" | "request_changes" | "rejected" | "rejected_optional";
  reason: string | null;
  reviewed_at: string;
};

export function useAdminSectionReviews(providerId: string) {
  return useQuery({
    queryKey: ["admin", "section-reviews", providerId],
    enabled: !!providerId,
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("provider_admin_section_reviews")
        .select("section,decision,reason,reviewed_at")
        .eq("provider_id", providerId);
      if (error) throw error;
      return (data ?? []) as AdminSectionReviewRow[];
    },
  });
}

export function useAdminReviewSection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      providerId: string;
      section: AdminReviewSection;
      decision: AdminSectionReviewRow["decision"] | "clear";
      reason?: string;
    }) => {
      const { error } = await (supabase.rpc as any)("admin_review_provider_section", {
        p_provider_id: input.providerId,
        p_section: input.section,
        p_decision: input.decision,
        p_reason: input.reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_data, input) => {
      void qc.invalidateQueries({ queryKey: ["admin", "section-reviews", input.providerId] });
      void qc.invalidateQueries({ queryKey: ["admin", "provider", input.providerId] });
      void qc.invalidateQueries({
        queryKey: ["admin", "provider-onboarding-review", input.providerId],
      });
      void qc.invalidateQueries({ queryKey: ["admin", "work-queue"] });
    },
  });
}
