import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { formatEGP } from "@/lib/format/egp";
import { adminErrorText } from "@/lib/admin/adminErrorText";
import { adminDate } from "@/components/admin/adminPresentation";
import { AdminConfirmModal } from "@/components/admin/AdminConfirmModal";
import { AdminQueryError } from "@/components/admin/AdminQueryError";
import { AdminLink as Link } from "@/components/admin/AdminNavigation";
import { bookingCode } from "@/components/admin/operations";
import {
  type WalletCategory,
  WALLET_CATEGORIES,
  useAdminCustomerWalletHistory,
  useAdminWalletAdjust,
} from "@/lib/db/admin-wallet-ops-queries";

const PAGE_SIZE = 20;

/** Customer page: balance, add / deduct, and the full wallet history. */
export function AdminWalletPanel({
  customerId,
  customerName,
}: {
  customerId: string;
  customerName: string;
}) {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(0);
  const q = useAdminCustomerWalletHistory(customerId, page, PAGE_SIZE);
  const [direction, setDirection] = useState<"credit" | "debit" | null>(null);
  const egp = (n: number) => formatEGP(n, undefined, i18n.language);

  return (
    <section
      className="rounded-2xl border border-border/60 bg-surface p-4 shadow-sm"
      aria-label={t("adminWallet.title")}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-extrabold">{t("adminWallet.title")}</h3>
          <p className="text-xl font-extrabold tabular-nums">
            {q.data ? egp(q.data.balance) : "—"}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setDirection("credit")}
            className="focus-ring rounded-lg bg-brand px-3 py-2 text-xs font-bold text-brand-foreground"
          >
            {t("adminWallet.add")}
          </button>
          <button
            type="button"
            onClick={() => setDirection("debit")}
            disabled={!q.data || q.data.balance <= 0}
            className="focus-ring rounded-lg border border-border px-3 py-2 text-xs font-bold disabled:opacity-50"
          >
            {t("adminWallet.deduct")}
          </button>
        </div>
      </div>

      <h4 className="mt-4 text-xs font-bold text-muted-foreground">{t("adminWallet.history")}</h4>
      {q.isLoading ? (
        <p className="py-2 text-xs text-muted-foreground">{t("common.loading")}</p>
      ) : q.isError || !q.data ? (
        <AdminQueryError
          compact
          message={t("adminWallet.loadError")}
          error={q.error}
          onRetry={() => q.refetch()}
        />
      ) : q.data.items.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">{t("adminWallet.empty")}</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[640px] text-start text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border/60">
                <th className="py-2 pe-2 text-start font-semibold">{t("adminWallet.col.date")}</th>
                <th className="py-2 pe-2 text-start font-semibold">{t("adminWallet.col.move")}</th>
                <th className="py-2 pe-2 text-end font-semibold">{t("adminWallet.col.amount")}</th>
                <th className="py-2 pe-2 text-end font-semibold">
                  {t("adminWallet.col.balanceAfter")}
                </th>
                <th className="py-2 pe-2 text-start font-semibold">{t("adminWallet.col.by")}</th>
                <th className="py-2 pe-2 text-start font-semibold">
                  {t("adminWallet.col.reason")}
                </th>
                <th className="py-2 text-start font-semibold">{t("adminWallet.col.booking")}</th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((e) => (
                <tr key={e.id} className="border-b border-border/40 align-top">
                  <td className="py-2 pe-2 whitespace-nowrap">
                    {adminDate(e.created_at, i18n.language)}
                  </td>
                  <td className="py-2 pe-2">
                    {t(`adminWallet.reason.${e.reason}`, {
                      defaultValue: t("adminWallet.reason.other"),
                    })}
                  </td>
                  <td
                    className={`py-2 pe-2 text-end font-bold tabular-nums ${e.direction === "credit" ? "text-success" : ""}`}
                  >
                    {e.direction === "credit" ? "+" : "-"}
                    {egp(e.amount)}
                  </td>
                  <td className="py-2 pe-2 text-end tabular-nums">{egp(e.balance_after)}</td>
                  <td className="py-2 pe-2">{e.admin_name ?? t("adminWallet.automatic")}</td>
                  <td className="py-2 pe-2 max-w-[16rem] break-words">
                    {e.category ? (
                      <span className="block font-semibold">
                        {t(`adminWallet.category.${e.category}`)}
                      </span>
                    ) : null}
                    {e.note ? <span className="block text-muted-foreground">{e.note}</span> : null}
                  </td>
                  <td className="py-2">
                    {e.booking_id ? (
                      <Link
                        to={"/admin/bookings" as const}
                        search={{ booking: e.booking_id } as never}
                        className="font-mono text-brand hover:underline"
                      >
                        <bdi dir="ltr">{bookingCode(e.booking_id)}</bdi>
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {q.data.total > PAGE_SIZE ? (
            <div className="mt-2 flex items-center justify-between text-xs">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="focus-ring rounded-lg border border-border px-3 py-1.5 font-semibold disabled:opacity-50"
              >
                {t("adminWallet.newer")}
              </button>
              <span className="text-muted-foreground tabular-nums">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, q.data.total)} /{" "}
                {q.data.total}
              </span>
              <button
                type="button"
                disabled={(page + 1) * PAGE_SIZE >= q.data.total}
                onClick={() => setPage((p) => p + 1)}
                className="focus-ring rounded-lg border border-border px-3 py-1.5 font-semibold disabled:opacity-50"
              >
                {t("adminWallet.older")}
              </button>
            </div>
          ) : null}
        </div>
      )}

      {direction ? (
        <WalletAdjustModal
          customerId={customerId}
          customerName={customerName}
          direction={direction}
          balance={q.data?.balance ?? 0}
          onClose={() => setDirection(null)}
        />
      ) : null}
    </section>
  );
}

