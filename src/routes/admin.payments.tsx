import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAdminPayments } from "@/lib/db/admin-queries";
import { getSignedProofUrl, useCapturePayment, useRejectPayment } from "@/lib/db/payment-queries";
import { formatEGP } from "@/lib/format";
import { AdminQueryError } from "@/components/admin/AdminQueryError";
import { AdminReasonSheet } from "@/components/admin/AdminReasonSheet";
import {
  adminControl,
  adminScreen,
  bookingCode,
  canReviewTransfer,
  matchesBooking,
  operationDate,
  paymentStatuses,
} from "@/components/admin/operations";
import { adminPath } from "@/lib/preview/previewPath";
import { isPreviewAdminRoute } from "@/lib/preview/constants";

export const Route = createFileRoute("/admin/payments")({
  component: AdminPaymentsRoute,
  validateSearch: (search: Record<string, unknown>): { status?: string; statuses?: string } => ({
    ...(typeof search.status === "string" ? { status: search.status } : {}),
    ...(typeof search.statuses === "string" ? { statuses: search.statuses } : {}),
  }),
});
function PaymentCard({ payment: p }: { payment: any }) {
  const { t, i18n } = useTranslation();
  const capture = useCapturePayment();
  const reject = useRejectPayment();
  const [proof, setProof] = useState<string | null>(null);
  const [proofBusy, setProofBusy] = useState(false);
  const [action, setAction] = useState<"confirm" | "reject" | null>(null);
  const reviewable = canReviewTransfer(p);
  const busy = capture.isPending || reject.isPending;
  useEffect(() => {
    if (!p.proof_path || !reviewable) return;
    let active = true;
    setProofBusy(true);
    const request =
      isPreviewAdminRoute() && p.previewProofUrl
        ? Promise.resolve(p.previewProofUrl as string)
        : getSignedProofUrl(p.proof_path);
    request
      .then((url) => {
        if (active) setProof(url);
      })
      .catch(() => {
        if (active) toast.error(t("adminOps.proofError"));
      })
      .finally(() => {
        if (active) setProofBusy(false);
      });
    return () => {
      active = false;
    };
  }, [p.proof_path, p.previewProofUrl, reviewable, t]);
  const openProof = async () => {
    setProofBusy(true);
    try {
      setProof(
        isPreviewAdminRoute() && p.previewProofUrl
          ? p.previewProofUrl
          : await getSignedProofUrl(p.proof_path),
      );
    } catch {
      toast.error(t("adminOps.proofError"));
    } finally {
      setProofBusy(false);
    }
  };
  const success = () => {
    setAction(null);
    toast.success(t("adminOps.saved"));
  };
  const failure = () => toast.error(t("adminOps.actionError"));
  return (
    <li className="min-w-0 space-y-3 rounded-2xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-lg">{formatEGP(Number(p.amount ?? 0))}</strong>
        <span className="rounded-full bg-muted px-3 py-1 text-xs font-bold">
          {t(`adminOps.status.${p.status}`, { defaultValue: t("adminOps.unknown") })}
        </span>
      </div>
      <p className="font-semibold">
        {p.booking?.customer?.full_name || "—"} → {p.booking?.provider?.profile?.full_name || "—"}
      </p>
      <p className="text-xs text-muted-foreground">
        {t(`adminOps.methods.${p.method}`, {
          defaultValue: i18n.language.startsWith("ar")
            ? p.payment_method_name_ar || t("adminOps.unknown")
            : p.payment_method_name_en || t("adminOps.unknown"),
        })}{" "}
        · {operationDate(p.created_at, i18n.language)}
      </p>
      <Link
        className={`${adminControl} inline-flex items-center gap-2`}
        to={adminPath("/admin/bookings") as "/admin/bookings"}
        search={{ booking: p.booking_id }}
      >
        {t("adminOps.booking")} <bdi dir="ltr">{bookingCode(p.booking_id)}</bdi>
      </Link>
      {p.proof_path ? (
        <div>
          <button className={adminControl} disabled={proofBusy} onClick={openProof}>
            {t("adminOps.proof")}
          </button>
          {proof && (
            <a href={proof} target="_blank" rel="noopener noreferrer" className="mt-3 block">
              <img
                src={proof}
                alt={t("adminOps.proof")}
                referrerPolicy="no-referrer"
                className="max-h-80 w-full rounded-xl object-contain"
                onError={() => {
                  setProof(null);
                  toast.error(t("adminOps.proofError"));
                }}
              />
            </a>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t("adminOps.noProof")}</p>
      )}
      {reviewable ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <button
              className={`${adminControl} bg-brand text-brand-foreground`}
              disabled={busy || p.booking?.status !== "completed" || !p.proof_path}
              onClick={() => setAction("confirm")}
            >
              {t("adminOps.confirmTransfer")}
            </button>
            <button className={adminControl} disabled={busy} onClick={() => setAction("reject")}>
              {t("adminOps.rejectReason")}
            </button>
          </div>
          {p.booking?.status !== "completed" && (
            <p className="text-xs text-muted-foreground">{t("adminOps.completedOnly")}</p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t("adminOps.readOnlyPayment")}</p>
      )}
      {action === "confirm" && reviewable && (
        <div
          role="group"
          aria-label={t("adminOps.confirmQuestion")}
          className="space-y-2 rounded-xl bg-muted p-3"
        >
          <p className="font-bold">{t("adminOps.confirmQuestion")}</p>
          <p className="text-xs">{t("adminOps.confirmHint")}</p>
          <div className="flex gap-2">
            <button
              className={adminControl}
              disabled={busy || p.booking?.status !== "completed" || !p.proof_path}
              onClick={() =>
                capture.mutate(
                  { paymentId: p.id, bookingId: p.booking_id },
                  { onSuccess: success, onError: failure },
                )
              }
            >
              {t("common.confirm")}
            </button>
            <button className={adminControl} disabled={busy} onClick={() => setAction(null)}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}
      {action === "reject" && reviewable && (
        <AdminReasonSheet
          title={t("adminOps.rejectReason")}
          description={t("adminOps.confirmHint")}
          busy={busy}
          onClose={() => setAction(null)}
          onConfirm={(reason) =>
            reject.mutate(
              { paymentId: p.id, bookingId: p.booking_id, reason },
              { onSuccess: success, onError: failure },
            )
          }
        />
      )}
    </li>
  );
}
export function AdminPayments({ search }: { search: { status?: string; statuses?: string } }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState(search.statuses || search.status || "pending_review");
  const [query, setQuery] = useState("");
  const q = useAdminPayments(status.includes(",") ? status.split(",") : status || undefined);
  const rows = [...(q.data ?? [])]
    .filter((p: any) => matchesBooking({ ...p.booking, id: p.booking_id }, query))
    .sort(
      (a: any, b: any) =>
        Number(canReviewTransfer(b)) - Number(canReviewTransfer(a)) ||
        Date.parse(a.created_at) - Date.parse(b.created_at),
    );
  return (
    <div className={adminScreen}>
      <h1 className="text-xl font-bold">{t("admin.layout.nav.payments")}</h1>
      <h2 className="font-bold">{t("adminOps.pendingTransfers")}</h2>
      <p className="text-sm text-muted-foreground">{t("adminOps.transferHint")}</p>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("adminOps.search")}
        aria-label={t("adminOps.search")}
        className="min-h-11 w-full rounded-xl border bg-surface px-3 text-sm"
      />
      <div className="flex flex-wrap gap-2">
        {["", ...paymentStatuses].map((s) => (
          <button
            key={s}
            className={`${adminControl} ${status === s ? "bg-brand text-brand-foreground" : ""}`}
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
          >
            {t(s ? `adminOps.status.${s}` : "adminOps.allPayments")}
          </button>
        ))}
      </div>
      {q.isLoading ? (
        <p>{t("adminOps.loading")}</p>
      ) : q.isError ? (
        <AdminQueryError message={t("adminOps.loadError")} onRetry={() => q.refetch()} />
      ) : !rows.length ? (
        <p>{t("admin.payments.noResults")}</p>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {rows.map((p: any) => (
            <PaymentCard key={p.id} payment={p} />
          ))}
        </ul>
      )}
    </div>
  );
}
function AdminPaymentsRoute() {
  return <AdminPayments search={Route.useSearch()} />;
}
