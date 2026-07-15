import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Send, ShieldCheck, Lock, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/famio/ui";
import {
  useConversationByBooking,
  useMessages,
  useSendMessage,
  useMarkBookingMessagesRead,
  chatPhaseForStatus,
  CONTACT_BLOCKED_MESSAGE,
  containsContactInfo,
  type BookingMessage,
} from "@/lib/db/messaging";

type Viewer = "customer" | "provider" | "admin";

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function actorLabel(t: ReturnType<typeof useTranslation>["t"], viewer: Viewer, role: BookingMessage["sender_role"]) {
  if (role === "system") return t("bookingChat.actor.system", "Famy");
  if (role === viewer) return t("bookingChat.actor.you", "You");
  if (role === "customer") return t("bookingChat.actor.customer", "Customer");
  if (role === "provider") return t("bookingChat.actor.provider", "Provider");
  return t("bookingChat.actor.support", "Famy Support");
}

/**
 * Booking-scoped chat, embedded directly in customer/provider/admin booking
 * details. One instance per booking status phase — the phase itself (and
 * therefore whether a composer renders at all) is derived the same way the
 * database derives it (chatPhaseForStatus), so the UI never offers an
 * action the server would reject; the server (trg_messages_validate) is
 * still the actual authority.
 */
export function BookingChatPanel({ bookingId, status, viewer }: { bookingId: string; status: string | undefined; viewer: Viewer }) {
  const { t } = useTranslation();
  const convQ = useConversationByBooking(bookingId);
  const conversationId = convQ.data ?? undefined;
  const msgsQ = useMessages(conversationId);
  const send = useSendMessage(conversationId);
  const markRead = useMarkBookingMessagesRead();
  const [text, setText] = useState("");
  const [warning, setWarning] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const phase = chatPhaseForStatus(status);
  const canSend = viewer === "admin" ? phase === "disputed" : phase === "writable";

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMeId(data.user?.id ?? null));
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgsQ.data]);

  useEffect(() => {
    if (bookingId && (msgsQ.data?.length ?? 0) > 0) markRead.mutate(bookingId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId, msgsQ.data?.length]);

  if (phase === "unavailable") {
    if (viewer === "admin") return null;
    return (
      <Card className="mt-4 p-5 text-center">
        <Lock className="mx-auto h-5 w-5 text-muted-foreground" />
        <p className="mt-2 text-sm font-semibold text-muted-foreground">{t("bookingChat.unavailableTitle", "Chat becomes available after confirmation")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("bookingChat.unavailableBody", "Once your provider confirms this booking, you'll be able to message each other here.")}</p>
      </Card>
    );
  }

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) {
      setWarning(t("bookingChat.validationEmpty", "Message can't be empty."));
      return;
    }
    if (containsContactInfo(trimmed)) {
      setWarning(CONTACT_BLOCKED_MESSAGE);
      return;
    }
    send.mutate(trimmed, {
      onSuccess: () => { setText(""); setWarning(null); },
      onError: (e: any) => {
        if (e?.message === "contact_masked") setWarning(CONTACT_BLOCKED_MESSAGE);
        else setWarning(e?.message || t("bookingChat.sendFailed", "Couldn't send. Please try again."));
      },
    });
  };

  const messages = msgsQ.data ?? [];

  return (
    <Card className="mt-4 flex flex-col p-0">
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
        <ShieldCheck className="h-4 w-4 text-success" />
        <span className="text-xs font-bold text-muted-foreground">{t("bookingChat.title", "Booking chat")}</span>
      </div>

      <div ref={scrollRef} className="max-h-80 min-h-[8rem] flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {msgsQ.isLoading ? (
          <div className="space-y-2">
            <div className="h-10 w-2/3 animate-pulse rounded-2xl bg-surface-2" />
            <div className="ms-auto h-10 w-2/3 animate-pulse rounded-2xl bg-surface-2" />
          </div>
        ) : msgsQ.isError ? (
          <div className="py-6 text-center">
            <p className="text-xs text-muted-foreground">{t("bookingChat.loadFailed", "Couldn't load messages.")}</p>
            <button onClick={() => msgsQ.refetch()} className="mt-2 text-xs font-bold text-navy">{t("bookingChat.retry", "Retry")}</button>
          </div>
        ) : messages.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-xs text-muted-foreground">{t("bookingChat.emptyTitle", "No messages yet")}</p>
          </div>
        ) : (
          messages.map((m) => {
            if (m.message_type === "system") {
              return (
                <div key={m.id} className="flex justify-center py-1">
                  <span className="rounded-full bg-surface-2 px-3 py-1 text-[11px] font-medium text-muted-foreground">
                    {t(`bookingChat.system.${m.system_key}`, m.body)}
                  </span>
                </div>
              );
            }
            const mine = m.sender_id === meId;
            return (
              <div key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
                <span className="mb-0.5 px-1 text-[10px] font-semibold text-muted-foreground">{actorLabel(t, viewer, m.sender_role)}</span>
                <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-snug ${
                  mine ? "bg-navy text-navy-foreground rounded-br-md" : "bg-surface-2 text-foreground rounded-bl-md"
                }`}>
                  <div className="whitespace-pre-wrap break-words">{m.body}</div>
                  <div className={`mt-1 text-[10px] ${mine ? "text-white/70" : "text-muted-foreground"}`}>{timeOf(m.created_at)}</div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {phase === "readonly" && (
        <div className="border-t border-border/60 px-4 py-3 text-center text-[11px] font-semibold text-muted-foreground">
          {t("bookingChat.closedBody", "This conversation is closed. You can still read the full history above.")}
        </div>
      )}

      {phase === "disputed" && !canSend && (
        <div className="flex items-start gap-2 border-t border-amber-500/30 bg-amber-50 px-4 py-3 text-[11px] font-medium text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t("bookingChat.disputedBody", "This booking is under review. Famy support can see your history and will follow up here.")}</span>
        </div>
      )}

      {canSend && (
        <div className="border-t border-border/60 p-3">
          {warning && <div className="mb-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-900">{warning}</div>}
          <div className="flex items-end gap-2">
            <input
              value={text}
              onChange={(e) => { setText(e.target.value); if (warning) setWarning(null); }}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder={t("bookingChat.placeholder", "Message…")}
              maxLength={2000}
              className="h-11 min-w-0 flex-1 rounded-2xl bg-surface-2 px-3.5 text-sm outline-none placeholder:text-muted-foreground"
            />
            <button
              onClick={handleSend}
              aria-label={t("bookingChat.send", "Send")}
              disabled={!text.trim() || send.isPending}
              className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-full bg-navy text-navy-foreground shadow-soft transition-transform active:scale-95 disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
