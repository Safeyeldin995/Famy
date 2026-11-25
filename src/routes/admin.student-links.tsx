import { AdminLink as Link } from "@/components/admin/AdminNavigation";
import { AdminReasonSheet } from "@/components/admin/AdminReasonSheet";
import { AdminQueryError } from "@/components/admin/AdminQueryError";
import { adminDate } from "@/components/admin/adminPresentation";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useAdminRevokeStudentLink,
  useAdminStudentLinks,
  type StudentParentLinkStatus,
} from "@/lib/db/student-parent-link-queries";

export const Route = createFileRoute("/admin/student-links")({
  component: AdminStudentLinks,
});

const STATUSES: Array<StudentParentLinkStatus | ""> = [
  "",
  "pending",
  "approved",
  "rejected",
  "revoked",
];

function AdminStudentLinks() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<string>("");
  const [search, setSearch] = useState("");
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const q = useAdminStudentLinks(status, search.trim());
  const revoke = useAdminRevokeStudentLink();
  const rows = q.data ?? [];

  const subtitle = useMemo(() => t("admin.studentLinks.subtitle"), [t]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-extrabold">{t("admin.studentLinks.title")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>

      <div className="mt-5 flex flex-wrap gap-3">
        <label className="text-xs font-semibold">
          {t("admin.studentLinks.filterStatus")}
          <select
            className="mt-1 block h-10 min-w-40 rounded-xl border border-border bg-surface px-3 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {STATUSES.map((value) => (
              <option key={value || "all"} value={value}>
                {value
                  ? t(`admin.studentLinks.status.${value}`)
                  : t("admin.studentLinks.statusAll")}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-56 flex-1 text-xs font-semibold">
          {t("admin.studentLinks.search")}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("admin.studentLinks.searchPlaceholder")}
            className="mt-1 block h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm"
          />
        </label>
      </div>

      {q.isLoading ? <p className="mt-6">{t("common.loading")}</p> : null}
      {q.isError ? (
        <div className="mt-6">
          <AdminQueryError
            message={t("admin.studentLinks.loadError")}
            error={q.error}
            onRetry={() => q.refetch()}
          />
        </div>
      ) : null}

      {!q.isLoading && rows.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">{t("admin.studentLinks.empty")}</p>
      ) : null}

      <ul className="mt-6 space-y-3">
        {rows.map((row) => (
          <li
            key={row.link_id}
            className="rounded-2xl border border-border bg-surface p-4 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Link
                  to="/admin/customer/$id"
                  params={{ id: row.student_id }}
                  className="font-semibold hover:text-brand"
                >
                  {row.student_name}
                </Link>
                <p className="mt-1 text-xs text-muted-foreground">
                  {row.parent_id ? (
                    <Link
                      to="/admin/customer/$id"
                      params={{ id: row.parent_id }}
                      className="hover:text-brand"
                    >
                      {row.parent_name || t("admin.studentLinks.parent")}
                    </Link>
                  ) : (
                    t("admin.studentLinks.parentPending")
                  )}
                  {row.parent_phone_masked ? ` · ${row.parent_phone_masked}` : ""}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {adminDate(row.requested_at, i18n.language)}
                  {row.decided_at ? ` · ${adminDate(row.decided_at, i18n.language)}` : ""}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold uppercase">
                  {t(`admin.studentLinks.status.${row.status}`)}
                </span>
                {row.status === "pending" || row.status === "approved" ? (
                  <button
                    type="button"
                    className="focus-ring rounded-xl border border-coral px-3 py-1.5 text-xs font-bold text-coral"
                    onClick={() => setRevokeId(row.link_id)}
                  >
                    {t("admin.studentLinks.revoke")}
                  </button>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {revokeId ? (
        <AdminReasonSheet
          title={t("admin.studentLinks.revoke")}
          description={t("admin.studentLinks.revokeHint")}
          busy={revoke.isPending}
          onClose={() => setRevokeId(null)}
          onConfirm={(reason) => {
            revoke.mutate(
              { linkId: revokeId, reason },
              {
                onSuccess: () => {
                  setRevokeId(null);
                  toast.success(t("admin.studentLinks.revokeSuccess"));
                },
                onError: (e: Error) =>
                  toast.error(e.message || t("admin.studentLinks.revokeError")),
              },
            );
          }}
        />
      ) : null}
    </main>
  );
}
