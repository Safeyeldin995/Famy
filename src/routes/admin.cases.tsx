import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  useAdminSupportTickets, useAdminUpdateSupportTicket,
  useAdminAssignSupportTicketToMe,
  useAdminDisputes, useAdminResolveDispute,
  useAdminNoShowReports, useAdminResolveNoShow,
  getSignedEvidenceUrl,
  type TicketStatus,
} from "@/lib/db/case-queries";
import { AdminQueryError } from "@/components/admin/AdminQueryError";
import { Search, Paperclip } from "lucide-react";

export const Route = createFileRoute("/admin/cases")({
  component: AdminCases,
  validateSearch: (search: Record<string, unknown>): { tab?: string; status?: string } => ({
    ...(typeof search.tab === "string" ? { tab: search.tab } : {}),
    ...(typeof search.status === "string" ? { status: search.status } : {}),
  }),
});

type Tab = "support" | "disputes" | "no_shows";

const SUPPORT_STATUSES = ["open", "pending", "resolved", "closed"];
const CASE_STATUSES = ["open", "info_requested", "resolved", "rejected"];

function statusTone(status: string) {
  if (status === "resolved" || status === "closed") return "bg-mint/20 text-success";
  if (status === "rejected") return "bg-muted text-muted-foreground";
  return "bg-amber-100 text-amber-700";
}

async function openEvidence(path: string, t: (key: string) => string) {
  try {
    const url = await getSignedEvidenceUrl(path);
    window.open(url, "_blank");
  } catch (e: any) {
    toast.error(e?.message ?? t("admin.cases.evidenceError"));
  }
}

function BookingContext({ row }: { row: any }) {
  const booking = row.booking;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span dir="ltr" className="font-mono">{row.booking_id}</span>
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
  const { t } = useTranslation();
  if (!paths || paths.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {paths.map((p, i) => (
        <button key={p} onClick={() => openEvidence(p, t)} className="focus-ring flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-semibold text-navy">
          <Paperclip className="h-3 w-3" /> {t("admin.cases.evidence", { n: i + 1 })}
        </button>
      ))}
    </div>
  );
}

function SupportTicketDetail({ row }: { row: any }) {
  const { t } = useTranslation();
  const update = useAdminUpdateSupportTicket();
  const assign = useAdminAssignSupportTicketToMe();
  const [status, setStatus] = useState<TicketStatus>(row.status);
  const [notes, setNotes] = useState(row.resolution_notes ?? "");
  const resolutionRequiresNotes = status === "resolved" || status === "closed";

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3 text-xs">
      <BookingContext row={row} />
      <p><span className="text-muted-foreground">{t("admin.cases.category")}:</span> {row.category}</p>
      <p><span className="text-muted-foreground">{t("admin.cases.openedBy")}:</span> {row.opened_by_role}</p>
      <p className="whitespace-pre-wrap">{row.description}</p>
      <button
        disabled={assign.isPending || !!row.assigned_admin_id}
        onClick={() => assign.mutate(row.id, {
          onSuccess: () => toast.success(t("admin.cases.assigned")),
          onError: (e: any) => toast.error(e?.message ?? t("admin.cases.assignmentError")),
        })}
        className="focus-ring rounded-lg border border-border px-3 py-1.5 text-xs font-bold disabled:opacity-50"
      >
        {row.assigned_admin_id ? t("admin.cases.assigned") : assign.isPending ? t("admin.cases.assigning") : t("admin.cases.assignToMe")}
      </button>

      <div className="space-y-2 rounded-xl border border-border/60 bg-surface-2 p-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{t("admin.cases.resolutionAudited")}</p>
        <select value={status} onChange={(e) => setStatus(e.target.value as TicketStatus)} className="focus-ring h-9 w-full rounded-lg border border-border bg-surface px-2 text-xs">
          {SUPPORT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder={t("admin.cases.resolutionNotesPlaceholder")}
          aria-label={t("admin.cases.resolutionNotesPlaceholder")}
          className="w-full resize-none rounded-lg border border-border bg-surface p-2 text-xs" />
        <button
          disabled={update.isPending || (resolutionRequiresNotes && !notes.trim())}
          onClick={() =>
            update.mutate(
              { id: row.id, status, resolution_notes: notes.trim() || undefined },
              {
                onSuccess: () => toast.success(t("admin.cases.ticketUpdated")),
                onError: (e: any) => toast.error(e?.message ?? t("admin.cases.ticketUpdateError")),
              },
            )
          }
          className="focus-ring rounded-lg bg-navy px-3 py-1.5 text-xs font-bold text-navy-foreground disabled:opacity-50"
        >
          {update.isPending ? t("admin.cancellationReasons.saving") : t("common.save")}
        </button>
      </div>
    </div>
  );
}

