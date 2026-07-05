import { createFileRoute, Link } from "@tanstack/react-router";
import { PhoneFrame } from "@/components/famio/ui";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Send, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  useConversation,
  useMessages,
  useSendMessage,
  CONTACT_BLOCKED_MESSAGE,
  containsContactInfo,
} from "@/lib/db/messaging";

export const Route = createFileRoute("/messages/$id")({ component: Chat });

function nowStr(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function Chat() {
  const { id } = Route.useParams();
  const conv = useConversation(id);
  const msgs = useMessages(id);
  const send = useSendMessage(id);
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [warning, setWarning] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMeId(data.user?.id ?? null));
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs.data]);

  const other = (conv.data as any)?.other;
  const otherName = other?.full_name || t("profile.famioUser");
  const otherAvatar = other?.avatar_url;
  const sendFailedMsg = t("messages.sendFailed");

  const handleSend = () => {
    const t = text.trim();
    if (!t) return;
    if (containsContactInfo(t)) {
      setWarning(CONTACT_BLOCKED_MESSAGE);
      return;
    }
    send.mutate(t, {
      onSuccess: () => {
        setText("");
        setWarning(null);
      },
      onError: (e: any) => {
        if (e?.message === "contact_masked") setWarning(CONTACT_BLOCKED_MESSAGE);
        else setWarning(e?.message || sendFailedMsg);
      },
    });
  };

  return (
    <PhoneFrame bg="bg-surface-2">
      {/* Header */}
      <div className="safe-top sticky top-0 z-30 border-b border-border/60 bg-surface/95 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-3">
          <Link
            to="/messages"
            aria-label={t("messages.back")}
            className="focus-ring grid h-10 w-10 place-items-center rounded-full bg-surface-2 active:scale-95 transition-transform"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg>
          </Link>
          <div className="relative">
            {otherAvatar ? (
              <img src={otherAvatar} alt="" className="h-10 w-10 rounded-2xl object-cover" />
            ) : (
              <div className="grid h-10 w-10 place-items-center rounded-2xl bg-navy text-sm font-extrabold text-navy-foreground">
                {otherName.slice(0, 1).toUpperCase()}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <div className="truncate text-sm font-extrabold">{otherName}</div>
              <ShieldCheck className="h-3.5 w-3.5 text-success" aria-label={t("messages.verified")} />
            </div>
            <div className="text-[11px] text-muted-foreground">{t("messages.chatNotice")}</div>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-4">
        <div className="my-3 flex justify-center">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-mint/30 px-3 py-1.5 text-[11px] font-medium text-foreground">
            <ShieldCheck className="h-3 w-3 text-success" />
            {t("messages.stayInApp")}
          </div>
        </div>
        {(msgs.data ?? []).map((m: any) => {
          const mine = m.sender_id === meId;
          return (
            <div key={m.id} className={`flex items-end gap-2 ${mine ? "justify-end" : "justify-start"}`}>
              {!mine && otherAvatar && (
                <img src={otherAvatar} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
              )}
              <div className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm leading-snug ${
                mine ? "bg-navy text-navy-foreground rounded-br-md" : "bg-surface text-foreground shadow-soft rounded-bl-md"
              }`}>
                <div className="whitespace-pre-wrap break-words">{m.body}</div>
                <div className={`mt-1 text-[10px] ${mine ? "text-white/70" : "text-muted-foreground"}`}>
                  {nowStr(m.created_at)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {warning && (
        <div className="border-t border-amber-500/30 bg-amber-50 px-4 py-2 text-[11px] font-medium text-amber-900">
          {warning}
        </div>
      )}

      {/* Composer */}
      <div className="safe-bottom border-t border-border/60 bg-surface px-3 pt-2.5">
        <div className="flex items-end gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1 rounded-3xl bg-surface-2 px-3">
            <input
              value={text}
              onChange={(e) => { setText(e.target.value); if (warning) setWarning(null); }}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder={t("messages.placeholder")}
              className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <button
            onClick={handleSend}
            aria-label={t("messages.send")}
            disabled={!text.trim() || send.isPending}
            className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-full bg-navy text-navy-foreground shadow-soft transition-transform active:scale-95 disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </PhoneFrame>
  );
}
