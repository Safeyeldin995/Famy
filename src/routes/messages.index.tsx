import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, TopBar, EmptyState } from "@/components/famio/ui";
import { useTranslation } from "react-i18next";
import { useConversations } from "@/lib/db/messaging";

export const Route = createFileRoute("/messages/")({ component: Messages });

function formatTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  const days = Math.floor((+now - +d) / 86400000);
  if (days < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString();
}

function Messages() {
  const { t } = useTranslation();
  const { data: convs = [], isLoading, isError } = useConversations();

  return (
    <AppShell>
      <TopBar title={t("messages.title")} />
      <div className="px-5">
        {isLoading ? (
          <div className="py-20 text-center text-sm text-muted-foreground">{t("common.loading", "Loading…")}</div>
        ) : isError ? (
          <EmptyState icon="alert" title={t("common.errorTitle", "Something went wrong")} body={t("common.tryAgain", "Please try again.")} />
        ) : convs.length === 0 ? (
          <EmptyState icon="message" title={t("messages.emptyTitle")} body={t("messages.emptyBody")} />
        ) : (
          <ul className="space-y-2.5 pb-6">
            {convs.map((c) => (
              <li key={c.id}>
                <Link
                  to="/messages/$id"
                  params={{ id: c.id }}
                  className="focus-ring tap-scale flex items-center gap-3.5 rounded-[1.75rem] border border-border/50 bg-surface-elevated p-3.5 shadow-sm"
                >
                  <div className="relative shrink-0">
                    {c.other_avatar ? (
                      <img src={c.other_avatar} alt="" className="h-14 w-14 rounded-full object-cover" />
                    ) : (
                      <div className="grid h-14 w-14 place-items-center rounded-full bg-brand/10 text-lg font-black text-brand">
                        {c.other_name.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <span className="absolute -bottom-0.5 -end-0.5 h-3.5 w-3.5 rounded-full border-2 border-surface bg-success" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-[15px] font-extrabold text-foreground">{c.other_name}</span>
                      <span className="shrink-0 text-[11px] font-bold text-muted-foreground">{formatTime(c.last_time)}</span>
                    </div>
                    <div className="mt-0.5 truncate text-xs font-medium text-muted-foreground">
                      {c.last_message ?? t("messages.sayHello")}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