function DisputeDetail({ row }: { row: any }) {
  const { t } = useTranslation();
  const resolve = useAdminResolveDispute();
  const [notes, setNotes] = useState(row.admin_notes ?? "");
  const [bookingOutcome, setBookingOutcome] = useState<"" | "completed" | "cancelled">("");
  const closed = row.status === "resolved" || row.status === "rejected";

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3 text-xs">
      <BookingContext row={row} />
      <p><span className="text-muted-foreground">{t("admin.cases.openedBy")}:</span> {row.opened_by_role} · {t("admin.cases.previousStatus")}: {row.previous_status}</p>
      <p><span className="text-muted-foreground">{t("admin.bookings.reason")}:</span> {row.reason}</p>
      <p className="whitespace-pre-wrap">{row.description}</p>
      <EvidenceLinks paths={row.evidence_paths} />

      {closed ? (
        row.admin_notes && <p className="rounded-xl bg-surface-2 p-3"><span className="text-muted-foreground">{t("admin.cases.adminNotes")}:</span> {row.admin_notes}</p>
      ) : (
        <div className="space-y-2 rounded-xl border border-coral/30 bg-coral/5 p-3">
          <p className="text-[11px] font-bold text-coral">{t("admin.cases.resolutionNotesRequired")}</p>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder={t("admin.cases.adminNotes")}
            aria-label={t("admin.cases.adminNotes")}
            className="w-full resize-none rounded-lg border border-border bg-surface p-2 text-xs" />
          <select value={bookingOutcome} onChange={(e) => setBookingOutcome(e.target.value as any)} className="focus-ring h-9 w-full rounded-lg border border-border bg-surface px-2 text-xs">
            <option value="">{t("admin.cases.dontChangeStatus")}</option>
            <option value="completed">{t("admin.cases.markCompleted")}</option>
            <option value="cancelled">{t("admin.cases.markCancelled")}</option>
          </select>
          <div className="flex flex-wrap gap-2">
            <button
              disabled={resolve.isPending}
              onClick={() => resolve.mutate({ disputeId: row.id, status: "info_requested", adminNotes: notes || undefined }, {
                onSuccess: () => toast.success(t("admin.cases.infoRequested")),
                onError: (e: any) => toast.error(e?.message ?? t("admin.cases.disputeUpdateError")),
              })}
              className="focus-ring rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-muted-foreground disabled:opacity-50"
            >{t("admin.cases.requestInfo")}</button>
            <button
              disabled={!notes.trim() || resolve.isPending}
              onClick={() => resolve.mutate({ disputeId: row.id, status: "resolved", adminNotes: notes, bookingStatus: bookingOutcome || undefined }, {
                onSuccess: () => toast.success(t("admin.cases.disputeResolved")),
                onError: (e: any) => toast.error(e?.message ?? t("admin.cases.disputeResolveError")),
              })}
              className="focus-ring rounded-lg bg-navy px-3 py-1.5 text-xs font-bold text-navy-foreground disabled:opacity-50"
            >{t("admin.cases.resolve")}</button>
            <button
              disabled={!notes.trim() || resolve.isPending}
              onClick={() => resolve.mutate({ disputeId: row.id, status: "rejected", adminNotes: notes, bookingStatus: bookingOutcome || undefined }, {
                onSuccess: () => toast.success(t("admin.cases.disputeRejected")),
                onError: (e: any) => toast.error(e?.message ?? t("admin.cases.disputeRejectError")),
              })}
              className="focus-ring rounded-lg border border-coral px-3 py-1.5 text-xs font-bold text-coral disabled:opacity-50"
            >{t("admin.providers.reject")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function NoShowDetail({ row }: { row: any }) {
  const { t } = useTranslation();
  const resolve = useAdminResolveNoShow();
  const [notes, setNotes] = useState(row.admin_notes ?? "");
  const [bookingOutcome, setBookingOutcome] = useState<"" | "completed" | "cancelled">("");
  const closed = row.status === "resolved" || row.status === "rejected";

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3 text-xs">
      <BookingContext row={row} />
      <p><span className="text-muted-foreground">{t("admin.cases.reportedBy")}:</span> {row.reporter_role} · <span className="text-muted-foreground">{t("admin.cases.reportedParty")}:</span> {row.reported_party} · {t("admin.cases.previousStatus")}: {row.previous_status}</p>
      <p className="whitespace-pre-wrap">{row.reason}</p>
      <EvidenceLinks paths={row.evidence_paths} />

      {closed ? (
        row.admin_notes && <p className="rounded-xl bg-surface-2 p-3"><span className="text-muted-foreground">{t("admin.cases.adminNotes")}:</span> {row.admin_notes}</p>
      ) : (
        <div className="space-y-2 rounded-xl border border-coral/30 bg-coral/5 p-3">
          <p className="text-[11px] font-bold text-coral">{t("admin.cases.resolutionNotesRequired")}</p>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder={t("admin.cases.adminNotes")}
            aria-label={t("admin.cases.adminNotes")}
            className="w-full resize-none rounded-lg border border-border bg-surface p-2 text-xs" />
          <select value={bookingOutcome} onChange={(e) => setBookingOutcome(e.target.value as any)} className="focus-ring h-9 w-full rounded-lg border border-border bg-surface px-2 text-xs">
            <option value="">{t("admin.cases.dontChangeStatus")}</option>
            <option value="completed">{t("admin.cases.markCompleted")}</option>
            <option value="cancelled">{t("admin.cases.markCancelled")}</option>
          </select>
          <div className="flex flex-wrap gap-2">
            <button
              disabled={resolve.isPending}
              onClick={() => resolve.mutate({ reportId: row.id, status: "info_requested", adminNotes: notes || undefined }, {
                onSuccess: () => toast.success(t("admin.cases.infoRequested")),
                onError: (e: any) => toast.error(e?.message ?? t("admin.cases.reportUpdateError")),
              })}
              className="focus-ring rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-muted-foreground disabled:opacity-50"
            >{t("admin.cases.requestInfo")}</button>
            <button
              disabled={!notes.trim() || resolve.isPending}
              onClick={() => resolve.mutate({ reportId: row.id, status: "resolved", adminNotes: notes, bookingStatus: bookingOutcome || undefined }, {
                onSuccess: () => toast.success(t("admin.cases.reportResolved")),
                onError: (e: any) => toast.error(e?.message ?? t("admin.cases.reportResolveError")),
              })}
              className="focus-ring rounded-lg bg-navy px-3 py-1.5 text-xs font-bold text-navy-foreground disabled:opacity-50"
            >{t("admin.cases.resolve")}</button>
            <button
              disabled={!notes.trim() || resolve.isPending}
              onClick={() => resolve.mutate({ reportId: row.id, status: "rejected", adminNotes: notes, bookingStatus: bookingOutcome || undefined }, {
                onSuccess: () => toast.success(t("admin.cases.reportRejected")),
                onError: (e: any) => toast.error(e?.message ?? t("admin.cases.reportRejectError")),
              })}
              className="focus-ring rounded-lg border border-coral px-3 py-1.5 text-xs font-bold text-coral disabled:opacity-50"
            >{t("admin.providers.reject")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function CaseRow({ tab, row, isOpen, onToggle }: { tab: Tab; row: any; isOpen: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const title = tab === "support" ? row.subject : tab === "disputes" ? t("admin.cases.disputeTitle") : t("admin.cases.noShowTitle");
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">{title}</p>
          <p className="text-[11px] text-muted-foreground">{new Date(row.created_at).toLocaleString()}</p>
          <p dir="ltr" className="font-mono text-[10px] text-muted-foreground">{row.id}</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${statusTone(row.status)}`}>{String(row.status).replace("_", " ")}</span>
      </div>
      <button onClick={onToggle} className="focus-ring mt-2 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground">
        {isOpen ? t("admin.cases.hideDetails") : t("admin.cases.viewDetails")}
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
  const { t } = useTranslation();
  const search = Route.useSearch();
  const [tab, setTab] = useState<Tab>((search.tab as Tab) ?? "support");
  const [status, setStatus] = useState(search.status ?? "");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const ticketsQ = useAdminSupportTickets(status ? { status: status as TicketStatus } : undefined);
  const disputesQ = useAdminDisputes(status ? { status: status as any } : undefined);
  const noShowQ = useAdminNoShowReports(status ? { status: status as any } : undefined);

  const rows = (tab === "support" ? ticketsQ.data : tab === "disputes" ? disputesQ.data : noShowQ.data) ?? [];
  const isLoading = tab === "support" ? ticketsQ.isLoading : tab === "disputes" ? disputesQ.isLoading : noShowQ.isLoading;
  const isError = tab === "support" ? ticketsQ.isError : tab === "disputes" ? disputesQ.isError : noShowQ.isError;
  const activeError = tab === "support" ? ticketsQ.error : tab === "disputes" ? disputesQ.error : noShowQ.error;
  const retryActive = () => {
    if (tab === "support") void ticketsQ.refetch();
    else if (tab === "disputes") void disputesQ.refetch();
    else void noShowQ.refetch();
  };

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
        <h1 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">{t("admin.cases.title")}</h1>
        <p className="text-xs text-muted-foreground">{t("admin.cases.subtitle")}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {([
          { key: "support" as Tab, labelKey: "admin.cases.tabSupport" },
          { key: "disputes" as Tab, labelKey: "admin.cases.tabDisputes" },
          { key: "no_shows" as Tab, labelKey: "admin.cases.tabNoShows" },
        ]).map((tOpt) => (
          <button
            key={tOpt.key}
            onClick={() => { setTab(tOpt.key); setStatus(""); setExpanded(null); }}
            className={`focus-ring rounded-full px-3 py-1.5 text-xs font-bold ${tab === tOpt.key ? "bg-navy text-navy-foreground" : "bg-muted text-muted-foreground"}`}
          >
            {t(tOpt.labelKey)}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-10 min-w-[260px] flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("admin.cases.searchPlaceholder")}
            className="w-full bg-transparent text-sm outline-none"
          />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="focus-ring h-10 rounded-xl border border-border bg-surface px-3 text-sm">
          <option value="">{t("admin.bookings.allStatuses")}</option>
          {statusOptions.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-muted" />)}
        </div>
      ) : isError ? (
        <AdminQueryError message={t("admin.cases.loadError")} error={activeError} onRetry={retryActive} />
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("admin.cases.noResults")}</p>
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
