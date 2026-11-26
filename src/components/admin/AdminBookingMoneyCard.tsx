import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { formatEGP } from "@/lib/format/egp";
import { paymentStatusLabel } from "@/lib/settlement/moneyText";
import { adminErrorText } from "@/lib/admin/adminErrorText";
import { adminDate } from "@/components/admin/adminPresentation";
import { AdminConfirmModal } from "@/components/admin/AdminConfirmModal";
import { AdminQueryError } from "@/components/admin/AdminQueryError";
import {
  type AdminBookingMoneySummary,
  type AdminMoneyPayment,
  useAdminBookingMoney,
  useAdminRefundBookingToWallet,
} from "@/lib/db/admin-wallet-ops-queries";
import { bookingMoneyView } from "@/lib/admin/bookingMoneyView";

function Row({
  label,
  value,
  strong = false,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "good" | "warn" | "muted";
}) {
  const toneClass =
    tone === "good"
      ? "text-success"
      : tone === "warn"
        ? "text-coral"
        : tone === "muted"
          ? "text-muted-foreground"
          : "";
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={`text-sm tabular-nums ${strong ? "font-extrabold" : "font-semibold"} ${toneClass}`}
      >
        {value}
      </dd>
    </div>
  );
}

export function methodLabel(t: (k: string) => string, p: Pick<AdminMoneyPayment, "method_type">) {
  const key = p.method_type ?? "unknown";
  return t(
    `adminMoney.method.${["online", "manual_transfer", "cash"].includes(key) ? key : "unknown"}`,
  );
}

/** One readable card with everything about a booking's money. */
export function AdminBookingMoneyCard({
  bookingId,
  customerId,
}: {
  bookingId: string;
  customerId: string;
}) {
  const { t, i18n } = useTranslation();
  const q = useAdminBookingMoney(bookingId);
  const egp = (n: number) => formatEGP(n, undefined, i18n.language);

  if (q.isLoading) {
    return <p className="py-2 text-xs text-muted-foreground">{t("common.loading")}</p>;
  }
  if (q.isError || !q.data) {
    return (
      <AdminQueryError
        compact
        message={t("adminMoney.loadError")}
        error={q.error}
        onRetry={() => q.refetch()}
      />
    );
  }
  return <MoneyCardBody data={q.data} customerId={customerId} egp={egp} />;
}

