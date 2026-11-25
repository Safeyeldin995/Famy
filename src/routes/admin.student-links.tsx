import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useAdminRevokeStudentLink,
  useAdminStudentLinks,
} from "@/lib/db/student-parent-link-queries";

export const Route = createFileRoute("/admin/student-links")({
  component: AdminStudentLinksRoute,
});

const STATUS_FILTERS = ["", "notified", "linked", "flagged_not_my_child", "revoked"] as const;

function AdminStudentLinksRoute() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<string>("");
  const [search, setSearch] = useState("");
  const linksQ = useAdminStudentLinks(status || null, search);
  const revoke = useAdminRevokeStudentLink();
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  return (
    <div className="space-y-4 p-5">
      <h1 className="text-lg font-extrabold">{t("admin.studentLinks.title")}</h1>
      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((value) => (
          <button
            key={value || "all"}
            type="button"
            className={`rounded-full px-3 py-1 text-xs font-bold ${
              status === value ? "bg-brand text-brand-foreground" : "bg-muted"
            }`}
            onClick={() => setStatus(value)}
          >
            {value ? t(`admin.studentLinks.status.${value}`) : t("admin.studentLinks.all")}
          </button>
        ))}
      </div>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("admin.studentLinks.search")}
        className="h-10 w-full rounded-xl border border-border px-3 text-sm"
      />
      {linksQ.isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : (
        <ul className="space-y-2">
          {(linksQ.data ?? []).map((row) => {
            const linkId = String(row.link_id ?? "");
            return (
              <li key={linkId} className="rounded-xl border border-border/60 bg-surface p-3 text-xs">
                <p className="font-bold">
                  {String(row.student_name ?? "—")} · {String(row.status ?? "—")}
                </p>
                <p className="text-muted-foreground">
                  {t("admin.studentLinks.parentMasked", {
                    phone: String(row.parent_phone_masked ?? "—"),
                    email: String(row.parent_email_masked ?? "—"),
                  })}
                </p>
                <button
                  type="button"
                  className="mt-2 rounded-lg border border-coral px-3 py-1 text-xs font-bold text-coral"
                  onClick={() => setRevokeId(linkId)}
                >
                  {t("admin.studentLinks.revoke")}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {revokeId ? (
        <div className="rounded-xl border border-border p-3">
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-lg border border-border p-2 text-sm"
            placeholder={t("admin.studentLinks.reasonPlaceholder")}
          />
          <button
            type="button"
            className="mt-2 rounded-lg bg-coral px-3 py-2 text-xs font-bold text-white"
            disabled={!reason.trim() || revoke.isPending}
            onClick={() =>
              revoke.mutate(
                { linkId: revokeId, reason: reason.trim() },
                {
                  onSuccess: () => {
                    toast.success(t("admin.studentLinks.revoked"));
                    setRevokeId(null);
                    setReason("");
                  },
                  onError: (e) => toast.error(e.message),
                },
              )
            }
          >
            {t("admin.studentLinks.confirmRevoke")}
          </button>
        </div>
      ) : null}
    </div>
  );
}