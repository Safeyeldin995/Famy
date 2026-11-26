import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Bell, X } from "lucide-react";
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

/** Below this width the panel opens as a full-width bottom sheet. */
export const NOTIFICATIONS_SHEET_MAX_PX = 639;

function useIsSmallScreen(): boolean {
  const [small, setSmall] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(`(max-width: ${NOTIFICATIONS_SHEET_MAX_PX}px)`);
    const update = () => setSmall(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return small;
}

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
  const small = useIsSmallScreen();

  // Lock page scroll while the mobile sheet is open.
  useEffect(() => {
    if (!open || !small) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, small]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (small) return;
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
  }, [open, small]);

  if (!enabled) return null;

  const unread = countQ.data ?? 0;
  const rows = (listQ.data ?? []).slice(0, 20) as NotificationRow[];

  const openRow = (row: NotificationRow) => {
    if (!row.read_at) markRead.mutate(row.id);
    const href = onlineWebNotificationHref(row.deep_link);
    setOpen(false);
    if (href) void nav({ to: href as never });
  };

  // The header uses backdrop-blur, which traps `position: fixed` children, so the
  // mobile sheet renders into <body>.
  const renderPanel = (node: ReactNode) =>
    small && typeof document !== "undefined" ? createPortal(node, document.body) : node;

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        className="focus-ring relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-white text-foreground sm:h-10 sm:w-10"
        aria-label={
          unread > 0
            ? t("onlineWeb.notifications.labelUnread", { n: String(unread) })
            : t("onlineWeb.notifications.label")
        }
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <Bell className="h-4 w-4" aria-hidden />
        {unread > 0 ? (
          <span className="absolute -end-1 -top-1 min-w-[1.1rem] rounded-full bg-brand px-1 text-center text-pro-12 font-bold leading-[1.1rem] text-brand-foreground tabular-nums">
            {unread > 9 ? "9+" : formatNumber(unread, "en")}
          </span>
        ) : null}
      </button>
      {open ? renderPanel(
        <>
          {small ? (
            <div
              className="fixed inset-0 z-50 bg-ink/40"
              aria-hidden
              data-testid="notifications-backdrop"
              onClick={() => setOpen(false)}
            />
          ) : null}
          <div
            role="dialog"
            aria-modal={small ? true : undefined}
            aria-labelledby="online-notifications-title"
            data-variant={small ? "sheet" : "dropdown"}
            className={
              small
                ? "fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col overflow-hidden rounded-t-3xl border-t border-border bg-white shadow-lg"
                : "absolute end-0 top-full z-50 mt-2 flex w-[22rem] flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-lg"
            }
            style={small ? { paddingBottom: "env(safe-area-inset-bottom, 0px)" } : undefined}
          >
            {small ? <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-border" aria-hidden /> : null}
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-4 py-2">
              <p id="online-notifications-title" className="text-pro-15 font-bold text-foreground">
                {t("onlineWeb.notifications.title")}
              </p>
              <div className="flex items-center gap-1">
                {unread > 0 ? (
                  <button
                    type="button"
                    className="focus-ring min-h-11 rounded-full px-3 text-pro-13 font-bold text-brand"
                    onClick={() => markAll.mutate()}
                    disabled={markAll.isPending}
                  >
                    {t("onlineWeb.notifications.markAll")}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="focus-ring inline-flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-surface-2"
                  aria-label={t("common.close")}
                  onClick={() => setOpen(false)}
                >
                  <X className="h-5 w-5" aria-hidden />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain sm:max-h-[60vh] sm:flex-none">
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
                          className="focus-ring flex min-h-11 w-full items-start gap-3 px-4 py-3 text-start hover:bg-surface-2"
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
        </>
      ) : null}
    </div>
  );
}
