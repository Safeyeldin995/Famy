import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  useAdminSupportTickets, useAdminUpdateSupportTicket,
  useAdminDisputes, useAdminResolveDispute,
  useAdminNoShowReports, useAdminResolveNoShow,
  getSignedEvidenceUrl,
  type TicketStatus,
} from "@/lib/db/case-queries";
import { Search, Paperclip } from "lucide-react";

export const Route = createFileRoute("/admin/cases")({ component: AdminCases });

type Tab = "support" | "disputes" | "no_shows";

const SUPPORT_STATUSES = ["open", "pending", "resolved", "closed"];
const CASE_STATUSES = ["open", "info_requested", "resolved", "rejected"];

function statusTone(status: string) {
  if (status === "resolved" || status === "closed") return "bg-mint/20 text-success";
  if (status === "rejected") return "bg-muted text-muted-foreground";
  return "bg-amber-100 text-amber-700";
}

async function openEvidence(path: string) {
  try {
    const url = await getSignedEvidenceUrl(path);
    window.open(url, "_blank");
  } catch (e: any) {
    toast.error(e?.message ?? "Could not open evidence file.");
  }
}

function BookingContext({ row }: { row: any }) {
  const booking = row.booking;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span className="font-mono">{row.booking_id}</span>
      {booking?.status && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase">{booking.status}</span>}
      {booking?.customer?.full_name && booking?.customer_id && (
        <Link to="/admin/customer/$id" params={{ id: booking.customer_id }} className="text-navy hover:underline">
          {booking.customer.full_name}
        </Link>
      )}
      {booking?.provider?.profile?.full_name && booking?.provider?.id && (
        <>
          {" → "}
          <Link to="/admin/provider/$id" params={{ id: booking.provider.id }} className="text-navy hover:underline">
            {booking.provider.profile.full_name}
          </Link>
        </>
      )}
    </div>
  );
}

function EvidenceLinks({ paths }: { paths: string[] | undefined }) {
  if (!paths || paths.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {paths.map((p, i) => (
        <button key={p} onClick={() => openEvidence(p)} className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-semibold text-navy">
          <Paperclip className="h-3 w-3" /> Evidence {i + 1}
        </button>
      ))}
    </div>
  );
}

function SupportTicketDetail({ row }: { row: any }) {
  const update = useAdminUpdateSupportTicket();
  const [status, setStatus] = useState<TicketStatus>(row.status);
  const [notes, setNotes] = useState(row.resolution_notes ?? "");

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3 text-xs">
      <BookingContext row={row} />
      <p><span className="text-muted-foreground">Category:</span> {row.category}</p>
      <p><span className="text-muted-foreground">Opened by:</span> {row.opened_by_role}</p>
      <p className="whitespace-pre-wrap">{row.description}</p>

      <div className="space-y-2 rounded-xl border border-border/60 bg-surface-2 p-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Resolution (audited)</p>
        <select value={status} onChange={(e) => setStatus(e.target.value as TicketStatus)} className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-xs">
          {SUPPORT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Resolution notes (required to resolve/close)"
          className="w-full resize-none rounded-lg border border-border bg-surface p-2 text-xs" />
        <button
          disabled={update.isPending}
          onClick={() =>
            update.mutate(
              { id: row.id, status, resolution_notes: notes || undefined },
              {
                onSuccess: () => toast.success("Ticket updated."),
                onError: (e: any) => toast.error(e?.message ?? "Could not update ticket."),
              },
            )
          }
          className="rounded-lg bg-navy px-3 py-1.5 text-xs font-bold text-navy-foreground disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </div>
  );
}

