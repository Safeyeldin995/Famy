import { createFileRoute } from "@tanstack/react-router";
import { AdminLink as Link } from "@/components/admin/AdminNavigation";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { paymentStatusLabel } from "@/lib/settlement/moneyText";
import { toast } from "sonner";
import {
  useAdminCashLedgerBookings,
  useAdminPaymentsList,
  useRecordHistoricCash,
  useRecordPaymentRefund,
} from "@/lib/db/admin-queries";
import {
  useAdminPaymentQueue,
  useAdminPaymentQueueCounts,
  type PaymentQueueTab,
} from "@/lib/db/admin-daily-ops-queries";
import {
  paymentSituation,
  situationTone,
  type SituationTone,
} from "@/components/admin/paymentSituation";
import { getSignedProofUrl, useCapturePayment, useRejectPayment } from "@/lib/db/payment-queries";
import { formatEGP } from "@/lib/format";
import { AdminQueryError } from "@/components/admin/AdminQueryError";
import { useAdminRefundBreakdown } from "@/lib/db/debt-queries";
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

type PaymentsTab = PaymentQueueTab | "fee_payments" | "all";

export const Route = createFileRoute("/admin/payments")({
  component: AdminPaymentsRoute,
  validateSearch: (search: Record<string, unknown>): { tab?: PaymentsTab; status?: string } => {
    const tab = search.tab;
    const allowed: PaymentsTab[] = [
      "needs_action",
      "refunds_due",
      "receipts_ready",
      "cash_to_confirm",
      "fee_payments",
      "all",
    ];
    return {
      tab:
        typeof tab === "string" && allowed.includes(tab as PaymentsTab)
          ? (tab as PaymentsTab)
          : "needs_action",
      ...(typeof search.status === "string" ? { status: search.status } : {}),
    };
  },
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
  // The customer's cancellation fee (if any) stays with the provider, and earlier unpaid fees
  // the booking carried stay with Famy for theirs; only the rest is refunded.
  const refundFee = useAdminRefundBreakdown(p.id, refundSheet);
  const feeAmount = refundFee.data?.fee ?? 0;
  const carriedAmount = refundFee.data?.carried ?? 0;
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
                    carriedAmount > 0
                      ? t("admin.paymentSituation.refundCarriedNote", {
                          amount: formatEGP(carriedAmount),
                        })
                      : "",
                    t(
                      isTransfer
                        ? "admin.paymentSituation.recordRefundHintTransfer"
                        : "admin.paymentSituation.recordRefundHint",
                      { amount: formatEGP(refundFee.data?.refund ?? 0) },
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
const PAYMENT_TABS: {
  key: PaymentsTab;
  labelKey: string;
  countKey?: "needs_action" | "refunds_due" | "receipts_ready" | "cash_to_confirm" | "fee_payments";
}[] = [
  { key: "needs_action", labelKey: "admin.paymentsQueue.needsAction", countKey: "needs_action" },
  { key: "refunds_due", labelKey: "admin.paymentsQueue.refunds", countKey: "refunds_due" },
  { key: "receipts_ready", labelKey: "admin.paymentsQueue.receipts", countKey: "receipts_ready" },
  { key: "cash_to_confirm", labelKey: "admin.paymentsQueue.cash", countKey: "cash_to_confirm" },
  { key: "fee_payments", labelKey: "admin.paymentsQueue.fees", countKey: "fee_payments" },
  { key: "all", labelKey: "admin.paymentsQueue.all" },
];

function useDebounced(value: string, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function AdminPayments({ search }: { search: { tab?: PaymentsTab; status?: string } }) {
  const { t } = useTranslation();
  const tab = search.tab ?? "needs_action";
  const [page, setPage] = useState(0);
  const [allPage, setAllPage] = useState(0);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounced(query, 300);
  const [allStatus, setAllStatus] = useState(search.status ?? "");
  const counts = useAdminPaymentQueueCounts();
  const queueTab: PaymentQueueTab | null =
    tab === "needs_action" ||
    tab === "refunds_due" ||
    tab === "receipts_ready" ||
    tab === "cash_to_confirm"
      ? tab
      : null;
  const queue = useAdminPaymentQueue(
    queueTab ?? "needs_action",
    page,
    debouncedQuery,
    50,
    queueTab != null,
  );
  useEffect(() => {
    setPage(0);
    setAllPage(0);
  }, [debouncedQuery, tab]);
  const allQ = useAdminPaymentsList(debouncedQuery, allStatus, allPage);
  const paymentRows =
    tab === "all"
      ? (allQ.data?.items ?? [])
      : tab === "fee_payments"
        ? []
        : (queue.data?.items ?? []);
  const cashLedger = useAdminCashLedgerBookings(
    paymentRows
      .filter((p: any) => p.booking?.status === "completed" && p.status !== "captured")
      .map((p: any) => p.booking_id),
  );
  const recorded = cashLedger.data ?? new Set<string>();
  const needsTotal = counts.data?.needs_action ?? 0;
  const loading =
    tab === "all" ? allQ.isLoading : tab === "fee_payments" ? counts.isLoading : queue.isLoading;
  const error =
    tab === "all" ? allQ.isError : tab === "fee_payments" ? counts.isError : queue.isError;
  const refetch =
    tab === "all"
      ? () => allQ.refetch()
      : tab === "fee_payments"
        ? () => counts.refetch()
        : () => queue.refetch();

  return (
    <div className={adminScreen}>
      <h1 className="text-xl font-bold">{t("admin.paymentsQueue.title")}</h1>
      <p className="text-sm text-muted-foreground">{t("admin.paymentsQueue.subtitle")}</p>
      {needsTotal > 0 ? (
        <p className="rounded-xl bg-amber-500/15 px-3 py-2 text-sm font-bold text-amber-800 dark:text-amber-200">
          {t("admin.paymentSituation.needsAction", { count: needsTotal })}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {PAYMENT_TABS.map(({ key, labelKey, countKey }) => {
          const n = countKey && counts.data ? Number(counts.data[countKey] ?? 0) : 0;
          return (
            <Link
              key={key}
              to="/admin/payments"
              search={{ tab: key }}
              className={`${adminControl} ${tab === key ? "bg-brand text-brand-foreground" : ""}`}
            >
              {t(labelKey)}
              {n > 0 ? ` (${n.toLocaleString("en-US")})` : ""}
            </Link>
          );
        })}
      </div>
      {tab === "fee_payments" ? (
        <FeeDebtsPanel />
      ) : tab === "all" ? (
        <>
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
                type="button"
                className={`${adminControl} ${allStatus === s ? "bg-brand text-brand-foreground" : ""}`}
                onClick={() => setAllStatus(s)}
              >
                {s ? paymentStatusLabel(s, t) : t("adminOps.allPayments")}
              </button>
            ))}
          </div>
        </>
      ) : (
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("adminOps.search")}
          aria-label={t("adminOps.search")}
          className="min-h-11 w-full rounded-xl border bg-surface px-3 text-sm"
        />
      )}
      {loading ? (
        <p>{t("adminOps.loading")}</p>
      ) : error ? (
        <AdminQueryError message={t("adminOps.loadError")} onRetry={refetch} />
      ) : tab === "fee_payments" ? null : !paymentRows.length ? (
        <p>{t("admin.payments.noResults")}</p>
      ) : (
        <>
          <ul className="grid gap-4 lg:grid-cols-2">
            {paymentRows.map((p: any) => (
              <PaymentCard key={p.id} payment={p} cashRecorded={recorded.has(p.booking_id)} />
            ))}
          </ul>
          {tab === "all" && (allQ.data?.total ?? 0) > (allPage + 1) * 50 ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={adminControl}
                disabled={allPage === 0}
                onClick={() => setAllPage((p) => Math.max(0, p - 1))}
              >
                {t("admin.auditLog.prev")}
              </button>
              <button
                type="button"
                className={adminControl}
                onClick={() => setAllPage((p) => p + 1)}
              >
                {t("admin.auditLog.next")}
              </button>
            </div>
          ) : tab !== "all" && (queue.data?.total ?? 0) > (page + 1) * 50 ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={adminControl}
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                {t("admin.auditLog.prev")}
              </button>
              <button
                type="button"
                className={adminControl}
                onClick={() => setPage((p) => p + 1)}
              >
                {t("admin.auditLog.next")}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
function AdminPaymentsRoute() {
  return <AdminPayments search={Route.useSearch()} />;
}
