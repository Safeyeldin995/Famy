import { AdminLink as Link } from "@/components/admin/AdminNavigation";
import { adminDate, adminLabel } from "@/components/admin/adminPresentation";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { paymentStatusLabel } from "@/lib/settlement/moneyText";
import {
  useAdminAdjustCustomerWallet,
  useAdminCustomer,
  useAdminCustomerWallet,
  useSetCustomerSuspended,
} from "@/lib/db/admin-queries";
import { ChevronLeft, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { AdminQueryError } from "@/components/admin/AdminQueryError";
import { bookingAmountDue } from "@/lib/payments/amountDue";
export const Route = createFileRoute("/admin/customer/$id")({ component: AdminCustomerRoute });

export function AdminCustomer({ id }: { id: string }) {
  const { t, i18n } = useTranslation();
  const q = useAdminCustomer(id);
  const walletQ = useAdminCustomerWallet(id);
  const adjustWallet = useAdminAdjustCustomerWallet();
  const setSuspended = useSetCustomerSuspended();
  const [showConfirm, setShowConfirm] = useState(false);
  const [walletAmount, setWalletAmount] = useState("");
  const [walletReason, setWalletReason] = useState("");

  if (q.isLoading)
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  if (q.isError)
    return (
      <div className="p-6">
        <AdminQueryError
          message={t("admin.customers.loadError")}
          error={q.error}
          onRetry={() => q.refetch()}
        />
      </div>
    );
  const { profile, bookings, payments, parentLink } = q.data ?? {
    profile: null,
    bookings: [],
    payments: [],
    parentLink: null,
  };
  if (!profile)
    return <div className="p-6 text-sm text-muted-foreground">{t("admin.customer.notFound")}</div>;

  const isSuspended = !!profile.is_suspended;
  const toggleSuspend = () => {
    setSuspended.mutate(
      { id, suspended: !isSuspended },
      {
        onSuccess: () => setShowConfirm(false),
        onError: (e: any) => toast.error(e?.message ?? t("admin.customer.suspendError")),
      },
    );
  };

  return (
    <div className="px-5 py-4 space-y-4">
      <Link
        to={"/admin/bookings" as "/admin/bookings"}
        className="focus-ring inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground"
        aria-label={t("common.back")}
      >
        <ChevronLeft className="h-4 w-4" /> {t("common.back")}
      </Link>

      <section className="rounded-2xl border border-border/60 bg-surface p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-extrabold">
              {profile.full_name || t("admin.provider.unnamed")}
            </h2>
            <p dir="ltr" className="text-xs text-muted-foreground">
              {profile.phone}
            </p>
            {profile.email && (
              <p dir="ltr" className="text-xs text-muted-foreground">
                {profile.email}
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              {t("admin.customer.joined", {
                date: adminDate(profile.created_at, i18n.language, false),
              })}
            </p>
            {parentLink && parentLink !== null && typeof parentLink === "object" ? (
              <div className="mt-3 rounded-xl border border-border/60 bg-surface-2 p-3 text-xs">
                <p className="font-extrabold">{t("admin.customer.guardianCardTitle")}</p>
                <p>
                  {t("admin.customer.parentLinkStatus", {
                    status: String((parentLink as { status?: string }).status ?? "—"),
                  })}
                </p>
                {(parentLink as { parent_name?: string }).parent_name ? (
                  <p>{String((parentLink as { parent_name?: string }).parent_name)}</p>
                ) : null}
                <p dir="ltr" className="text-muted-foreground">
                  {t("admin.customer.guardianMaskedContact", {
                    phone: String((parentLink as { parent_phone_masked?: string }).parent_phone_masked ?? "—"),
                    email: String(
                      (parentLink as { parent_email_masked?: string }).parent_email_masked ?? "—",
                    ),
                  })}
                </p>
                {(parentLink as { parent_id?: string }).parent_id ? (
                  <Link
                    to={"/admin/customer/$id"}
                    params={{ id: String((parentLink as { parent_id?: string }).parent_id) }}
                    className="mt-1 inline-block font-semibold text-brand underline"
                  >
                    {t("admin.customer.openParentProfile")}
                  </Link>
                ) : null}
              </div>
            ) : null}
          </div>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold uppercase ${isSuspended ? "bg-coral/10 text-coral" : "bg-mint/20 text-success"}`}
          >
            {isSuspended ? t("admin.providers.suspended") : t("admin.customers.active")}
          </span>
        </div>
        <button
          onClick={() => setShowConfirm(true)}
          disabled={setSuspended.isPending}
          className={`focus-ring mt-4 flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold disabled:opacity-50 ${
            isSuspended ? "bg-brand text-brand-foreground" : "border border-coral text-coral"
          }`}
        >
          <ShieldAlert className="h-4 w-4" />
          {isSuspended ? t("admin.customer.unsuspendAccount") : t("admin.customer.suspendAccount")}
        </button>
      </section>

      <section>
        <h3 className="mb-2 px-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          {t("admin.customer.recentBookings", { count: bookings.length })}
        </h3>
        {bookings.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">{t("admin.customer.noBookings")}</p>
        ) : (
          <ul className="space-y-2">
            {bookings.map((b: any) => (
              <li
                key={b.id}
                className="flex items-center justify-between rounded-xl border border-border/60 bg-surface p-3 text-xs"
              >
                <div>
                  <p className="font-semibold">{adminDate(b.start_at, i18n.language)}</p>
                  <p className="text-muted-foreground">
                    {bookingAmountDue(b)} {i18n.language.startsWith("ar") ? "ج.م" : "EGP"}
                  </p>
                </div>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold uppercase">
                  {t("adminOps.status." + b.status, { defaultValue: t("adminOps.unknown") })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="mb-2 px-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          {t("admin.customer.walletTitle")}
        </h3>
        {walletQ.isLoading ? (
          <p className="px-1 text-xs text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <>
            <p className="px-1 text-sm font-semibold">
              {t("admin.customer.walletBalance", {
                amount: Number(walletQ.data?.available ?? 0).toLocaleString("en-US"),
              })}
            </p>
            {(walletQ.data?.entries ?? []).length === 0 ? (
              <p className="px-1 text-xs text-muted-foreground">{t("admin.customer.walletEmpty")}</p>
            ) : (
              <ul className="space-y-2">
                {(walletQ.data?.entries ?? []).map((entry) => (
                  <li
                    key={entry.id}
                    className="rounded-xl border border-border/60 bg-surface p-3 text-xs"
                  >
                    <p className="font-semibold">
                      {entry.direction === "credit" ? "+" : "-"}
                      {entry.amount} {i18n.language.startsWith("ar") ? "ج.م" : "EGP"} ·{" "}
                      {entry.reason}
                    </p>
                    <p className="text-muted-foreground">{adminDate(entry.created_at, i18n.language)}</p>
                    {entry.metadata?.admin_reason ? (
                      <p className="mt-1 text-muted-foreground">{entry.metadata.admin_reason}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <div className="grid gap-2 rounded-xl border border-border/60 bg-surface p-3">
              <label className="text-xs font-semibold" htmlFor="wallet-amount">
                {t("admin.customer.walletAmount")}
              </label>
              <input
                id="wallet-amount"
                type="number"
                min="0"
                step="0.01"
                value={walletAmount}
                onChange={(e) => setWalletAmount(e.target.value)}
                className="h-10 rounded-xl border border-border bg-surface px-3 text-sm"
              />
              <label className="text-xs font-semibold" htmlFor="wallet-reason">
                {t("admin.customer.walletReason")}
              </label>
              <textarea
                id="wallet-reason"
                rows={2}
                value={walletReason}
                onChange={(e) => setWalletReason(e.target.value)}
                placeholder={t("admin.customer.walletReasonPlaceholder")}
                className="rounded-xl border border-border bg-surface px-3 py-2 text-sm"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={adjustWallet.isPending}
                  onClick={() => {
                    const amount = Number(walletAmount);
                    if (!Number.isFinite(amount) || amount <= 0 || !walletReason.trim()) return;
                    adjustWallet.mutate(
                      {
                        customerId: id,
                        direction: "credit",
                        amount,
                        reasonNote: walletReason.trim(),
                      },
                      {
                        onSuccess: () => {
                          setWalletAmount("");
                          setWalletReason("");
                          toast.success(t("admin.customer.walletAdjustSuccess"));
                        },
                        onError: (e: Error) =>
                          toast.error(e?.message ?? t("admin.customer.walletAdjustError")),
                      },
                    );
                  }}
                  className="focus-ring h-10 flex-1 rounded-xl bg-brand text-xs font-bold text-brand-foreground disabled:opacity-50"
                >
                  {t("admin.customer.walletCredit")}
                </button>
                <button
                  type="button"
                  disabled={adjustWallet.isPending}
                  onClick={() => {
                    const amount = Number(walletAmount);
                    if (!Number.isFinite(amount) || amount <= 0 || !walletReason.trim()) return;
                    adjustWallet.mutate(
                      {
                        customerId: id,
                        direction: "debit",
                        amount,
                        reasonNote: walletReason.trim(),
                      },
                      {
                        onSuccess: () => {
                          setWalletAmount("");
                          setWalletReason("");
                          toast.success(t("admin.customer.walletAdjustSuccess"));
                        },
                        onError: (e: Error) =>
                          toast.error(e?.message ?? t("admin.customer.walletAdjustError")),
                      },
                    );
                  }}
                  className="focus-ring h-10 flex-1 rounded-xl border border-border text-xs font-bold disabled:opacity-50"
                >
                  {t("admin.customer.walletDebit")}
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      <section>
        <h3 className="mb-2 px-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          {t("admin.customer.paymentHistory", { count: payments.length })}
        </h3>
        {payments.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">{t("admin.customer.noPayments")}</p>
        ) : (
          <ul className="space-y-2">
            {payments.map((pay: any) => (
              <li
                key={pay.id}
                className="flex items-center justify-between rounded-xl border border-border/60 bg-surface p-3 text-xs"
              >
                <div>
                  <p className="font-semibold">
                    {(i18n.language.startsWith("ar")
                      ? pay.payment_method_name_ar
                      : pay.payment_method_name_en) || adminLabel(pay.method, i18n.language)}{" "}
                    · {pay.amount} {i18n.language.startsWith("ar") ? "ج.م" : "EGP"}
                  </p>
                  <p className="text-muted-foreground">
                    {adminDate(pay.created_at, i18n.language)}
                  </p>
                </div>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold uppercase">
                  {paymentStatusLabel(pay.status, t)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {showConfirm && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-6"
          onClick={() => setShowConfirm(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="suspend-customer-title"
            className="w-full max-w-sm rounded-3xl bg-surface p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div id="suspend-customer-title" className="text-base font-extrabold">
              {isSuspended
                ? t("admin.customer.unsuspendConfirmTitle")
                : t("admin.customer.suspendConfirmTitle")}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {isSuspended
                ? t("admin.customer.unsuspendConfirmBody")
                : t("admin.customer.suspendConfirmBody")}
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setShowConfirm(false)}
                className="focus-ring h-11 flex-1 rounded-2xl border border-border bg-surface text-sm font-bold"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={toggleSuspend}
                disabled={setSuspended.isPending}
                className="focus-ring h-11 flex-1 rounded-2xl bg-coral text-sm font-bold text-coral-foreground disabled:opacity-50"
              >
                {isSuspended
                  ? t("admin.customer.unsuspendAccount")
                  : t("admin.provider.confirmSuspend")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminCustomerRoute() {
  const { id } = Route.useParams();
  return <AdminCustomer id={id} />;
}
