import { isPreviewRoute, PREVIEW_NOW_ISO } from "@/lib/preview/constants";
import { notificationRowNavigation } from "@/lib/provider/workScreenPresentation";
import { formatNotificationDate } from "@/lib/format";
import { createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ProviderShell } from "@/components/famio/ProviderShell";
import { PageHeader } from "@/components/famio/PageHeader";
import { EmptyState } from "@/components/famio/ui";
import { useMarkNotificationRead, useMarkAllNotificationsRead } from "@/lib/db/queries";
import { useProNotifications } from "@/lib/db/provider-queries";
import { useLang } from "@/components/famio/LanguageToggle";
import { Bell } from "lucide-react";
import { proPath } from "@/lib/preview/previewPath";

export const Route = createFileRoute("/pro/notifications")({ component: NotificationsPage });

function notifText(n: any, lang: string) {
  if (lang === "ar") return { title: n.title_ar || n.title_en || n.title, body: n.body_ar || n.body_en || n.body };
  return { title: n.title_en || n.title, body: n.body_en || n.body };
}

function NotificationsPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const nav = useNavigate();
  const preview = useRouterState({ select: (state) => isPreviewRoute(state.location.pathname) });
  const q = useProNotifications();
  const mark = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const items = q.data ?? [];
  const hasUnread = items.some((n: any) => !n.read_at);

  const openNotification = (n: any) => {
    const action = notificationRowNavigation(n, proPath);
    if (action.markReadId) mark.mutate(action.markReadId);
    if (action.to) nav({ to: action.to as any });
  };

  return (
    <ProviderShell hideNav>
      <PageHeader
        title={t("notifs.title")}
        backTo="/pro"
        right={
          hasUnread ? (
            <button
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
              className="min-h-11 px-2 py-2 text-pro-12 font-extrabold text-brand disabled:opacity-50"
            >
              {t("notifs.markAllRead")}
            </button>
          ) : undefined
        }
      />
      <div className="px-5 pb-10 pt-2">
        {q.isLoading ? (
          <div className="h-20 animate-pulse rounded-3xl bg-surface" />
        ) : q.isError ? (
          <EmptyState icon="alert" title={t("common.errorTitle", "Something went wrong")} body={t("common.tryAgain", "Please try again.")} />
        ) : items.length === 0 ? (
          <EmptyState icon="bell" title={t("notifs.empty")} body={t("notifs.emptyBody")} />
        ) : (
          <div className="divide-y divide-border/50 rounded-2xl bg-surface">
            {items.map((n: any) => {
              const { title, body } = notifText(n, lang);
              return (
                <button key={n.id} onClick={() => openNotification(n)} className={`focus-ring block min-h-11 w-full p-4 text-start ${n.read_at ? "opacity-70" : ""}`}>
                    <div className="flex items-start gap-3">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand"><Bell className="h-5 w-5" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="truncate text-sm font-bold">{title}</div>
                          {!n.read_at && <span className="h-2 w-2 rounded-full bg-coral" />}
                        </div>
                        <div className="mt-1 line-clamp-2 text-pro-13 text-muted-foreground">{body}</div>
                        <div className="mt-1 text-pro-12 text-muted-foreground">{formatNotificationDate(new Date(n.created_at), preview ? new Date(PREVIEW_NOW_ISO) : new Date(), lang)}</div>
                      </div>
                    </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </ProviderShell>
  );
}
