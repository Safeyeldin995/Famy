import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { PhoneFrame, EmptyState } from "@/components/famio/ui";
import { CustomerPageHeader } from "@/components/famio/CustomerPageHeader";
import {
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from "@/lib/db/queries";
import { useTranslation } from "react-i18next";
import { useLang } from "@/components/famio/LanguageToggle";
import { Bell, Sparkles } from "lucide-react";
import { formatTime } from "@/lib/format";
import { QueryError } from "@/components/famio/QueryError";
import {
  notificationText,
  groupCustomerNotifications,
} from "@/components/famio/customerNotifications";
import { previewPath } from "@/lib/preview/previewPath";

export const Route = createFileRoute("/notifications")({ component: Notifications });

function Notifications() {
  const { t } = useTranslation();
  const lang = useLang();
  const nav = useNavigate();
  const q = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const items = q.data ?? [];
  const hasUnread = items.some((n) => !n.read_at);

  const openNotification = (n: (typeof items)[number]) => {
    if (!n.read_at) markRead.mutate(n.id);
    if (n.deep_link) nav({ to: previewPath(n.deep_link) });
  };

  return (
    <PhoneFrame bg="bg-background">
      <CustomerPageHeader
        title={t("notifs.title")}
        backTo="/home"
        right={
          hasUnread ? (
            <button
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
              className="focus-ring shrink-0 rounded-full border border-border/60 bg-white px-3.5 min-h-11 text-pro-12 font-bold text-brand disabled:opacity-50"
            >
              {t("notifs.markAllRead")}
            </button>
          ) : undefined
        }
      />
      <div className="px-5 pt-4">
        {q.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-20 rounded-2xl bg-surface-2 animate-pulse" />
            ))}
          </div>
        ) : q.isError ? (
          <QueryError onRetry={() => q.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon="bell"
            title={t("customerRound2.notificationsEmpty")}
            body={t("customerRound2.notificationsEmptyBody")}
            action={
              <Link
                to={previewPath("/home")}
                className="focus-ring inline-flex min-h-11 items-center rounded-full bg-brand px-5 text-pro-14 font-bold text-white"
              >
                {t("customerRound2.browse")}
              </Link>
            }
          />
        ) : (
          <div className="space-y-6 pb-6">
            {groupCustomerNotifications(items, lang).map((group) => (
              <section key={group.key}>
                <h2 className="mb-3 text-pro-16 font-bold">{group.label}</h2>
                <ul className="space-y-2.5">
                  {group.items.map((n) => {
                    const unread = !n.read_at;
                    const isOffer = n.category === "campaign";
                    const { title, body } = notificationText(n, lang);
                    return (
                      <li key={n.id}>
                        <button
                          type="button"
                          onClick={() => openNotification(n)}
                          className={`focus-ring flex w-full min-h-11 text-start cursor-pointer items-start gap-3.5 rounded-[1.5rem] border p-4 transition-colors ${unread ? "border-brand/20 bg-surface-elevated shadow-sm" : "border-transparent bg-surface-2"}`}
                        >
                          <div
                            className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${isOffer ? "bg-brand text-brand-foreground" : "bg-brand/8 text-brand"}`}
                          >
                            {isOffer ? (
                              <Sparkles className="h-5 w-5" />
                            ) : (
                              <Bell className="h-5 w-5" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="break-words text-pro-16 font-extrabold">
                                {title}
                              </span>
                              {unread && (
                                <span className="h-2 w-2 shrink-0 rounded-full bg-brand" />
                              )}
                            </div>
                            {body && <p className="text-pro-14 text-muted-foreground">{body}</p>}
                            <div className="mt-1 text-pro-12 text-muted-foreground">
                              {formatTime(new Date(n.created_at), lang)}
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </PhoneFrame>
  );
}
