import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ProviderShell } from "@/components/famio/ProviderShell";
import { TopBar, Card, EmptyState } from "@/components/famio/ui";
import { useNotifications, useMarkNotificationRead, useMarkAllNotificationsRead } from "@/lib/db/queries";
import { useLang } from "@/components/famio/LanguageToggle";
import { Bell } from "lucide-react";

export const Route = createFileRoute("/pro/notifications")({ component: NotificationsPage });

function notifText(n: any, lang: string) {
  if (lang === "ar") return { title: n.title_ar || n.title_en || n.title, body: n.body_ar || n.body_en || n.body };
  return { title: n.title_en || n.title, body: n.body_en || n.body };
}

function NotificationsPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const nav = useNavigate();
  const q = useNotifications();
  const mark = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const items = q.data ?? [];
  const hasUnread = items.some((n: any) => !n.read_at);

  const openNotification = (n: any) => {
    if (!n.read_at) mark.mutate(n.id);
    if (n.deep_link) nav({ to: n.deep_link as any });
  };

  return (
    <ProviderShell hideNav>
      <TopBar
        back={{ to: "/pro" }}
        title={t("notifs.title")}
        right={
          hasUnread ? (
            <button
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
              className="text-xs font-bold text-navy disabled:opacity-50"
            >
              {t("notifs.markAllRead")}
            </button>
          ) : undefined
        }
      />
      <div className="px-5 pb-6">
        {q.isLoading ? (
          <div className="h-20 animate-pulse rounded-3xl bg-surface" />
        ) : q.isError ? (
          <EmptyState emoji="⚠️" title={t("common.errorTitle", "Something went wrong")} body={t("common.tryAgain", "Please try again.")} />
        ) : items.length === 0 ? (
          <EmptyState emoji="🔔" title={t("notifs.empty")} body={t("notifs.emptyBody")} />
        ) : (
          <div className="space-y-2">
            {items.map((n: any) => {
              const { title, body } = notifText(n, lang);
              return (
                <Card key={n.id} className={`p-4 ${n.read_at ? "opacity-70" : ""}`}>
                  <button onClick={() => openNotification(n)} className="block w-full text-left">
                    <div className="flex items-start gap-3">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-navy/10 text-navy"><Bell className="h-5 w-5" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="truncate text-sm font-bold">{title}</div>
                          {!n.read_at && <span className="h-2 w-2 rounded-full bg-coral" />}
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{body}</div>
                        <div className="mt-1 text-[10px] text-muted-foreground">{new Date(n.created_at).toLocaleString()}</div>
                      </div>
                    </div>
                  </button>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </ProviderShell>
  );
}
