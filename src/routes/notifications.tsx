import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PhoneFrame, TopBar, EmptyState } from "@/components/famio/ui";
import { useNotifications, useMarkNotificationRead, useMarkAllNotificationsRead } from "@/lib/db/queries";
import { useTranslation } from "react-i18next";
import { useLang } from "@/components/famio/LanguageToggle";
import { Bell, Sparkles } from "lucide-react";
import { formatDate } from "@/lib/utils";

export const Route = createFileRoute("/notifications")({ component: Notifications });

function notifText(n: any, lang: string) {
  if (lang === "ar") return { title: n.title_ar || n.title_en || n.title, body: n.body_ar || n.body_en || n.body };
  return { title: n.title_en || n.title, body: n.body_en || n.body };
}

function Notifications() {
  const { t } = useTranslation();
  const lang = useLang();
  const nav = useNavigate();
  const q = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const items = q.data ?? [];
  const hasUnread = items.some((n: any) => !n.read_at);

  const openNotification = (n: any) => {
    if (!n.read_at) markRead.mutate(n.id);
    if (n.deep_link) nav({ to: n.deep_link as any });
  };

  return (
    <PhoneFrame>
      <TopBar
        back={{ to: "/home" }}
        title={t("notifs.title")}
        right={
          hasUnread ? (
            <button
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
              className="text-xs font-bold text-navy disabled:opacity-50"
            >
              {t("notifs.markAllRead")}
            </button>
          ) : undefined
        }
      />
      <div className="px-5">
        {q.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 rounded-2xl bg-surface animate-pulse" />)}
          </div>
        ) : q.isError ? (
          <EmptyState emoji="⚠️" title={t("common.errorTitle", "Something went wrong")} body={t("common.tryAgain", "Please try again.")} />
        ) : items.length === 0 ? (
          <EmptyState emoji="🔔" title={t("notifs.empty")} />
        ) : (
          <ul className="space-y-2">
            {items.map((n: any) => {
              const unread = !n.read_at;
              const isOffer = n.category === "campaign";
              const { title, body } = notifText(n, lang);
              return (
                <li
                  key={n.id}
                  onClick={() => openNotification(n)}
                  className={`flex items-start gap-3 rounded-2xl p-4 cursor-pointer ${unread ? "bg-surface shadow-soft" : "bg-surface-2"}`}
                >
                  <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${isOffer ? "bg-coral/15 text-coral" : "bg-navy/10 text-navy"}`}>
                    {isOffer ? <Sparkles className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-bold">{title}</span>
                      {unread && <span className="h-2 w-2 shrink-0 rounded-full bg-coral" />}
                    </div>
                    {body && <p className="text-xs text-muted-foreground">{body}</p>}
                    <div className="mt-1 text-[10px] text-muted-foreground">{formatDate(new Date(n.created_at), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </PhoneFrame>
  );
}
