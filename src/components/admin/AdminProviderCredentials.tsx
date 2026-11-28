import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAdminProviderCredentials, useReviewCertificate } from "@/lib/db/credential-queries";
import {
  credentialErrorKey,
  signedCredentialUrl,
  yearRange,
  type CertificateRow,
} from "@/lib/provider/credentials";
import { AdminQueryError } from "./AdminQueryError";

/**
 * Education, experience and certificates on the admin provider page.
 * Informational for approval (no new requirement); certificates get «اتأكدنا منها» / «ارفض».
 */
export function AdminProviderCredentials({ providerId }: { providerId: string }) {
  const { t } = useTranslation();
  const q = useAdminProviderCredentials(providerId);
  const review = useReviewCertificate(providerId);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const present = t("providerCredentials.present");

  const openFile = async (path: string) => {
    try {
      const url = await signedCredentialUrl(supabase, path);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(t(credentialErrorKey(e)));
    }
  };

  const decide = async (row: CertificateRow, status: "verified" | "rejected" | "pending") => {
    try {
      await review.mutateAsync({ id: row.id, status, note: status === "rejected" ? reason : null });
      setRejecting(null);
      setReason("");
      if (status === "verified") toast.success(t("providerCredentials.admin.verified"));
      if (status === "rejected") toast.success(t("providerCredentials.admin.rejected"));
    } catch (e) {
      toast.error(t(credentialErrorKey(e)));
    }
  };

  return (
    <section
      id="admin-provider-credentials"
      aria-labelledby="admin-provider-credentials-title"
      className="grid gap-4 rounded-2xl border border-border bg-surface p-4"
    >
      <h2 id="admin-provider-credentials-title" className="text-lg font-bold">
        {t("providerCredentials.admin.title")}
      </h2>
      {q.isError ? (
        <AdminQueryError
          compact
          message={t("admin.providers.loadError")}
          error={q.error}
          onRetry={() => q.refetch()}
        />
      ) : !q.data ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("common.loading")}
        </p>
      ) : !q.data.education.length && !q.data.experience.length && !q.data.certificates.length ? (
        <p className="text-sm text-muted-foreground">{t("providerCredentials.admin.empty")}</p>
      ) : (
        <>
          {q.data.certificates.length ? (
            <div className="grid gap-2">
              <h3 className="text-sm font-bold">{t("providerCredentials.profile.certificates")}</h3>
              <ul className="grid gap-2">
                {q.data.certificates.map((c) => (
                  <li key={c.id} className="grid gap-2 rounded-xl border border-border p-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-semibold">{c.title}</p>
                      <p className="text-muted-foreground">
                        {c.issuer}
                        {c.issued_year ? ` · ${c.issued_year}` : ""}
                      </p>
                      <p
                        className={`font-bold ${
                          c.status === "verified"
                            ? "text-success"
                            : c.status === "rejected"
                              ? "text-destructive"
                              : "text-warning"
                        }`}
                      >
                        {t(`providerCredentials.certificates.status.${c.status}`)}
                      </p>
                      {c.review_note ? <p className="break-words">{c.review_note}</p> : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="min-h-10 rounded-lg border border-border px-3 font-semibold"
                        onClick={() => void openFile(c.file_path)}
                      >
                        {t("providerCredentials.admin.openFile")}
                      </button>
                      {c.status !== "verified" ? (
                        <button
                          type="button"
                          disabled={review.isPending}
                          className="min-h-10 rounded-lg bg-success px-3 font-semibold text-white disabled:opacity-60"
                          onClick={() => void decide(c, "verified")}
                        >
                          {t("providerCredentials.admin.verify")}
                        </button>
                      ) : null}
                      {c.status !== "rejected" ? (
                        <button
                          type="button"
                          disabled={review.isPending}
                          className="min-h-10 rounded-lg border border-destructive px-3 font-semibold text-destructive disabled:opacity-60"
                          onClick={() => {
                            setRejecting(c.id);
                            setReason("");
                          }}
                        >
                          {t("providerCredentials.admin.reject")}
                        </button>
                      ) : null}
                      {c.status !== "pending" ? (
                        <button
                          type="button"
                          disabled={review.isPending}
                          className="min-h-10 px-3 font-semibold text-muted-foreground disabled:opacity-60"
                          onClick={() => void decide(c, "pending")}
                        >
                          {t("providerCredentials.admin.reset")}
                        </button>
                      ) : null}
                    </div>
                    {rejecting === c.id ? (
                      <form
                        className="grid gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void decide(c, "rejected");
                        }}
                      >
                        <label htmlFor={`reject-${c.id}`} className="text-xs font-semibold">
                          {t("providerCredentials.admin.rejectReason")}
                        </label>
                        <textarea
                          id={`reject-${c.id}`}
                          value={reason}
                          maxLength={500}
                          onChange={(e) => setReason(e.target.value)}
                          className="min-h-20 rounded-lg border border-border bg-background p-2"
                        />
                        <div className="flex gap-2">
                          <button
                            type="submit"
                            disabled={review.isPending || reason.trim().length < 3}
                            className="min-h-10 rounded-lg bg-destructive px-3 font-semibold text-destructive-foreground disabled:opacity-60"
                          >
                            {t("providerCredentials.admin.reject")}
                          </button>
                          <button
                            type="button"
                            className="min-h-10 px-3"
                            onClick={() => setRejecting(null)}
                          >
                            {t("providerCredentials.cancel")}
                          </button>
                        </div>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {q.data.education.length ? (
            <div className="grid gap-2">
              <h3 className="text-sm font-bold">{t("providerCredentials.profile.education")}</h3>
              <ul className="grid gap-2">
                {q.data.education.map((e) => {
                  const years = yearRange(e.start_year, e.end_year, false, present);
                  return (
                    <li key={e.id} className="rounded-xl border border-border p-3 text-sm">
                      <p className="font-semibold">
                        {e.degree}
                        {e.field_of_study ? ` · ${e.field_of_study}` : ""}
                      </p>
                      <p className="text-muted-foreground">
                        {e.institution}
                        {years ? ` · ${years}` : ""}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          {q.data.experience.length ? (
            <div className="grid gap-2">
              <h3 className="text-sm font-bold">{t("providerCredentials.profile.experience")}</h3>
              <ul className="grid gap-2">
                {q.data.experience.map((w) => {
                  const years = yearRange(w.start_year, w.end_year, w.is_current, present);
                  return (
                    <li key={w.id} className="rounded-xl border border-border p-3 text-sm">
                      <p className="font-semibold">{w.role_title}</p>
                      <p className="text-muted-foreground">
                        {w.place}
                        {years ? ` · ${years}` : ""}
                      </p>
                      {w.description ? (
                        <p className="mt-1 whitespace-pre-wrap break-words">{w.description}</p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
