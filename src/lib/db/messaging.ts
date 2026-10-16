/**
 * Messaging hooks — real Supabase-backed conversations & messages.
 * RLS limits everything to the two booking parties (+ admin).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchBookingParties, type BookingParty } from '@/lib/db/booking-parties';

export const CONTACT_BLOCKED_MESSAGE =
  "For your safety and to keep Famy's protections active on this booking, please keep communication inside the Famy app.";

/** Client-side mirror of the DB trigger. Returns true if the body contains
 *  phone-number-shaped digits or an email address. */
export function containsContactInfo(body: string): boolean {
  const digits = body.replace(/[^0-9]/g, '');
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
  /** Set for system messages; render via bookingChat.system.<key> so it follows the app language. */
  last_system_key?: string | null;
};

export function useConversations() {
  return useQuery({
    queryKey: ['conversations'],
    queryFn: async (): Promise<ConversationListItem[]> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data: convs, error } = await supabase
        .from('conversations')
        .select('id, booking_id, customer_id, provider_user_id, updated_at')
        // Admins can read every conversation under RLS; the inbox must only
        // list chats this user is a party to.
        .or(`customer_id.eq.${user.id},provider_user_id.eq.${user.id}`)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      if (!convs?.length) return [];

      // The other party's name/avatar. `profiles` is self-only under RLS, so
      // this reads through booking_party_profiles. A failed lookup only loses
      // names; the inbox itself still loads.
      const pMap = await fetchBookingParties(convs.map((c) => c.booking_id)).catch(
        () => new Map<string, BookingParty>(),
      );

      const ids = convs.map((c) => c.id);
      const { data: lastMsgs } = await supabase
        .from('messages')
        .select('conversation_id, body, system_key, created_at')
        .in('conversation_id', ids)
        .order('created_at', { ascending: false });
      const lastMap = new Map<string, { body: string; system_key: string | null; created_at: string }>();
      for (const m of lastMsgs ?? []) {
        if (!lastMap.has(m.conversation_id)) {
          lastMap.set(m.conversation_id, { body: m.body, system_key: m.system_key, created_at: m.created_at });
        }
      }

      return convs.map((c) => {
        const party = pMap.get(c.booking_id);
        const last = lastMap.get(c.id);
        return {
          ...c,
          other_name: party?.other_name || '',
          other_avatar: party?.other_avatar_url ?? null,
          last_message: last?.body ?? null,
          last_system_key: last?.system_key ?? null,
          last_time: last?.created_at ?? null,
        };
      });
    },
  });
}

export function useConversationByBooking(bookingId: string | undefined, status?: string) {
  // The conversation is only readable once the booking leaves `pending`, so
  // the status is part of the key: accepting a request re-fetches it instead
  // of reusing the cached "no conversation yet" result.
  return useQuery({
    enabled: !!bookingId,
    queryKey: ['conversation-by-booking', bookingId, status === 'pending' ? 'pending' : 'open'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('conversations')
        .select('id')
        .eq('booking_id', bookingId!)
        .maybeSingle();
      if (error) throw error;
      return data?.id ?? null;
    },
  });
}

export function useConversation(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: ['conversation', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('conversations')
        .select('id, booking_id, customer_id, provider_user_id')
        .eq('id', id!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const party = (await fetchBookingParties([data.booking_id]).catch(() => new Map<string, BookingParty>())).get(data.booking_id);
      const other = party
        ? { id: party.other_user_id, full_name: party.other_name, avatar_url: party.other_avatar_url }
        : null;
      return { ...data, other };
    },
  });
}

export type BookingMessage = {
  id: string;
  sender_id: string | null;
  sender_role: 'customer' | 'provider' | 'admin' | 'support' | 'system';
  message_type: 'text' | 'system';
  system_key: string | null;
  body: string;
  created_at: string;
};

export function useMessages(conversationId: string | undefined) {
  return useQuery({
    enabled: !!conversationId,
    queryKey: ['messages', conversationId],
    queryFn: async (): Promise<BookingMessage[]> => {
      const { data, error } = await supabase
        .from('messages')
        .select('id, sender_id, sender_role, message_type, system_key, body, created_at')
        .eq('conversation_id', conversationId!)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as BookingMessage[];
    },
    refetchInterval: 5000,
  });
}

export function useSendMessage(conversationId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: string) => {
      if (!conversationId) throw new Error('no_conversation');
      const trimmed = body.trim();
      if (!trimmed) throw new Error('empty');
      if (containsContactInfo(trimmed)) throw new Error('contact_masked');
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('auth required');
      // sender_id/sender_role/message_type/created_at are all re-derived and
      // overwritten server-side (trg_messages_validate) — sent here only to
      // satisfy the required-column insert shape.
      const { data, error } = await supabase
        .from('messages')
        .insert({ conversation_id: conversationId, sender_id: user.id, sender_role: 'customer', body: trimmed })
        .select()
        .single();
      if (error) {
        // server-side trigger also blocks; surface as contact_masked
        if (error.message?.includes('contact_masked')) throw new Error('contact_masked');
        throw error;
      }
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages', conversationId] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}

/** Which lifecycle phase a booking's chat is in — mirrors the DB-enforced
 *  rules in trg_messages_validate exactly, so the UI never shows an
 *  affordance the server would reject. */
export type ChatPhase = 'unavailable' | 'writable' | 'readonly' | 'disputed';

const WRITABLE_STATUSES = new Set([
  'confirmed', 'on_the_way', 'arrived', 'arrival_confirmed', 'in_progress', 'completion_requested',
]);
const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'no_show']);

export function chatPhaseForStatus(status: string | undefined): ChatPhase {
  if (!status) return 'unavailable';
  if (status === 'disputed') return 'disputed';
  if (WRITABLE_STATUSES.has(status)) return 'writable';
  if (TERMINAL_STATUSES.has(status)) return 'readonly';
  return 'unavailable'; // pending
}

/** Mark the caller's own participation in a booking's chat as read up to
 *  now. Self-only by RLS (booking_message_reads_self); never reveals or
 *  depends on the other party's read state. */
export function useMarkBookingMessagesRead() {
  return useMutation({
    mutationFn: async (bookingId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase
        .from('booking_message_reads')
        .upsert({ booking_id: bookingId, user_id: user.id, last_read_at: new Date().toISOString() }, { onConflict: 'booking_id,user_id' });
      if (error) throw error;
    },
  });
}

type ChatViewerSession = {
  session: { user: { id: string } } | null;
};

/** Local session is sufficient to label "mine" vs "theirs" in booking chat UI. */
export async function resolveChatViewerUserId(
  readSession: () => Promise<{ data: ChatViewerSession; error: Error | null }>,
  isActive: () => boolean,
): Promise<string | null | undefined> {
  try {
    const { data, error } = await readSession();
    if (!isActive()) return undefined;
    if (error) throw error;
    return data.session?.user?.id ?? null;
  } catch (error) {
    if (!isActive()) return undefined;
    throw error;
  }
}
