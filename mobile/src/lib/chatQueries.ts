import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { fetchBookingParties, type BookingParty } from "./queries";
import { useSession } from "./session";
import { conversationUnread } from "./chatPure";

export { conversationUnread } from "./chatPure";

export const CONTACT_BLOCKED_MESSAGE =
  "For your safety and to keep Famy's protections active on this booking, please keep communication inside the Famy app.";

export function containsContactInfo(body: string): boolean {
  const digits = body.replace(/[^0-9]/g, "");
  if (/[0-9]{7,}/.test(digits)) return true;
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(body)) return true;
  return false;
}

export type ConversationListItem = {
  id: string;
  booking_id: string;
  customer_id: string;
  provider_user_id: string;
  updated_at: string;
  other_name: string;
  other_avatar: string | null;
  last_message: string | null;
  last_time: string | null;
  last_system_key?: string | null;
  last_sender_id: string | null;
  unread: boolean;
};

export function useConversations() {
  const { session } = useSession();
  return useQuery({
    queryKey: ["conversations", session?.user.id ?? "anonymous"],
    enabled: !!session?.user,
    queryFn: async (): Promise<ConversationListItem[]> => {
      const user = session!.user;
      const { data: convs, error } = await supabase
        .from("conversations")
        .select("id, booking_id, customer_id, provider_user_id, updated_at")
        .or(`customer_id.eq.${user.id},provider_user_id.eq.${user.id}`)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      if (!convs?.length) return [];

      const pMap = await fetchBookingParties(convs.map((c) => c.booking_id)).catch(
        () => new Map<string, BookingParty>(),
      );

      const ids = convs.map((c) => c.id);
      const { data: lastMsgs } = await supabase
        .from("messages")
        .select("conversation_id, body, system_key, created_at, sender_id")
        .in("conversation_id", ids)
        .order("created_at", { ascending: false });
      const lastMap = new Map<
        string,
        { body: string; system_key: string | null; created_at: string; sender_id: string | null }
      >();
      for (const m of lastMsgs ?? []) {
        if (!lastMap.has(m.conversation_id)) {
          lastMap.set(m.conversation_id, {
            body: m.body,
            system_key: m.system_key,
            created_at: m.created_at,
            sender_id: m.sender_id,
          });
        }
      }

      const bookingIds = convs.map((c) => c.booking_id);
      const { data: reads } = await supabase
        .from("booking_message_reads")
        .select("booking_id, last_read_at")
        .eq("user_id", user.id)
        .in("booking_id", bookingIds);
      const readMap = new Map((reads ?? []).map((r) => [r.booking_id, r.last_read_at]));

      return convs.map((c) => {
        const party = pMap.get(c.booking_id);
        const last = lastMap.get(c.id);
        return {
          ...c,
          other_name: party?.other_name || "",
          other_avatar: party?.other_avatar_url ?? null,
          last_message: last?.body ?? null,
          last_system_key: last?.system_key ?? null,
          last_time: last?.created_at ?? null,
          last_sender_id: last?.sender_id ?? null,
          unread: conversationUnread(last, user.id, readMap.get(c.booking_id)),
        };
      });
    },
  });
}

export function useConversationByBooking(bookingId: string | undefined, status?: string) {
  return useQuery({
    enabled: !!bookingId,
    queryKey: ["conversation-by-booking", bookingId, status === "pending" ? "pending" : "open"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("id")
        .eq("booking_id", bookingId!)
        .maybeSingle();
      if (error) throw error;
      return data?.id ?? null;
    },
  });
}

export function useConversation(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: ["conversation", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("id, booking_id, customer_id, provider_user_id")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const party = (
        await fetchBookingParties([data.booking_id]).catch(() => new Map<string, BookingParty>())
      ).get(data.booking_id);
      const other = party
        ? {
            id: party.other_user_id,
            full_name: party.other_name,
            avatar_url: party.other_avatar_url,
          }
        : null;
      return { ...data, other };
    },
  });
}

export type BookingMessage = {
  id: string;
  sender_id: string | null;
  sender_role: "customer" | "provider" | "admin" | "support" | "system";
  message_type: "text" | "system";
  system_key: string | null;
  body: string;
  created_at: string;
};

export function useMessages(conversationId: string | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    enabled: !!conversationId,
    queryKey: ["messages", conversationId],
    queryFn: async (): Promise<BookingMessage[]> => {
      const { data, error } = await supabase
        .from("messages")
        .select("id, sender_id, sender_role, message_type, system_key, body, created_at")
        .eq("conversation_id", conversationId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as BookingMessage[];
    },
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["messages", conversationId] });
          qc.invalidateQueries({ queryKey: ["conversations"] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, qc]);

  return query;
}

export function useSendMessage(conversationId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: string) => {
      if (!conversationId) throw new Error("no_conversation");
      const trimmed = body.trim();
      if (!trimmed) throw new Error("empty");
      if (containsContactInfo(trimmed)) throw new Error("contact_masked");
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("auth required");
      const { data, error } = await supabase
        .from("messages")
        .insert({
          conversation_id: conversationId,
          sender_id: user.id,
          sender_role: "customer",
          body: trimmed,
        })
        .select()
        .single();
      if (error) {
        if (error.message?.includes("contact_masked")) throw new Error("contact_masked");
        throw error;
      }
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["messages", conversationId] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}

export type ChatPhase = "unavailable" | "writable" | "readonly" | "disputed";

const WRITABLE_STATUSES = new Set([
  "confirmed",
  "on_the_way",
  "arrived",
  "arrival_confirmed",
  "in_progress",
  "completion_requested",
]);
const TERMINAL_STATUSES = new Set(["completed", "cancelled", "no_show"]);

export function chatPhaseForStatus(status: string | undefined): ChatPhase {
  if (!status) return "unavailable";
  if (status === "disputed") return "disputed";
  if (WRITABLE_STATUSES.has(status)) return "writable";
  if (TERMINAL_STATUSES.has(status)) return "readonly";
  return "unavailable";
}

export function useMarkBookingMessagesRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (bookingId: string) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase
        .from("booking_message_reads")
        .upsert(
          { booking_id: bookingId, user_id: user.id, last_read_at: new Date().toISOString() },
          { onConflict: "booking_id,user_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}
