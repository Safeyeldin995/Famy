import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
export function useTeachingReviewMessages(providerId: string) {
  return useQuery({
    queryKey: ["provider-teaching-review-messages", providerId],
    queryFn: async () => {
      // Read only messages already made public to this provider, never admin review_note.
      const { data, error } = await supabase
        .from("notifications")
        .select("body, body_ar, body_en, payload")
        .eq("type", "teaching_capability_rejected")
        .contains("payload", { provider_id: providerId })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}
export function teachingReviewMessages(
  rows: {
    body: string | null;
    body_ar?: string | null;
    body_en?: string | null;
    payload: unknown;
  }[],
  ar: boolean,
) {
  const messages: Record<string, string> = {};
  for (const row of rows) {
    const payload = row.payload as { capability_ids?: string[]; capability_id?: string } | null;
    for (const id of payload?.capability_ids ??
      (payload?.capability_id ? [payload.capability_id] : [])) {
      const body = (ar ? row.body_ar : row.body_en)?.trim() || row.body;
      if (!messages[id] && body) messages[id] = body;
    }
  }
  return messages;
}
