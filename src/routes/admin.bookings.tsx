import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useAdminBookings, useUpdateBookingStatus, useAdminResolveReschedule } from "@/lib/db/admin-queries";
import { useRescheduleRequests } from "@/lib/db/queries";
import { useCancelBooking } from "@/lib/db/cancellation-queries";
import { CancelBookingDialog } from "@/components/famio/ui";
import { PaymentBlock } from "@/components/famio/PaymentBlock";
import { BookingChatPanel } from "@/components/famio/BookingChatPanel";
import { formatEGP } from "@/lib/utils";
import { Search } from "lucide-react";

function AdminCancellationDetails({ cancellation }: { cancellation: any }) {
  return (
    <div className="mt-3 space-y-1 rounded-xl border border-border/60 bg-surface p-3 text-xs">
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Cancellation details</p>
      <p><span className="text-muted-foreground">Reason:</span> {cancellation.reason_name_en}</p>
      {cancellation.note && <p><span className="text-muted-foreground">Note:</span> {cancellation.note}</p>}
      <p><span className="text-muted-foreground">Cancelled by:</span> {cancellation.cancelled_by_role}</p>
      <p><span className="text-muted-foreground">At:</span> {new Date(cancellation.cancelled_at).toLocaleString()}</p>
    </div>
  );
}

