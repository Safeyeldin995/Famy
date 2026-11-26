import { adminErrorText } from "@/lib/admin/adminErrorText";
import { AdminLink as Link } from "@/components/admin/AdminNavigation";
import { useAdminOnlineSessionReviews } from "@/lib/db/admin-online-session-queries";
import { useResolveOnlineSessionReview } from "@/lib/db/admin-online-lesson-queries";
import { useTranslation } from "react-i18next";
import { operationDate } from "@/components/admin/operations";
import { bookingCode } from "@/components/admin/operations";
import { toast } from "sonner";

export function AdminOnlineSessionReviewQueue() {
  const { t, i18n } = useTranslation();
  const q = useAdminOnlineSessionReviews("open");
  const resolve = useResolveOnlineSessionReview();

  if (q.isLoading || !q.data?.length) return null;

  return (
    <div className="mb-6 space-y-2 rounded-xl border border-border/60 bg-surface p-4">
      <p className="text-sm font-bold">{t("admin.bookings.onlineSessionReviewQueue")}</p>
      <ul className="space-y-2 text-xs">
        {q.data.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground">{row.reason}</span>
            <Link
              to="/admin/bookings"
              search={{ booking: row.booking_id }}
              className="font-mono text-brand hover:underline"
            >
              {bookingCode(row.booking_id)}
            </Link>
            <span className="text-muted-foreground">
              {operationDate(row.created_at, i18n.language)}
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                className="focus-ring rounded-lg bg-brand px-2 py-1 text-[10px] font-bold text-brand-foreground"
                disabled={resolve.isPending}
                onClick={() =>
                  resolve.mutate(
                    { id: row.id, status: "resolved" },
                    {
                      onSuccess: () => toast.success(t("admin.onlineLessonIssues.closed")),
                      onError: (e: any) => toast.error(adminErrorText(t, e, t("common.error"))),
                    },
                  )
                }
              >
                {t("admin.onlineLessonIssues.resolve")}
              </button>
              <button
                type="button"
                className="focus-ring rounded-lg border border-border px-2 py-1 text-[10px] font-bold"
                disabled={resolve.isPending}
                onClick={() =>
                  resolve.mutate(
                    { id: row.id, status: "dismissed" },
                    {
                      onSuccess: () => toast.success(t("admin.onlineLessonIssues.closed")),
                      onError: (e: any) => toast.error(adminErrorText(t, e, t("common.error"))),
                    },
                  )
                }
              >
                {t("admin.onlineLessonIssues.dismiss")}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}