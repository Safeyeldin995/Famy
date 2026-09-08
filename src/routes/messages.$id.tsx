import { createFileRoute } from "@tanstack/react-router";
import { PhoneFrame } from "@/components/famio/ui";
import { CustomerPageHero } from "@/components/famio/CustomerPageHero";
import { QueryError } from "@/components/famio/QueryError";
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

  if (conv.isLoading || msgs.isLoading) {
    return (
      <PhoneFrame bg="bg-surface-2">
        <div className="grid flex-1 place-items-center px-6 text-sm text-muted-foreground">
          {t("common.loading", "Loading…")}
        </div>
      </PhoneFrame>
    );
  }

  if (conv.isError) {
    return (
      <PhoneFrame bg="bg-surface-2">
        <QueryError onRetry={() => conv.refetch()} />
      </PhoneFrame>
    );
  }

  if (msgs.isError) {
    return (
      <PhoneFrame bg="bg-surface-2">
        <QueryError onRetry={() => msgs.refetch()} />
      </PhoneFrame>
    );
  }

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
    <PhoneFrame bg="bg-background">
      <CustomerPageHero
        title={otherName}
        subtitle={t("messages.chatNotice")}
        backTo="/messages"
        right={
          otherAvatar ? (
            <img
              src={otherAvatar}
              alt=""
              className="h-11 w-11 rounded-full border-2 border-white/30 object-cover"
            />
          ) : (
            <div className="grid h-11 w-11 place-items-center rounded-full border border-white/25 bg-white/15 text-sm font-black text-white">
              {otherName.slice(0, 1).toUpperCase()}
            </div>
          )
        }
      />

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto bg-surface-2 px-3 py-4">
        <div className="my-3 flex justify-center">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-mint/30 px-3 py-1.5 text-[11px] font-medium text-foreground">
            <ShieldCheck className="h-3 w-3 text-success" />
            {t("messages.stayInApp")}
          </div>
        </div>
        {(msgs.data ?? []).map((m: any) => {
          const mine = m.sender_id === meId;
          return (
            <div
              key={m.id}
              className={`flex items-end gap-2 ${mine ? "justify-end" : "justify-start"}`}
            >
              {!mine && otherAvatar && (
                <img
                  src={otherAvatar}
                  alt=""
                  className="h-7 w-7 shrink-0 rounded-full object-cover"
                />
              )}
              <div
                className={`max-w-[78%] rounded-[1.25rem] px-4 py-2.5 text-sm leading-snug ${
                  mine
                    ? "bg-brand text-brand-foreground rounded-br-md"
                    : "bg-surface text-foreground border border-border/50 shadow-xs rounded-bl-md"
                }`}
              >
                <div className="whitespace-pre-wrap break-words">{m.body}</div>
                <div
                  className={`mt-1 text-[10px] ${mine ? "text-white/70" : "text-muted-foreground"}`}
                >
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
      <div className="safe-bottom border-t border-border/50 bg-surface px-3 pt-2.5">
        <div className="flex items-end gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1 rounded-full bg-surface-2 px-4">
            <input
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (warning) setWarning(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder={t("messages.placeholder")}
              className="h-12 min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground"
            />
          </div>
          <button
            onClick={handleSend}
            aria-label={t("messages.send")}
            disabled={!text.trim() || send.isPending}
            className="focus-ring grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand text-brand-foreground shadow-[0_8px_20px_-10px_var(--brand)] transition-transform active:scale-95 disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </PhoneFrame>
  );
}