function DisputeDetail({ row }: { row: any }) {
  const resolve = useAdminResolveDispute();
  const [notes, setNotes] = useState(row.admin_notes ?? "");
  const [bookingOutcome, setBookingOutcome] = useState<"" | "completed" | "cancelled">("");
  const closed = row.status === "resolved" || row.status === "rejected";

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3 text-xs">
      <BookingContext row={row} />
      <p><span className="text-muted-foreground">Opened by:</span> {row.opened_by_role} · previous status: {row.previous_status}</p>
      <p><span className="text-muted-foreground">Reason:</span> {row.reason}</p>
      <p className="whitespace-pre-wrap">{row.description}</p>
      <EvidenceLinks paths={row.evidence_paths} />

      {closed ? (
        row.admin_notes && <p className="rounded-xl bg-surface-2 p-3"><span className="text-muted-foreground">Admin notes:</span> {row.admin_notes}</p>
      ) : (
        <div className="space-y-2 rounded-xl border border-coral/30 bg-coral/5 p-3">
          <p className="text-[11px] font-bold text-coral">Resolution (audited — notes required to resolve/reject)</p>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Admin notes"
            className="w-full resize-none rounded-lg border border-border bg-surface p-2 text-xs" />
          <select value={bookingOutcome} onChange={(e) => setBookingOutcome(e.target.value as any)} className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-xs">
            <option value="">Don't change booking status</option>
            <option value="completed">Mark booking completed</option>
            <option value="cancelled">Mark booking cancelled</option>
          </select>
          <div className="flex flex-wrap gap-2">
            <button
              disabled={resolve.isPending}
              onClick={() => resolve.mutate({ disputeId: row.id, status: "info_requested", adminNotes: notes || undefined }, {
                onSuccess: () => toast.success("Requested more information."),
                onError: (e: any) => toast.error(e?.message ?? "Could not update dispute."),
              })}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-muted-foreground disabled:opacity-50"
            >Request info</button>
            <button
              disabled={!notes.trim() || resolve.isPending}
              onClick={() => resolve.mutate({ disputeId: row.id, status: "resolved", adminNotes: notes, bookingStatus: bookingOutcome || undefined }, {
                onSuccess: () => toast.success("Dispute resolved."),
                onError: (e: any) => toast.error(e?.message ?? "Could not resolve dispute."),
              })}
              className="rounded-lg bg-navy px-3 py-1.5 text-xs font-bold text-navy-foreground disabled:opacity-50"
            >Resolve</button>
            <button
              disabled={!notes.trim() || resolve.isPending}
              onClick={() => resolve.mutate({ disputeId: row.id, status: "rejected", adminNotes: notes, bookingStatus: bookingOutcome || undefined }, {
                onSuccess: () => toast.success("Dispute rejected."),
                onError: (e: any) => toast.error(e?.message ?? "Could not reject dispute."),
              })}
              className="rounded-lg border border-coral px-3 py-1.5 text-xs font-bold text-coral disabled:opacity-50"
            >Reject</button>
          </div>
        </div>
      )}
    </div>
  );
}

function NoShowDetail({ row }: { row: any }) {
  const resolve = useAdminResolveNoShow();
  const [notes, setNotes] = useState(row.admin_notes ?? "");
  const [bookingOutcome, setBookingOutcome] = useState<"" | "completed" | "cancelled">("");
  const closed = row.status === "resolved" || row.status === "rejected";

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3 text-xs">
      <BookingContext row={row} />
      <p><span className="text-muted-foreground">Reported by:</span> {row.reporter_role} · <span className="text-muted-foreground">reported party:</span> {row.reported_party} · previous status: {row.previous_status}</p>
      <p className="whitespace-pre-wrap">{row.reason}</p>
      <EvidenceLinks paths={row.evidence_paths} />

      {closed ? (
        row.admin_notes && <p className="rounded-xl bg-surface-2 p-3"><span className="text-muted-foreground">Admin notes:</span> {row.admin_notes}</p>
      ) : (
        <div className="space-y-2 rounded-xl border border-coral/30 bg-coral/5 p-3">
          <p className="text-[11px] font-bold text-coral">Resolution (audited — notes required to resolve/reject)</p>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Admin notes"
            className="w-full resize-none rounded-lg border border-border bg-surface p-2 text-xs" />
          <select value={bookingOutcome} onChange={(e) => setBookingOutcome(e.target.value as any)} className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-xs">
            <option value="">Don't change booking status</option>
            <option value="completed">Mark booking completed</option>
            <option value="cancelled">Mark booking cancelled</option>
          </select>
          <div className="flex flex-wrap gap-2">
            <button
              disabled={resolve.isPending}
              onClick={() => resolve.mutate({ reportId: row.id, status: "info_requested", adminNotes: notes || undefined }, {
                onSuccess: () => toast.success("Requested more information."),
                onError: (e: any) => toast.error(e?.message ?? "Could not update report."),
              })}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-muted-foreground disabled:opacity-50"
            >Request info</button>
            <button
              disabled={!notes.trim() || resolve.isPending}
              onClick={() => resolve.mutate({ reportId: row.id, status: "resolved", adminNotes: notes, bookingStatus: bookingOutcome || undefined }, {
                onSuccess: () => toast.success("No-show report resolved."),
                onError: (e: any) => toast.error(e?.message ?? "Could not resolve report."),
              })}
              className="rounded-lg bg-navy px-3 py-1.5 text-xs font-bold text-navy-foreground disabled:opacity-50"
            >Resolve</button>
            <button
              disabled={!notes.trim() || resolve.isPending}
              onClick={() => resolve.mutate({ reportId: row.id, status: "rejected", adminNotes: notes, bookingStatus: bookingOutcome || undefined }, {
                onSuccess: () => toast.success("No-show report rejected."),
                onError: (e: any) => toast.error(e?.message ?? "Could not reject report."),
              })}
              className="rounded-lg border border-coral px-3 py-1.5 text-xs font-bold text-coral disabled:opacity-50"
            >Reject</button>
          </div>
        </div>
      )}
    </div>
  );
}

