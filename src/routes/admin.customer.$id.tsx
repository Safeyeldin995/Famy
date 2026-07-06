import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useAdminCustomer, useSetCustomerSuspended } from "@/lib/db/admin-queries";
import { ChevronLeft, ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/admin/customer/$id")({ component: AdminCustomer });

function AdminCustomer() {
  const { id } = Route.useParams();
  const q = useAdminCustomer(id);
  const setSuspended = useSetCustomerSuspended();
  const [showConfirm, setShowConfirm] = useState(false);

  if (q.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  const { profile, bookings, payments } = q.data ?? { profile: null, bookings: [], payments: [] };
  if (!profile) return <div className="p-6 text-sm text-muted-foreground">Customer not found.</div>;

  const isSuspended = !!profile.is_suspended;
  const toggleSuspend = () => {
    setSuspended.mutate({ id, suspended: !isSuspended });
    setShowConfirm(false);
  };

  return (
    <div className="px-5 py-4 space-y-4">
      <Link to="/admin/bookings" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground">
        <ChevronLeft className="h-4 w-4" /> Back
      </Link>

      <section className="rounded-2xl border border-border/60 bg-surface p-4 shadow-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-extrabold">{profile.full_name || "Unnamed"}</h2>
            <p className="text-xs text-muted-foreground">{profile.phone}</p>
            {profile.email && <p className="text-xs text-muted-foreground">{profile.email}</p>}
            <p className="mt-2 text-[11px] text-muted-foreground">Joined {new Date(profile.created_at).toLocaleDateString()}</p>
          </div>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${isSuspended ? "bg-coral/10 text-coral" : "bg-mint/20 text-success"}`}>
            {isSuspended ? "Suspended" : "Active"}
          </span>
        </div>
        <button
          onClick={() => setShowConfirm(true)}
          disabled={setSuspended.isPending}
          className={`mt-4 flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold disabled:opacity-50 ${
            isSuspended ? "bg-navy text-navy-foreground" : "border border-coral text-coral"
          }`}
        >
          <ShieldAlert className="h-4 w-4" />
          {isSuspended ? "Unsuspend account" : "Suspend account"}
        </button>
      </section>

      <section>
        <h3 className="mb-2 px-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">Recent bookings ({bookings.length})</h3>
        {bookings.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">No bookings.</p>
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
        <h3 className="mb-2 px-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">Payment history ({payments.length})</h3>
        {payments.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">No payments.</p>
        ) : (
          <ul className="space-y-2">
            {payments.map((pay: any) => (
              <li key={pay.id} className="flex items-center justify-between rounded-xl border border-border/60 bg-surface p-3 text-xs">
                <div>
                  <p className="font-semibold capitalize">{pay.method} · {pay.amount} EGP</p>
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
          <div className="w-full max-w-sm rounded-3xl bg-surface p-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-base font-extrabold">
              {isSuspended ? "Unsuspend this account?" : "Suspend this account?"}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {isSuspended
                ? "The customer will regain the ability to create new bookings."
                : "The customer will be blocked from creating new bookings. Existing bookings and profile data remain visible."}
            </p>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setShowConfirm(false)} className="h-11 flex-1 rounded-2xl border border-border bg-surface text-sm font-bold">Cancel</button>
              <button onClick={toggleSuspend} disabled={setSuspended.isPending} className="h-11 flex-1 rounded-2xl bg-coral text-sm font-bold text-coral-foreground disabled:opacity-50">
                {isSuspended ? "Unsuspend" : "Confirm suspend"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
