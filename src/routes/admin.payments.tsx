import { createFileRoute } from "@tanstack/react-router";
import { AdminLink as Link } from "@/components/admin/AdminNavigation";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { paymentStatusLabel } from "@/lib/settlement/moneyText";
import { toast } from "sonner";
import {
  useAdminCashLedgerBookings,
  useAdminPayments,
  useRecordHistoricCash,
  useRecordPaymentRefund,
} from "@/lib/db/admin-queries";
import {
  needsAdminAction,
  paymentSituation,
  situationTone,
  type SituationTone,
} from "@/components/admin/paymentSituation";
import { getSignedProofUrl, useCapturePayment, useRejectPayment } from "@/lib/db/payment-queries";
import { formatEGP } from "@/lib/format";
import { AdminQueryError } from "@/components/admin/AdminQueryError";
import { useBookingCancellationFee } from "@/lib/db/settings-queries";
import { FeeDebtsPanel } from "@/components/admin/FeeDebtsPanel";
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
import { isPreviewAdminRoute } from "@/lib/preview/constants";

export const Route = createFileRoute("/admin/payments")({
  component: AdminPaymentsRoute,
  validateSearch: (search: Record<string, unknown>): { status?: string; statuses?: string } => ({
    ...(typeof search.status === "string" ? { status: search.status } : {}),
    ...(typeof search.statuses === "string" ? { statuses: search.statuses } : {}),
  }),
});
const TONE_CLASS: Record<SituationTone, string> = {
  action: "bg-amber-500/15 text-amber-800 dark:text-amber-200",
  waiting: "bg-muted text-muted-foreground",
  done: "bg-success/15 text-success",
  closed: "bg-muted text-muted-foreground",
  problem: "bg-destructive/10 text-destructive",
};

