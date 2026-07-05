import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ProviderShell } from "@/components/famio/ProviderShell";
import { TopBar, Card, EmptyState } from "@/components/famio/ui";
import { useNotifications, useMarkNotificationRead } from "@/lib/db/queries";
import { Bell } from "lucide-react";

export const Route = createFileRoute("/pro/notifications")({ component: NotificationsPage });

function NotificationsPage() {
  const { t } = useTranslation();
  const q = useNotifications();
  const mark = useMarkNotificationRead();
  return (
    <ProviderShell hideNav>
      <TopBar back={{ to: "/pro" }} title={t("notifs.title")} />
      <div className="px-5 pb-6">
        {q.isLoading ? (
          <div className="h-20 animate-pulse rounded-3xl bg-surface" />
        ) : q.isError ? (
          <EmptyState emoji="⚠️" title={t("common.errorTitle", "Something went wrong")} body={t("common.tryAgain", "Please try again.")} />
        ) : (q.data ?? []).length === 0 ? (
          <EmptyState emoji="🔔" title={t("notifs.empty")} body={t("notifs.emptyBody")} />
        ) : (
          <div className="space-y-2">
            {q.data!.map((n: any) => (
              <Card key={n.id} className={`p-4 ${n.read_at ? "opacity-70" : ""}`} >
                <button onClick={() => !n.read_at && mark.mutate(n.id)} className="block w-full text-left">
                  <div className="flex items-start gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-navy/10 text-navy"><Bell className="h-5 w-5" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="truncate text-sm font-bold">{n.title}</div>
                        {!n.read_at && <span className="h-2 w-2 rounded-full bg-coral" />}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{n.body}</div>
                      <div className="mt-1 text-[10px] text-muted-foreground">{new Date(n.created_at).toLocaleString()}</div>
                    </div>
                  </div>
                </button>
              </Card>
            ))}
          </div>
        )}
      </div>
    </ProviderShell>
  );
}
