import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";

export const UGC_REASONS = ["harassment", "spam", "inappropriate", "other"] as const;
export type UgcReason = (typeof UGC_REASONS)[number];

export type UgcSubjectType = "chat_message" | "chat_thread" | "review";

export { ugcReportErrorKey } from "./ugcReportErrors";

type ReportInput = {
  subjectType: UgcSubjectType;
  reason: UgcReason;
  detail?: string;
  messageId?: string;
  conversationId?: string;
  reviewId?: string;
};

export function useReportUgc() {
  return useMutation({
    mutationFn: async (input: ReportInput) => {
      const { data, error } = await supabase.rpc("report_ugc", {
        p_subject_type: input.subjectType,
        p_reason: input.reason,
        p_detail: input.detail ?? null,
        p_message_id: input.messageId ?? null,
        p_conversation_id: input.conversationId ?? null,
        p_review_id: input.reviewId ?? null,
      });
      if (error) throw error;
      return data as string;
    },
  });
}

export function useBlockChatConversation() {
  return useMutation({
    mutationFn: async (conversationId: string) => {
      const { data, error } = await supabase.rpc("block_chat_conversation", {
        p_conversation_id: conversationId,
      });
      if (error) throw error;
      return data as string;
    },
  });
}

export type MyChatBlockRow = {
  id: string;
  conversation_id: string | null;
  other_user_id: string;
  other_full_name: string;
  created_at: string;
};

export function useMyChatBlocks() {
  return useQuery({
    queryKey: ["chat-blocks", "mine"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_my_chat_blocks");
      if (error) throw error;
      return (data ?? []) as MyChatBlockRow[];
    },
  });
}

export function useUnblockChatConversation() {
  return useMutation({
    mutationFn: async (conversationId: string) => {
      const { data, error } = await supabase.rpc("unblock_chat_conversation", {
        p_conversation_id: conversationId,
      });
      if (error) throw error;
      return data as string;
    },
  });
}