function PaymentCard({ payment: p, cashRecorded }: { payment: any; cashRecorded: boolean }) {
  const { t, i18n } = useTranslation();
  const capture = useCapturePayment();
  const reject = useRejectPayment();
  const recordCash = useRecordHistoricCash();
  const recordRefund = useRecordPaymentRefund();
  const [cashSheet, setCashSheet] = useState(false);
  const [refundSheet, setRefundSheet] = useState(false);
  // The customer's cancellation fee (if any) stays with the provider; only the rest is refunded.
  const refundFee = useBookingCancellationFee(p.booking_id, refundSheet);
  const paidAmount = Number(p.amount ?? 0);
  const feeAmount = Math.min(refundFee.data ?? 0, paidAmount);
  const situation = paymentSituation(p, cashRecorded);
  const isTransfer =
    p.payment_method_type === "manual_transfer" ||
    (!p.payment_method_type && p.method === "instapay");
  const [proof, setProof] = useState<string | null>(null);
  const [proofBusy, setProofBusy] = useState(false);
  const [action, setAction] = useState<"confirm" | "reject" | null>(null);
  // A receipt on a cancelled booking is a refund, not a review.
  const reviewable = canReviewTransfer(p) && situation !== "refundDue";
  const busy =
    capture.isPending || reject.isPending || recordCash.isPending || recordRefund.isPending;
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
        <span
          className={`rounded-full px-3 py-1 text-xs font-bold ${TONE_CLASS[situationTone(situation)]}`}
        >
          {situation === "other"
            ? paymentStatusLabel(p.status, t)
            : t(`admin.paymentSituation.${situation}.label`)}
        </span>
      </div>
      {situation !== "other" ? (
        <p className="text-sm">{t(`admin.paymentSituation.${situation}.note`)}</p>
      ) : null}
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
        to="/admin/bookings"
        search={{ booking: p.booking_id }}
      >
        {t("adminOps.booking")} <bdi dir="ltr">{bookingCode(p.booking_id)}</bdi>
      </Link>
      {isTransfer && p.proof_path ? (
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
      ) : null}
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
      ) : situation === "refundDue" ? (
        <button
          className={`${adminControl} bg-brand text-brand-foreground`}
          disabled={busy}
          onClick={() => setRefundSheet(true)}
        >
          {t("admin.paymentSituation.recordRefund")}
        </button>
      ) : situation === "cashUnconfirmed" ? (
        <button
          className={`${adminControl} bg-brand text-brand-foreground`}
          disabled={busy}
          onClick={() => setCashSheet(true)}
        >
          {t("admin.paymentSituation.confirmCash")}
        </button>
      ) : null}
      {refundSheet && (
        <AdminReasonSheet
          title={t("admin.paymentSituation.recordRefund")}
          description={
            refundFee.isLoading
              ? t("common.loading")
              : refundFee.isError
                ? t("admin.paymentSituation.refundFeeError")
                : [
                    feeAmount > 0
                      ? t("admin.paymentSituation.refundFeeNote", { fee: formatEGP(feeAmount) })
                      : "",
                    t(
                      isTransfer
                        ? "admin.paymentSituation.recordRefundHintTransfer"
                        : "admin.paymentSituation.recordRefundHint",
                      { amount: formatEGP(paidAmount - feeAmount) },
                    ),
                  ]
                    .filter(Boolean)
                    .join("، ")
          }
          fieldLabel={t("admin.paymentSituation.refundReference")}
          busy={busy || refundFee.isLoading || refundFee.isError}
          onClose={() => setRefundSheet(false)}
          onConfirm={(reference) =>
            recordRefund.mutate(
              { paymentId: p.id, reference },
              {
                onSuccess: () => {
                  setRefundSheet(false);
                  toast.success(t("adminOps.saved"));
                },
                onError: failure,
              },
            )
          }
        />
      )}
      {cashSheet && (
        <AdminReasonSheet
          title={t("admin.paymentSituation.confirmCash")}
          description={t("admin.paymentSituation.confirmCashHint", {
            amount: formatEGP(Number(p.amount ?? 0)),
          })}
          busy={busy}
          onClose={() => setCashSheet(false)}
          onConfirm={(reason) =>
            recordCash.mutate(
              { bookingId: p.booking_id, reason },
              {
                onSuccess: () => {
                  setCashSheet(false);
                  toast.success(t("adminOps.saved"));
                },
                onError: failure,
              },
            )
          }
        />
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
  const cashLedger = useAdminCashLedgerBookings(
    (q.data ?? [])
      .filter((p: any) => p.booking?.status === "completed" && p.status !== "captured")
      .map((p: any) => p.booking_id),
  );
  const recorded = cashLedger.data ?? new Set<string>();
  const situationOf = (p: any) => paymentSituation(p, recorded.has(p.booking_id));
  const rows = [...(q.data ?? [])]
    .filter((p: any) => matchesBooking({ ...p.booking, id: p.booking_id }, query))
    .sort(
      (a: any, b: any) =>
        Number(needsAdminAction(situationOf(b))) - Number(needsAdminAction(situationOf(a))) ||
        Date.parse(b.created_at) - Date.parse(a.created_at),
    );
  const actionCount = rows.filter((p: any) => needsAdminAction(situationOf(p))).length;
  return (
    <div className={adminScreen}>
      <h1 className="text-xl font-bold">{t("admin.layout.nav.payments")}</h1>
      <p className="text-sm text-muted-foreground">{t("admin.paymentSituation.pageHint")}</p>
      <FeeDebtsPanel />
      {actionCount > 0 ? (
        <p className="rounded-xl bg-amber-500/15 px-3 py-2 text-sm font-bold text-amber-800 dark:text-amber-200">
          {t("admin.paymentSituation.needsAction", { count: actionCount })}
        </p>
      ) : null}
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
            {s ? paymentStatusLabel(s, t) : t("adminOps.allPayments")}
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
            <PaymentCard key={p.id} payment={p} cashRecorded={recorded.has(p.booking_id)} />
          ))}
        </ul>
      )}
    </div>
  );
}
function AdminPaymentsRoute() {
  return <AdminPayments search={Route.useSearch()} />;
}
