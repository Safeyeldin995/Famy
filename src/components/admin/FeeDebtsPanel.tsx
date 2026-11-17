import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { formatEGP } from "@/lib/utils";
import { useAdminDebtActions, useAdminFeeDebts } from "@/lib/db/debt-queries";
import { AdminReasonSheet } from "@/components/admin/AdminReasonSheet";
import { AdminQueryError } from "@/components/admin/AdminQueryError";
import { adminDate } from "@/components/admin/adminPresentation";
import { bookingCode } from "@/components/admin/operations";
import { useLang } from "@/components/famio/LanguageToggle";
import { getSignedProofUrl } from "@/lib/db/payment-queries";

const btn = "focus-ring min-h-11 rounded-xl px-4 text-sm font-bold disabled:opacity-50";

/**
 * Unpaid cancellation fees owed by customers (cash bookings). They are added to the
 * customer's next booking; InstaPay receipts for paying them on their own wait here for
 * confirmation; free debts can be waived. Hidden when there is nothing.
 */
export function FeeDebtsPanel() {
  const { t } = useTranslation();
  const lang = useLang();
  const q = useAdminFeeDebts();
  const { review, waive, refundOverpayment } = useAdminDebtActions();
  const [sheet, setSheet] = useState<{ kind: "reject" | "waive" | "refund"; id: string } | null>(
    null,
  );
  const busy = review.isPending || waive.isPending || refundOverpayment.isPending;
  const openReceipt = async (path: string) => {
    try {
      window.open(await getSignedProofUrl(path), "_blank", "noopener,noreferrer");
    } catch {
      toast.error(t("admin.feeDebts.receiptError"));
    }
  };

  if (q.isError)
    return <AdminQueryError message={t("admin.feeDebts.loadError")} onRetry={() => q.refetch()} />;
  const data = q.data;
  if (
    !data ||
    (data.settlements.length === 0 && data.debts.length === 0 && data.overpaid.length === 0)
  )
    return null;

  const fail = () => toast.error(t("admin.feeDebts.failed"));
  const ok = () => {
    setSheet(null);
    toast.success(t("adminOps.saved"));
  };

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-surface p-4">
      <div>
        <h2 className="text-base font-extrabold">{t("admin.feeDebts.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("admin.feeDebts.subtitle")}</p>
      </div>

      {data.settlements.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-extrabold">{t("admin.feeDebts.toReview")}</h3>
          <ul className="divide-y divide-border/50 rounded-xl border border-border text-sm">
            {data.settlements.map((s) => (
              <li key={s.id} className="space-y-2 px-3 py-3">
                <p className="font-bold">
                  {t("admin.feeDebts.instapayLine", {
                    name: s.customer_name || "—",
                    amount: formatEGP(s.amount),
                  })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {adminDate(s.created_at, lang, false)}
                  {s.instapay_reference ? (
                    <>
                      {" · "}
                      {t("admin.feeDebts.reference")}{" "}
                      <bdi dir="ltr" className="font-bold text-foreground">
                        {s.instapay_reference}
                      </bdi>
                    </>
                  ) : null}
                </p>
                <p className="text-xs text-muted-foreground">{t("admin.feeDebts.checkHint")}</p>
                <div className="flex flex-wrap gap-2">
                  {s.proof_path ? (
                    <button
                      type="button"
                      className={`${btn} border border-border`}
                      onClick={() => void openReceipt(s.proof_path!)}
                    >
                      {t("admin.feeDebts.viewReceipt")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy}
                    className={`${btn} bg-brand text-brand-foreground`}
                    onClick={() =>
                      review.mutate({ id: s.id, approve: true }, { onSuccess: ok, onError: fail })
                    }
                  >
                    {t("admin.feeDebts.confirm")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className={`${btn} border border-border`}
                    onClick={() => setSheet({ kind: "reject", id: s.id })}
                  >
                    {t("admin.feeDebts.reject")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {data.overpaid.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-extrabold text-destructive">
            {t("admin.feeDebts.overpaid")}
          </h3>
          <ul className="divide-y divide-border/50 rounded-xl border border-border text-sm">
            {data.overpaid.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-3"
              >
                <p className="min-w-0 font-bold">
                  {t("admin.feeDebts.overpaidLine", {
                    name: s.customer_name || "—",
                    amount: formatEGP(s.refund_amount ?? s.amount),
                  })}
                </p>
                <button
                  type="button"
                  disabled={busy}
                  className={`${btn} bg-brand text-brand-foreground`}
                  onClick={() => setSheet({ kind: "refund", id: s.id })}
                >
                  {t("admin.feeDebts.recordRefund")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {data.debts.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-extrabold">{t("admin.feeDebts.open")}</h3>
          <ul className="divide-y divide-border/50 rounded-xl border border-border text-sm">
            {data.debts.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-3"
              >
                <div className="min-w-0">
                  <p className="font-bold">
                    {d.customer_name || "—"} · {formatEGP(d.amount)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t(`admin.feeDebts.kind.${d.kind}`)} · {t("adminOps.booking")}{" "}
                    <bdi dir="ltr">{bookingCode(d.booking_id)}</bdi> ·{" "}
                    {adminDate(d.created_at, lang, false)}
                  </p>
                  {d.carried_booking_id ? (
                    <p className="text-xs text-muted-foreground">
                      {t("admin.feeDebts.carriedOn")}{" "}
                      <bdi dir="ltr">{bookingCode(d.carried_booking_id)}</bdi>
                    </p>
                  ) : null}
                </div>
                {/* The database refuses a fee the customer is paying with an active booking. */}
                <button
                  type="button"
                  disabled={busy}
                  className={`${btn} border border-border`}
                  onClick={() => setSheet({ kind: "waive", id: d.id })}
                >
                  {t("admin.feeDebts.waive")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {sheet ? (
        <AdminReasonSheet
          title={t(`admin.feeDebts.${sheet.kind === "refund" ? "recordRefund" : sheet.kind}`)}
          description={t(
            sheet.kind === "reject"
              ? "admin.feeDebts.rejectHint"
              : sheet.kind === "refund"
                ? "admin.feeDebts.recordRefundHint"
                : "admin.feeDebts.waiveHint",
          )}
          fieldLabel={
            sheet.kind === "refund" ? t("admin.paymentSituation.refundReference") : undefined
          }
          busy={busy}
          onClose={() => setSheet(null)}
          onConfirm={(reason) =>
            sheet.kind === "reject"
              ? review.mutate(
                  { id: sheet.id, approve: false, reason },
                  { onSuccess: ok, onError: fail },
                )
              : sheet.kind === "refund"
                ? refundOverpayment.mutate(
                    { id: sheet.id, reference: reason },
                    { onSuccess: ok, onError: fail },
                  )
                : waive.mutate({ id: sheet.id, reason }, { onSuccess: ok, onError: fail })
          }
        />
      ) : null}
    </section>
  );
}
