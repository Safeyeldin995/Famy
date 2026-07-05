import { createFileRoute, Link } from "@tanstack/react-router";
import { useAdminBookings, useUpdateBookingStatus } from "@/lib/db/admin-queries";
import { PaymentBlock } from "@/components/famio/PaymentBlock";

export const Route = createFileRoute("/admin/bookings")({ component: AdminBookings });

const STATUSES = ["pending", "confirmed", "in_progress", "completed", "cancelled", "no_show"] as const;

function AdminBookings() {
  const q = useAdminBookings();
  const update = useUpdateBookingStatus();

  if (q.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  const rows = q.data ?? [];
  if (rows.length === 0) return <div className="p-6 text-sm text-muted-foreground">No bookings yet.</div>;

  return (
    <ul className="divide-y divide-border/60">
      {rows.map((b: any) => (
        <li key={b.id} className="px-5 py-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">
                {b.provider?.profile?.full_name || "Provider"} → <Link to="/admin/customer/$id" params={{ id: b.customer_id }} className="text-navy underline">{b.customer?.full_name || "Customer"}</Link>
              </p>
              <p className="text-[11px] text-muted-foreground">
                {new Date(b.scheduled_start).toLocaleString()} · {b.price_total} EGP
              </p>
            </div>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase">{b.status}</span>
          </div>
          <select
            value={b.status}
            onChange={(e) => update.mutate({ id: b.id, status: e.target.value })}
            className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-xs"
          >
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <PaymentBlock bookingId={b.id} viewer="admin" />
        </li>
      ))}
    </ul>
  );
}
