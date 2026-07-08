/**
 * Messaging hooks — real Supabase-backed conversations & messages.
 * RLS limits everything to the two booking parties (+ admin).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

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
        .order('updated_at', { ascending: false });
      if (error) throw error;
      if (!convs?.length) return [];

      // Fetch the "other party" profile + last message for each conv.
      const otherIds = convs.map((c) => (c.customer_id === user.id ? c.provider_user_id : c.customer_id));
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url')
        .in('id', otherIds);
      const pMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));

      const ids = convs.map((c) => c.id);
      const { data: lastMsgs } = await supabase
        .from('messages')
        .select('conversation_id, body, created_at')
        .in('conversation_id', ids)
        .order('created_at', { ascending: false });
      const lastMap = new Map<string, { body: string; created_at: string }>();
      for (const m of lastMsgs ?? []) {
        if (!lastMap.has(m.conversation_id)) lastMap.set(m.conversation_id, { body: m.body, created_at: m.created_at });
      }

      return convs.map((c) => {
        const otherId = c.customer_id === user.id ? c.provider_user_id : c.customer_id;
        const prof: any = pMap.get(otherId);
        const last = lastMap.get(c.id);
        return {
          ...c,
          other_name: prof?.full_name || 'Famy user',
          other_avatar: prof?.avatar_url ?? null,
          last_message: last?.body ?? null,
          last_time: last?.created_at ?? null,
        };
      });
    },
  });
}

export function useConversationByBooking(bookingId: string | undefined) {
  return useQuery({
    enabled: !!bookingId,
    queryKey: ['conversation-by-booking', bookingId],
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
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('conversations')
        .select('id, booking_id, customer_id, provider_user_id')
        .eq('id', id!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const otherId = data.customer_id === user?.id ? data.provider_user_id : data.customer_id;
      const { data: prof } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url')
        .eq('id', otherId)
        .maybeSingle();
      return { ...data, other: prof };
    },
  });
}

export function useMessages(conversationId: string | undefined) {
  return useQuery({
    enabled: !!conversationId,
    queryKey: ['messages', conversationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('id, sender_id, body, created_at')
        .eq('conversation_id', conversationId!)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data ?? [];
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
      const { data, error } = await supabase
        .from('messages')
        .insert({ conversation_id: conversationId, sender_id: user.id, body: trimmed })
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