function WalletAdjustModal({
  customerId,
  customerName,
  direction,
  balance,
  onClose,
}: {
  customerId: string;
  customerName: string;
  direction: "credit" | "debit";
  balance: number;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const adjust = useAdminWalletAdjust();
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<WalletCategory | null>(null);
  const [note, setNote] = useState("");
  const key = useRef(crypto.randomUUID());
  const egp = (n: number) => formatEGP(n, undefined, i18n.language);
  const value = Number(amount);
  const amountOk =
    Number.isFinite(value) && value > 0 && (direction === "credit" || value <= balance);
  const noteOk = category !== "other" || note.trim().length > 0;
  const ready = amountOk && !!category && noteOk;

  return (
    <AdminConfirmModal
      open
      title={
        direction === "credit"
          ? t("adminWallet.addTitle", { name: customerName })
          : t("adminWallet.deductTitle", { name: customerName })
      }
      confirmLabel={
        amountOk
          ? t(direction === "credit" ? "adminWallet.confirmAdd" : "adminWallet.confirmDeduct", {
              amount: egp(value),
            })
          : direction === "credit"
            ? t("adminWallet.add")
            : t("adminWallet.deduct")
      }
      destructive={direction === "debit"}
      confirmDisabled={!ready}
      busy={adjust.isPending}
      onCancel={onClose}
      onConfirm={() =>
        adjust.mutate(
          {
            customerId,
            direction,
            amount: value,
            category: category!,
            note,
            idempotencyKey: key.current,
          },
          {
            onSuccess: () => {
              toast.success(
                t(direction === "credit" ? "adminWallet.addSuccess" : "adminWallet.deductSuccess", {
                  amount: egp(value),
                }),
              );
              onClose();
            },
            onError: (e) => toast.error(adminErrorText(t, e, t("adminWallet.error"))),
          },
        )
      }
    >
      <div className="mt-3 grid gap-2">
        <label className="text-xs font-semibold" htmlFor="wallet-adjust-amount">
          {t("adminWallet.amount")}
        </label>
        <input
          id="wallet-adjust-amount"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          dir="ltr"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="h-10 rounded-lg border border-border bg-surface px-3 text-sm"
        />
        {direction === "debit" ? (
          <p
            className={`text-xs ${Number.isFinite(value) && value > balance ? "text-coral" : "text-muted-foreground"}`}
          >
            {t("adminWallet.balanceNow", { amount: egp(balance) })}
          </p>
        ) : null}
        <span className="text-xs font-semibold">{t("adminWallet.category.label")}</span>
        <div
          className="flex flex-wrap gap-2"
          role="radiogroup"
          aria-label={t("adminWallet.category.label")}
        >
          {WALLET_CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={category === c}
              onClick={() => setCategory(c)}
              className={`focus-ring rounded-full border px-3 py-1.5 text-xs font-semibold ${
                category === c ? "border-brand bg-brand/10 text-brand" : "border-border"
              }`}
            >
              {t(`adminWallet.category.${c}`)}
            </button>
          ))}
        </div>
        <label className="text-xs font-semibold" htmlFor="wallet-adjust-note">
          {category === "other" ? t("adminWallet.noteRequired") : t("adminWallet.note")}
        </label>
        <textarea
          id="wallet-adjust-note"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("adminWallet.notePlaceholder")}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
        />
      </div>
    </AdminConfirmModal>
  );
}
