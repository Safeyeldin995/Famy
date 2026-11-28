import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AdminLink as Link } from "@/components/admin/AdminNavigation";
import { AdminQueryError } from "@/components/admin/AdminQueryError";
import { adminDate } from "@/components/admin/adminPresentation";
import { bookingCode } from "@/components/admin/operations";
import { useAdminWalletLedger } from "@/lib/db/admin-wallet-ops-queries";
import { formatEGP } from "@/lib/format/egp";

export const Route = createFileRoute("/admin/wallets")({ component: AdminWalletsRoute });

const PAGE_SIZE = 50;
const REASONS = [
  "admin_credit",
  "admin_debit",
  "admin_lesson_refund",
  "first_lesson_guarantee",
  "first_lesson_guarantee_reversal",
  "provider_cancelled",
  "customer_cancelled_refund",
  "online_no_show_refund",
  "checkout_spend",
  "checkout_release",
  "paymob_superseded_capture",
  "forfeited_on_deletion",
];

/** Cairo midnight of a yyyy-mm-dd date, as an ISO string. */
function cairoDayStart(day: string): string {
  return new Date(`${day}T00:00:00+02:00`).toISOString();
}

function AdminWalletsRoute() {
  const { t, i18n } = useTranslation();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [adminId, setAdminId] = useState("");
  const [reason, setReason] = useState("");
  const [page, setPage] = useState(0);
  const egp = (n: number) => formatEGP(n, undefined, i18n.language);

  const filters = useMemo(
    () => ({
      from: from ? cairoDayStart(from) : null,
      to: to ? new Date(new Date(cairoDayStart(to)).getTime() + 86_400_000).toISOString() : null,
      adminId: adminId || null,
      reason: reason || null,
    }),
    [from, to, adminId, reason],
  );
  const q = useAdminWalletLedger(filters, page, PAGE_SIZE);
  const reset = (fn: () => void) => {
    fn();
    setPage(0);
  };
  const field = "h-10 rounded-lg border border-border bg-surface px-3 text-sm";

  return (
    <main className="space-y-4 px-4 py-5 sm:px-6">
      <h1 className="text-xl font-extrabold">{t("adminWallet.ledgerTitle")}</h1>

      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs font-semibold">
          {t("adminWallet.filters.from")}
          <input
            type="date"
            dir="ltr"
            value={from}
            onChange={(e) => reset(() => setFrom(e.target.value))}
            className={field}
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          {t("adminWallet.filters.to")}
          <input
            type="date"
            dir="ltr"
            value={to}
            onChange={(e) => reset(() => setTo(e.target.value))}
            className={field}
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          {t("adminWallet.filters.admin")}
          <select
            value={adminId}
            onChange={(e) => reset(() => setAdminId(e.target.value))}
            className={field}
          >
            <option value="">{t("adminWallet.filters.all")}</option>
            {(q.data?.admins ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name ?? "—"}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          {t("adminWallet.filters.reason")}
          <select
            value={reason}
            onChange={(e) => reset(() => setReason(e.target.value))}
            className={field}
          >
            <option value="">{t("adminWallet.filters.all")}</option>
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {t(`adminWallet.reason.${r}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {q.isError ? (
        <AdminQueryError
          message={t("adminWallet.loadError")}
          error={q.error}
          onRetry={() => q.refetch()}
        />
      ) : q.isLoading || !q.data ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : (
        <>
          <p className="text-sm font-semibold">
            {t("adminWallet.totals", {
              credits: egp(q.data.credits),
              debits: egp(q.data.debits),
              count: q.data.total,
            })}
          </p>
          {q.data.items.length === 0 ? (
            <p className="rounded-2xl border border-border bg-surface p-5 text-center text-sm">
              {t("adminWallet.empty")}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
              <table className="w-full min-w-[760px] text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border/60">
                    <th className="px-3 py-2 text-start font-semibold">
                      {t("adminWallet.col.date")}
                    </th>
                    <th className="px-3 py-2 text-start font-semibold">
                      {t("adminWallet.col.customer")}
                    </th>
                    <th className="px-3 py-2 text-start font-semibold">
                      {t("adminWallet.col.move")}
                    </th>
                    <th className="px-3 py-2 text-end font-semibold">
                      {t("adminWallet.col.amount")}
                    </th>
                    <th className="px-3 py-2 text-start font-semibold">
                      {t("adminWallet.col.by")}
                    </th>
                    <th className="px-3 py-2 text-start font-semibold">
                      {t("adminWallet.col.reason")}
                    </th>
                    <th className="px-3 py-2 text-start font-semibold">
                      {t("adminWallet.col.booking")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.items.map((e) => (
                    <tr key={e.id} className="border-b border-border/40 align-top">
                      <td className="whitespace-nowrap px-3 py-2">
                        {adminDate(e.created_at, i18n.language)}
                      </td>
                      <td className="px-3 py-2">
                        <Link
                          to="/admin/customer/$id"
                          params={{ id: e.customer_id }}
                          className="font-semibold text-brand hover:underline"
                        >
                          {e.customer_name ?? "—"}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        {t(`adminWallet.reason.${e.reason}`, {
                          defaultValue: t("adminWallet.reason.other"),
                        })}
                      </td>
                      <td
                        className={`px-3 py-2 text-end font-bold tabular-nums ${e.direction === "credit" ? "text-success" : ""}`}
                      >
                        {e.direction === "credit" ? "+" : "-"}
                        {egp(e.amount)}
                      </td>
                      <td className="px-3 py-2">{e.admin_name ?? t("adminWallet.automatic")}</td>
                      <td className="max-w-[16rem] break-words px-3 py-2">
                        {e.category ? (
                          <span className="block font-semibold">
                            {t(`adminWallet.category.${e.category}`)}
                          </span>
                        ) : null}
                        {e.note ? (
                          <span className="block text-muted-foreground">{e.note}</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
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
            </div>
          )}
          {q.data.total > PAGE_SIZE ? (
            <div className="flex items-center justify-between text-xs">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="focus-ring rounded-lg border border-border px-3 py-1.5 font-semibold disabled:opacity-50"
              >
                {t("adminWallet.newer")}
              </button>
              <span className="tabular-nums text-muted-foreground">
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
        </>
      )}
    </main>
  );
}