function MoneyCardBody({
  data,
  customerId,
  egp,
}: {
  data: AdminBookingMoneySummary;
  customerId: string;
  egp: (n: number) => string;
}) {
  const { t, i18n } = useTranslation();
  const view = useMemo(() => bookingMoneyView(data), [data]);
  const terms = data.refund_terms;
  const [open, setOpen] = useState(false);

  return (
    <section
      aria-label={t("adminMoney.title")}
      className="mt-3 rounded-xl border border-border/60 bg-surface p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-extrabold">{t("adminMoney.title")}</h4>
        {view.payment ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold">
            {methodLabel(t, view.payment)} · {paymentStatusLabel(view.payment.status, t)}
          </span>
        ) : (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold">
            {view.isCash ? t("adminMoney.method.cash") : t("adminMoney.notPaidYet")}
          </span>
        )}
      </div>

      <dl className="mt-2 divide-y divide-border/40">
        <Row label={t("adminMoney.price")} value={egp(data.price_total)} />
        {data.price_discount > 0 ? (
          <Row
            label={t("adminMoney.discount")}
            value={`- ${egp(data.price_discount)}`}
            tone="muted"
          />
        ) : null}
        {data.carried_fees_amount > 0 ? (
          <Row
            label={t("adminMoney.carriedFees")}
            value={egp(data.carried_fees_amount)}
            tone="muted"
          />
        ) : null}
        <Row
          label={t("adminMoney.paid")}
          value={
            view.paid > 0
              ? egp(view.paid)
              : view.isCash
                ? t("adminMoney.cashWithTutor")
                : t("adminMoney.notPaidYet")
          }
          strong
        />
        {view.walletApplied > 0 ? (
          <Row label={t("adminMoney.fromWallet")} value={egp(view.walletApplied)} tone="muted" />
        ) : null}
        {data.commission_amount != null ? (
          <Row
            label={
              data.commission_percent != null
                ? t("adminMoney.commissionPercent", { percent: data.commission_percent })
                : t("adminMoney.commission")
            }
            value={egp(data.commission_amount)}
          />
        ) : null}
        {data.provider_net != null ? (
          <Row label={t("adminMoney.tutorShare")} value={egp(data.provider_net)} />
        ) : null}
        {view.refunded > 0 ? (
          <Row label={t("adminMoney.refunded")} value={egp(view.refunded)} tone="good" />
        ) : null}
        {view.feeToTutor > 0 ? (
          <Row label={t("adminMoney.feeToTutor")} value={egp(view.feeToTutor)} tone="muted" />
        ) : null}
        {terms.max_refundable > 0 ? (
          <Row label={t("adminMoney.heldNow")} value={egp(terms.max_refundable)} tone="warn" />
        ) : null}
      </dl>

      {data.wallet_entries.length > 0 ? (
        <div className="mt-2">
          <p className="text-xs font-bold text-muted-foreground">{t("adminMoney.walletMoves")}</p>
          <ul className="mt-1 space-y-1">
            {data.wallet_entries.map((e) => (
              <li key={e.id} className="flex items-baseline justify-between gap-2 text-xs">
                <span className="min-w-0 truncate">
                  {t(`adminWallet.reason.${e.reason}`, {
                    defaultValue: t("adminWallet.reason.other"),
                  })}
                  {e.admin_name ? ` · ${e.admin_name}` : ""}
                  {" · "}
                  <span className="text-muted-foreground">
                    {adminDate(e.created_at, i18n.language)}
                  </span>
                </span>
                <span
                  className={`shrink-0 font-bold tabular-nums ${e.direction === "credit" ? "text-success" : ""}`}
                >
                  {e.direction === "credit" ? "+" : "-"}
                  {egp(Number(e.amount))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!!terms.blocked}
          onClick={() => setOpen(true)}
          className="focus-ring rounded-lg bg-brand px-3 py-1.5 text-xs font-bold text-brand-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("adminMoney.refundAction")}
        </button>
        {terms.blocked ? (
          <span className="text-xs text-muted-foreground">
            {t(`adminMoney.blocked.${terms.blocked}`, {
              defaultValue: t("adminMoney.blocked.no_held_money"),
            })}
          </span>
        ) : null}
      </div>

      {open ? (
        <RefundToWalletModal
          data={data}
          customerId={customerId}
          egp={egp}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </section>
  );
}

function RefundToWalletModal({
  data,
  customerId,
  egp,
  onClose,
}: {
  data: AdminBookingMoneySummary;
  customerId: string;
  egp: (n: number) => string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const terms = data.refund_terms;
  const refund = useAdminRefundBookingToWallet();
  const [amount, setAmount] = useState(String(terms.max_refundable));
  const [note, setNote] = useState("");
  const key = useRef(crypto.randomUUID());
  const value = Number(amount);
  const invalidAmount = !Number.isFinite(value) || value <= 0 || value > terms.max_refundable;
  const missingNote = note.trim().length === 0;

  return (
    <AdminConfirmModal
      open
      title={t("adminMoney.refundTitle")}
      confirmLabel={
        invalidAmount
          ? t("adminMoney.refundAction")
          : t("adminMoney.refundConfirm", { amount: egp(value) })
      }
      confirmDisabled={invalidAmount || missingNote}
      busy={refund.isPending}
      onCancel={onClose}
      onConfirm={() =>
        refund.mutate(
          {
            bookingId: data.booking_id,
            customerId,
            amount: value,
            note: note.trim(),
            idempotencyKey: key.current,
          },
          {
            onSuccess: () => {
              toast.success(t("adminMoney.refundSuccess", { amount: egp(value) }));
              onClose();
            },
            onError: (e) => toast.error(adminErrorText(t, e, t("adminMoney.refundError"))),
          },
        )
      }
    >
      <div className="mt-3 grid gap-2">
        <label className="text-xs font-semibold" htmlFor="wallet-refund-amount">
          {t("adminMoney.refundAmount")}
        </label>
        <input
          id="wallet-refund-amount"
          type="number"
          inputMode="decimal"
          min="0"
          max={terms.max_refundable}
          step="0.01"
          dir="ltr"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="h-10 rounded-lg border border-border bg-surface px-3 text-sm"
        />
        <p className="text-xs text-muted-foreground">
          {t("adminMoney.refundMax", { amount: egp(terms.max_refundable) })}
          {terms.mode === "cancelled" && terms.cancellation_fee > 0
            ? ` · ${t("adminMoney.refundFeeHint", { amount: egp(terms.cancellation_fee) })}`
            : ""}
          {terms.mode === "completed" ? ` · ${t("adminMoney.refundCompletedHint")}` : ""}
        </p>
        <label className="text-xs font-semibold" htmlFor="wallet-refund-note">
          {t("adminMoney.refundNote")}
        </label>
        <textarea
          id="wallet-refund-note"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("adminMoney.refundNotePlaceholder")}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
        />
      </div>
    </AdminConfirmModal>
  );
}
