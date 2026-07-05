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
          <EmptyState emoji="⚠️" title={t("common.errorTitle", "Something went wrong")} body={t("common.tryAgain", "Please try again.")} />
        ) : convs.length === 0 ? (
          <div className="py-20 text-center">
            <div className="mx-auto grid h-24 w-24 place-items-center rounded-3xl bg-surface text-4xl shadow-soft">💬</div>
            <div className="mt-5 text-base font-bold">{t("messages.emptyTitle")}</div>
            <div className="mt-2 text-xs text-muted-foreground">
              {t("messages.emptyBody")}
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-3xl bg-surface shadow-soft">
            {convs.map((c) => (
              <li key={c.id}>
                <Link to="/messages/$id" params={{ id: c.id }} className="flex items-center gap-3 px-4 py-3 active:bg-surface-2">
                  <div className="relative shrink-0">
                    {c.other_avatar ? (
                      <img src={c.other_avatar} alt="" className="h-12 w-12 rounded-2xl object-cover" />
                    ) : (
                      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-navy text-base font-extrabold text-navy-foreground">
                        {c.other_name.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface bg-success" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-bold">{c.other_name}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{formatTime(c.last_time)}</span>
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
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