function AdminRescheduleHistory({ bookingId, customerId }: { bookingId: string; customerId: string }) {
  const reqQ = useRescheduleRequests(bookingId);
  const resolve = useAdminResolveReschedule();
  const [reason, setReason] = useState("");
  const rows = reqQ.data ?? [];
  const open = rows.find((r: any) => r.status === "pending");

  if (rows.length === 0) return <p className="mt-3 text-xs text-muted-foreground">No reschedule history for this booking.</p>;

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Reschedule history</p>
      <ul className="space-y-1">
        {rows.map((r: any) => (
          <li key={r.id} className="text-xs text-muted-foreground">
            {(r.requested_by === customerId ? "Customer" : "Provider")} proposed {new Date(r.proposed_start_at).toLocaleString()} — {r.status}
            {r.response_reason ? ` (${r.response_reason})` : ""}
          </li>
        ))}
      </ul>
      {open && (
        <div className="space-y-2 rounded-xl border border-coral/30 bg-coral/5 p-2">
          <p className="text-[11px] font-bold text-coral">Admin intervene (audited — reason required)</p>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)"
            className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-xs" />
          <div className="flex gap-2">
            <button
              disabled={!reason.trim() || resolve.isPending}
              onClick={() => resolve.mutate({ requestId: open.id, bookingId, action: "accept", reason }, { onSuccess: () => setReason("") })}
              className="rounded-lg bg-navy px-3 py-1.5 text-xs font-bold text-navy-foreground disabled:opacity-50"
            >Force accept</button>
            <button
              disabled={!reason.trim() || resolve.isPending}
              onClick={() => resolve.mutate({ requestId: open.id, bookingId, action: "reject", reason }, { onSuccess: () => setReason("") })}
              className="rounded-lg border border-coral px-3 py-1.5 text-xs font-bold text-coral disabled:opacity-50"
            >Force reject</button>
          </div>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute("/admin/bookings")({ component: AdminBookings });

// Real booking_status enum: pending, confirmed, in_progress, completed,
// cancelled, no_show. "Accepted" in the product brief maps to "confirmed" —
// there is no separate "accepted" state in the schema.
const STATUS_FILTERS = [
  { key: "pending", label: "Pending" },
  { key: "confirmed", label: "Accepted" },
  { key: "in_progress", label: "In Progress" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
  { key: "no_show", label: "No-show" },
] as const;

function latestPayment(payments: any[] | null | undefined) {
  if (!payments || payments.length === 0) return null;
  return [...payments].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))[0];
}

function paymentTone(status: string | undefined) {
  if (!status) return "bg-muted text-muted-foreground";
  if (status === "captured") return "bg-mint/20 text-success";
  if (status === "rejected" || status === "failed") return "bg-coral/10 text-coral";
  return "bg-amber-100 text-amber-700";
}

function AdminBookings() {
  const [status, setStatus] = useState<string>("");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const q = useAdminBookings(status || undefined);
  const update = useUpdateBookingStatus();
  const cancelBooking = useCancelBooking();
  const cancelTarget = (q.data ?? []).find((b: any) => b.id === cancelId) as any;

  const rows = useMemo(() => {
    const all = q.data ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((b: any) => {
      const id = String(b.id ?? "").toLowerCase();
      const customerName = String(b.customer?.full_name ?? "").toLowerCase();
      const customerPhone = String(b.customer?.phone ?? "").toLowerCase();
      const providerName = String(b.provider?.profile?.full_name ?? "").toLowerCase();
      return id.includes(needle) || customerName.includes(needle) || customerPhone.includes(needle) || providerName.includes(needle);
    });
  }, [q.data, query]);

  return (
    <div className="px-5 py-5 space-y-4">
      <div>
        <h1 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Booking Management</h1>
        <p className="text-xs text-muted-foreground">Search, filter, and drill into any booking — including its linked customer, provider and payment.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-10 min-w-[260px] flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by booking ID, customer or provider…"
            className="w-full bg-transparent text-sm outline-none"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-10 rounded-xl border border-border bg-surface px-3 text-sm"
        >
          <option value="">All statuses</option>
          {STATUS_FILTERS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>

      {q.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-muted" />)}
        </div>
      ) : q.isError ? (
        <p className="text-sm text-coral">Could not load bookings. Please refresh.</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No bookings match this search/filter.</p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-2xl border border-border/60 bg-surface shadow-card">
          {rows.map((b: any) => {
            const payment = latestPayment(b.payments);
            const isOpen = expanded === b.id;
            return (
              <li key={b.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">
                      <Link to="/admin/provider/$id" params={{ id: b.provider?.id }} className="text-navy hover:underline">
                        {b.provider?.profile?.full_name || "Provider"}
                      </Link>
                      {" → "}
                      <Link to="/admin/customer/$id" params={{ id: b.customer_id }} className="text-navy hover:underline">
                        {b.customer?.full_name || "Customer"}
                      </Link>
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {new Date(b.start_at).toLocaleString()} · {formatEGP(Number(b.price_total ?? 0))}
                    </p>
                    <p className="font-mono text-[10px] text-muted-foreground">{b.id}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase">{b.status}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${paymentTone(payment?.status)}`}>
                      {payment ? payment.status : "no payment"}
                    </span>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select
                    value={b.status}
                    onChange={(e) => update.mutate({ id: b.id, status: e.target.value }, { onError: (err: any) => toast.error(err?.message ?? "Could not update status.") })}
                    className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs"
                  >
                    {STATUS_FILTERS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                  {(b.status === "pending" || b.status === "confirmed") && (
                    <button
                      onClick={() => setCancelId(b.id)}
                      className="rounded-lg border border-coral px-3 py-1.5 text-xs font-bold text-coral"
                    >
                      Cancel booking
                    </button>
                  )}
                  <button
                    onClick={() => setExpanded(isOpen ? null : b.id)}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground"
                  >
                    {isOpen ? "Hide details" : "View payment & chat"}
                  </button>
                </div>

                {b.status === "cancelled" && b.cancellation && <AdminCancellationDetails cancellation={b.cancellation} />}

                {isOpen && (
                  <div className="mt-3">
                    {b.family_member && (
                      <div className="mb-3 space-y-1 rounded-xl border border-border/60 bg-surface p-3 text-xs">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Family member snapshot</p>
                        <p><span className="text-muted-foreground">For:</span> {b.family_member.full_name} ({b.family_member.relationship === "other" ? (b.family_member.relationship_other || "other") : b.family_member.relationship})</p>
                        {b.family_member.date_of_birth && <p><span className="text-muted-foreground">DOB:</span> {b.family_member.date_of_birth}</p>}
                        {b.family_member.phone && <p><span className="text-muted-foreground">Phone:</span> {b.family_member.phone}</p>}
                        {b.family_member.allergies && <p><span className="text-muted-foreground">Allergies:</span> {b.family_member.allergies}</p>}
                        {b.family_member.medical_notes && <p><span className="text-muted-foreground">Medical notes:</span> {b.family_member.medical_notes}</p>}
                        {b.family_member.access_notes && <p><span className="text-muted-foreground">Access notes:</span> {b.family_member.access_notes}</p>}
                        {b.family_member.emergency_contact_name && (
                          <p><span className="text-muted-foreground">Emergency contact:</span> {b.family_member.emergency_contact_name} {b.family_member.emergency_contact_phone && `(${b.family_member.emergency_contact_phone})`}</p>
                        )}
                      </div>
                    )}
                    <PaymentBlock bookingId={b.id} viewer="admin" bookingStatus={b.status} />
                    <AdminRescheduleHistory bookingId={b.id} customerId={b.customer_id} />
                    <BookingChatPanel bookingId={b.id} status={b.status} viewer="admin" />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <CancelBookingDialog
        open={!!cancelId}
        actorType="admin"
        bookingStatus={cancelTarget?.status}
        title="Cancel this booking?"
        body="This is an audited support action. The customer and provider will be notified."
        reasonLabel="Reason"
        notePlaceholder="Add a note"
        confirmLabel="Cancel booking"
        cancelLabel="Keep booking"
        pending={cancelBooking.isPending}
        onCancel={() => setCancelId(null)}
        onConfirm={(reasonId, note) =>
          cancelBooking.mutate(
            { bookingId: cancelId!, reasonId, note },
            {
              onSuccess: () => { setCancelId(null); toast.success("Booking cancelled."); },
              onError: (e: any) => toast.error(e?.message ?? "Could not cancel this booking."),
            },
          )
        }
      />
    </div>
  );
}
