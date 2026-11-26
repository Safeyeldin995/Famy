import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Bell } from "lucide-react";
import { useAuth } from "@/lib/auth/useAuth";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadNotificationCount,
} from "@/lib/db/queries";
import {
  formatCustomerNotificationTime,
  notificationText,
} from "@/components/famio/customerNotifications";
import { onlineWebNotificationHref } from "@/lib/web/onlineWebNotificationLink";
import { formatNumber } from "@/lib/format";
import { currentLang } from "@/lib/i18n";

const POLL_MS = 30_000;

type NotificationRow = {
  id: string;
  created_at: string;
  read_at: string | null;
  deep_link: string | null;
  title?: string | null;
  title_ar?: string | null;
  title_en?: string | null;
  body?: string | null;
  body_ar?: string | null;
  body_en?: string | null;
};

/** In-app notifications on the /online header, for students and tutors. */
export function OnlineWebNotificationsBell() {
  const { t } = useTranslation();
  const lang = currentLang();
  const { isAuthenticated, loading } = useAuth();
  const enabled = isAuthenticated && !loading;
  const [open, setOpen] = useState(false);
  const countQ = useUnreadNotificationCount({ enabled, refetchInterval: POLL_MS });
  const listQ = useNotifications({ enabled: enabled && open });
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const nav = useNavigate();
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!enabled) return null;

  const unread = countQ.data ?? 0;
  const rows = (listQ.data ?? []).slice(0, 20) as NotificationRow[];

  const openRow = (row: NotificationRow) => {
    if (!row.read_at) markRead.mutate(row.id);
    const href = onlineWebNotificationHref(row.deep_link);
    setOpen(false);
    if (href) void nav({ to: href as never });
  };

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        className="focus-ring relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-white text-foreground"
        aria-label={
          unread > 0
            ? t("onlineWeb.notifications.labelUnread", { n: String(unread) })
            : t("onlineWeb.notifications.label")
        }
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell className="h-4 w-4" aria-hidden />
        {unread > 0 ? (
          <span className="absolute -end-1 -top-1 min-w-[1.1rem] rounded-full bg-brand px-1 text-center text-pro-12 font-bold leading-[1.1rem] text-brand-foreground tabular-nums">
            {unread > 9 ? "9+" : formatNumber(unread, "en")}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute end-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-white shadow-lg">
          <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
            <p className="text-pro-14 font-bold text-foreground">{t("onlineWeb.notifications.title")}</p>
            {unread > 0 ? (
              <button
                type="button"
                className="focus-ring text-pro-12 font-bold text-brand"
                onClick={() => markAll.mutate()}
                disabled={markAll.isPending}
              >
                {t("onlineWeb.notifications.markAll")}
              </button>
            ) : null}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {listQ.isLoading ? (
              <p className="px-4 py-6 text-pro-13 text-muted-foreground">{t("common.loading")}</p>
            ) : listQ.isError ? (
              <div className="space-y-2 px-4 py-6">
                <p className="text-pro-13 text-coral">{t("onlineWeb.notifications.loadError")}</p>
                <button
                  type="button"
                  className="focus-ring text-pro-12 font-bold text-brand underline"
                  onClick={() => void listQ.refetch()}
                >
                  {t("common.tryAgain")}
                </button>
              </div>
            ) : rows.length === 0 ? (
              <p className="px-4 py-6 text-pro-13 text-muted-foreground">{t("onlineWeb.notifications.empty")}</p>
            ) : (
              <ul>
                {rows.map((row) => {
                  const text = notificationText(row, lang);
                  return (
                    <li key={row.id} className="border-b border-border/40 last:border-b-0">
                      <button
                        type="button"
                        className="focus-ring flex w-full items-start gap-3 px-4 py-3 text-start hover:bg-surface-2"
                        onClick={() => openRow(row)}
                      >
                        <span
                          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${row.read_at ? "bg-transparent" : "bg-brand"}`}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-pro-13 font-bold text-foreground">{text.title}</span>
                          {text.body ? (
                            <span className="mt-0.5 block text-pro-12 leading-relaxed text-muted-foreground">
                              {text.body}
                            </span>
                          ) : null}
                          <span className="mt-1 block text-pro-12 text-muted-foreground tabular-nums">
                            {formatCustomerNotificationTime(new Date(row.created_at), lang)}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
