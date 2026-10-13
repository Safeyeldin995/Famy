import { formatTime } from "@/lib/format";
import { createFileRoute } from "@tanstack/react-router";
import { PhoneFrame, EmptyState } from "@/components/famio/ui";
import { CustomerPageHeader as CustomerPageHero } from "@/components/famio/CustomerPageHeader";
import { QueryError } from "@/components/famio/QueryError";
import { useEffect, useRef, useState } from "react";
import { ProfileAvatar } from "@/components/provider/ProfileAvatar";
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
import { isPreviewRoute, PREVIEW_USER_ID } from "@/lib/preview/constants";

export const Route = createFileRoute("/messages/$id")({ component: Chat });

function nowStr(iso: string) {
  return formatTime(new Date(iso));
}

function Chat() {
  const { id } = Route.useParams();
  return <ChatContent conversationId={id} />;
}

export function ChatContent({ conversationId }: { conversationId: string }) {
  const id = conversationId;
  const conv = useConversation(id);
  const msgs = useMessages(id);
  const send = useSendMessage(id);
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [warning, setWarning] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isPreviewRoute()) {
      setMeId(PREVIEW_USER_ID);
      return;
    }
    supabase.auth.getUser().then(({ data }) => setMeId(data.user?.id ?? null)).catch(() => setMeId(null));
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
        <div className="grid flex-1 place-items-center px-6 text-pro-14 text-muted-foreground">
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

  if (!conv.data) return <PhoneFrame bg="bg-white"><CustomerPageHero title={t("messages.title")} backTo="/messages" /><EmptyState icon="message" title={t("customerChat.unavailable")} body={t("bookingChat.unavailableBody")} /></PhoneFrame>;

  const handleSend = () => {
    const body = text.trim();
    if (!body || send.isPending) return;
    if (containsContactInfo(body)) {
      setWarning(t("bookingChat.contactBlocked", CONTACT_BLOCKED_MESSAGE));
      return;
    }
    send.mutate(body, {
      onSuccess: () => {
        setText("");
        setWarning(null);
      },
      onError: (e: any) => {
        if (e?.message === "contact_masked") setWarning(t("bookingChat.contactBlocked", CONTACT_BLOCKED_MESSAGE));
        else setWarning(sendFailedMsg);
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
          <ProfileAvatar
            src={otherAvatar}
            name={otherName}
            className="h-11 w-11 rounded-full border-2 border-white/30 text-pro-14"
          />
        }
      />

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto bg-surface-2 px-3 py-4">
        <div className="my-3 flex justify-center">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-mint/30 px-3 py-1.5 text-pro-12 font-medium text-foreground">
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
              {!mine && (
                <ProfileAvatar src={otherAvatar} name={otherName} className="h-7 w-7 rounded-full text-pro-12" />
              )}
              <div
                className={`max-w-[78%] rounded-[1.25rem] px-4 py-2.5 text-pro-14 leading-snug ${
                  mine
                    ? "bg-brand text-brand-foreground rounded-ee-md"
                    : "bg-surface text-foreground border border-border/50 shadow-xs rounded-es-md"
                }`}
              >
                <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{m.body}</div>
                <div
                  className={`mt-1 text-pro-12 ${mine ? "text-white/70" : "text-muted-foreground"}`}
                >
                  {nowStr(m.created_at)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {warning && (
        <div className="border-t border-amber-500/30 bg-amber-50 px-4 py-2 text-pro-12 font-medium text-amber-900">
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
              className="h-12 min-w-0 flex-1 bg-transparent text-pro-14 font-medium outline-none placeholder:text-muted-foreground"
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
