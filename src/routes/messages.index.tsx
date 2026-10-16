import { formatDate, formatTime as clockTime } from "@/lib/format";
import { isPreviewRoute } from "@/lib/preview/constants";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, EmptyState } from "@/components/famio/ui";
import { CustomerPageHeader as CustomerPageHero } from "@/components/famio/CustomerPageHeader";
import { useTranslation } from "react-i18next";
import { useConversations } from "@/lib/db/messaging";
import { ProfileAvatar } from "@/components/provider/ProfileAvatar";

export const Route = createFileRoute("/messages/")({ component: Messages });

function formatTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return clockTime(d);
  }
  const days = Math.floor((+now - +d) / 86400000);
  if (days < 7) return formatDate(d, { weekday: "short" });
  return formatDate(d);
}

function Messages() {
  const { t } = useTranslation();
  const { data: convs = [], isLoading, isError } = useConversations();

  return (
    <AppShell>
      <CustomerPageHero title={t("messages.title")} subtitle={t("messages.chatNotice")} />
      <div className="px-5 pt-2">
        {isLoading ? (
          <div className="py-20 text-center text-sm text-muted-foreground">
            {t("common.loading", "Loading…")}
          </div>
        ) : isError ? (
          <EmptyState
            icon="alert"
            title={t("common.errorTitle", "Something went wrong")}
            body={t("common.tryAgain", "Please try again.")}
          />
        ) : convs.length === 0 ? (
          <EmptyState
            icon="message"
            title={t("messages.emptyTitle")}
            body={t("messages.emptyBody")}
          />
        ) : (
          <ul className="space-y-2.5 pb-6">
            {convs.map((c) => (
              <li key={c.id}>
                <Link
                  to={isPreviewRoute() ? "/preview/chat/$id" : "/messages/$id"}
                  params={{ id: c.id }}
                  className="focus-ring tap-scale flex items-center gap-3.5 rounded-2xl border border-border/50 bg-white p-3.5 shadow-sm"
                >
                  <ProfileAvatar
                    src={c.other_avatar}
                    name={c.other_name || t("profile.famioUser")}
                    className="h-14 w-14 rounded-full text-lg"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-pro-16 font-extrabold text-foreground">
                        {c.other_name || t("profile.famioUser")}
                      </span>
                      <span className="shrink-0 text-pro-12 font-bold text-muted-foreground">
                        {formatTime(c.last_time)}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-pro-14 font-medium text-muted-foreground">
                      {c.last_system_key
                        ? t(`bookingChat.system.${c.last_system_key}`, c.last_message ?? "")
                        : (c.last_message ?? t("messages.sayHello"))}
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