function CaseRow({ tab, row, isOpen, onToggle }: { tab: Tab; row: any; isOpen: boolean; onToggle: () => void }) {
  const title = tab === "support" ? row.subject : tab === "disputes" ? "Dispute" : "No-show report";
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">{title}</p>
          <p className="text-[11px] text-muted-foreground">{new Date(row.created_at).toLocaleString()}</p>
          <p className="font-mono text-[10px] text-muted-foreground">{row.id}</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${statusTone(row.status)}`}>{String(row.status).replace("_", " ")}</span>
      </div>
      <button onClick={onToggle} className="mt-2 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground">
        {isOpen ? "Hide details" : "View details"}
      </button>
      {isOpen && (
        tab === "support" ? <SupportTicketDetail row={row} />
        : tab === "disputes" ? <DisputeDetail row={row} />
        : <NoShowDetail row={row} />
      )}
    </li>
  );
}

function AdminCases() {
  const [tab, setTab] = useState<Tab>("support");
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const ticketsQ = useAdminSupportTickets(status ? { status: status as TicketStatus } : undefined);
  const disputesQ = useAdminDisputes(status ? { status: status as any } : undefined);
  const noShowQ = useAdminNoShowReports(status ? { status: status as any } : undefined);

  const rows = (tab === "support" ? ticketsQ.data : tab === "disputes" ? disputesQ.data : noShowQ.data) ?? [];
  const isLoading = tab === "support" ? ticketsQ.isLoading : tab === "disputes" ? disputesQ.isLoading : noShowQ.isLoading;
  const isError = tab === "support" ? ticketsQ.isError : tab === "disputes" ? disputesQ.isError : noShowQ.isError;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return (rows as any[]).filter((r) => {
      const id = String(r.id ?? "").toLowerCase();
      const bookingId = String(r.booking_id ?? "").toLowerCase();
      const customerName = String(r.booking?.customer?.full_name ?? "").toLowerCase();
      const providerName = String(r.booking?.provider?.profile?.full_name ?? "").toLowerCase();
      return id.includes(needle) || bookingId.includes(needle) || customerName.includes(needle) || providerName.includes(needle);
    });
  }, [rows, query]);

  const statusOptions = tab === "support" ? SUPPORT_STATUSES : CASE_STATUSES;

  return (
    <div className="px-5 py-5 space-y-4">
      <div>
        <h1 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Support &amp; Case Management</h1>
        <p className="text-xs text-muted-foreground">Support requests, disputes and no-show reports across all bookings.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {([
          { key: "support" as Tab, label: "Support Requests" },
          { key: "disputes" as Tab, label: "Disputes" },
          { key: "no_shows" as Tab, label: "No-Show Reports" },
        ]).map((tOpt) => (
          <button
            key={tOpt.key}
            onClick={() => { setTab(tOpt.key); setStatus(""); setExpanded(null); }}
            className={`rounded-full px-3 py-1.5 text-xs font-bold ${tab === tOpt.key ? "bg-navy text-navy-foreground" : "bg-muted text-muted-foreground"}`}
          >
            {tOpt.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-10 min-w-[260px] flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by case/booking ID, customer or provider…"
            className="w-full bg-transparent text-sm outline-none"
          />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 rounded-xl border border-border bg-surface px-3 text-sm">
          <option value="">All statuses</option>
          {statusOptions.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-muted" />)}
        </div>
      ) : isError ? (
        <p className="text-sm text-coral">Could not load cases. Please refresh.</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No cases match this search/filter.</p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-2xl border border-border/60 bg-surface shadow-card">
          {filtered.map((row: any) => (
            <CaseRow key={row.id} tab={tab} row={row} isOpen={expanded === row.id} onToggle={() => setExpanded(expanded === row.id ? null : row.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}
