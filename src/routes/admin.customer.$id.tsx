import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAdminCustomer, useSetCustomerSuspended } from "@/lib/db/admin-queries";
import { ChevronLeft, ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/admin/customer/$id")({ component: AdminCustomer });

function AdminCustomer() {
  const { t } = useTranslation();
  const { id } = Route.useParams();
  const q = useAdminCustomer(id);
  const setSuspended = useSetCustomerSuspended();
  const [showConfirm, setShowConfirm] = useState(false);

  if (q.isLoading) return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  const { profile, bookings, payments } = q.data ?? { profile: null, bookings: [], payments: [] };
  if (!profile) return <div className="p-6 text-sm text-muted-foreground">{t("admin.customer.notFound")}</div>;

  const isSuspended = !!profile.is_suspended;
  const toggleSuspend = () => {
    setSuspended.mutate({ id, suspended: !isSuspended });
    setShowConfirm(false);
  };

  return (
    <div className="px-5 py-4 space-y-4">
      <Link to="/admin/bookings" className="focus-ring inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground" aria-label={t("common.back")}>
        <ChevronLeft className="h-4 w-4" /> {t("common.back")}
      </Link>

      <section className="rounded-2xl border border-border/60 bg-surface p-4 shadow-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-extrabold">{profile.full_name || t("admin.provider.unnamed")}</h2>
            <p dir="ltr" className="text-xs text-muted-foreground">{profile.phone}</p>
            {profile.email && <p dir="ltr" className="text-xs text-muted-foreground">{profile.email}</p>}
            <p className="mt-2 text-[11px] text-muted-foreground">{t("admin.customer.joined", { date: new Date(profile.created_at).toLocaleDateString() })}</p>
          </div>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${isSuspended ? "bg-coral/10 text-coral" : "bg-mint/20 text-success"}`}>
            {isSuspended ? t("admin.providers.suspended") : t("admin.customers.active")}
          </span>
        </div>
        <button
          onClick={() => setShowConfirm(true)}
          disabled={setSuspended.isPending}
          className={`focus-ring mt-4 flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold disabled:opacity-50 ${
            isSuspended ? "bg-navy text-navy-foreground" : "border border-coral text-coral"
          }`}
        >
          <ShieldAlert className="h-4 w-4" />
          {isSuspended ? t("admin.customer.unsuspendAccount") : t("admin.customer.suspendAccount")}
        </button>
      </section>

      <section>
        <h3 className="mb-2 px-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">{t("admin.customer.recentBookings", { count: bookings.length })}</h3>
        {bookings.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">{t("admin.customer.noBookings")}</p>
        ) : (
          <ul className="space-y-2">
            {bookings.map((b: any) => (
              <li key={b.id} className="flex items-center justify-between rounded-xl border border-border/60 bg-surface p-3 text-xs">
                <div>
                  <p className="font-semibold">{new Date(b.start_at).toLocaleString()}</p>
                  <p className="text-muted-foreground">{b.price_total} EGP</p>
                </div>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase">{b.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 px-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">{t("admin.customer.paymentHistory", { count: payments.length })}</h3>
        {payments.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">{t("admin.customer.noPayments")}</p>
        ) : (
          <ul className="space-y-2">
            {payments.map((pay: any) => (
              <li key={pay.id} className="flex items-center justify-between rounded-xl border border-border/60 bg-surface p-3 text-xs">
                <div>
                  <p className="font-semibold capitalize">{pay.payment_method_name_en || pay.method || "—"} · {pay.amount} EGP</p>
                  <p className="text-muted-foreground">{new Date(pay.created_at).toLocaleString()}</p>
                </div>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase">{pay.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {showConfirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-6" onClick={() => setShowConfirm(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="suspend-customer-title" className="w-full max-w-sm rounded-3xl bg-surface p-5" onClick={(e) => e.stopPropagation()}>
            <div id="suspend-customer-title" className="text-base font-extrabold">
              {isSuspended ? t("admin.customer.unsuspendConfirmTitle") : t("admin.customer.suspendConfirmTitle")}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {isSuspended ? t("admin.customer.unsuspendConfirmBody") : t("admin.customer.suspendConfirmBody")}
            </p>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setShowConfirm(false)} className="focus-ring h-11 flex-1 rounded-2xl border border-border bg-surface text-sm font-bold">{t("common.cancel")}</button>
              <button onClick={toggleSuspend} disabled={setSuspended.isPending} className="focus-ring h-11 flex-1 rounded-2xl bg-coral text-sm font-bold text-coral-foreground disabled:opacity-50">
                {isSuspended ? t("admin.customer.unsuspendAccount") : t("admin.provider.confirmSuspend")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
