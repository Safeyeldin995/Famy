import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CalendarClock, Check, X, RefreshCw } from "lucide-react";
import { Card, ReasonDialog } from "@/components/famio/ui";
import { useRescheduleRequests, useRequestReschedule, useRespondReschedule, useCancelRescheduleRequest } from "@/lib/db/queries";

function toLocalInputValue(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function RescheduleSection({
  bookingId,
  viewer,
  customerId,
  status,
  currentStart,
  currentEnd,
}: {
  bookingId: string;
  viewer: "customer" | "provider";
  customerId: string;
  status: string;
  currentStart: string;
  currentEnd: string;
}) {
  const { t } = useTranslation();
  const reqQ = useRescheduleRequests(bookingId);
  const requestReschedule = useRequestReschedule();
  const respond = useRespondReschedule();
  const cancelReq = useCancelRescheduleRequest();

  const [showRequestForm, setShowRequestForm] = useState(false);
  const [proposedStart, setProposedStart] = useState(() => toLocalInputValue(currentStart));
  const [durationHours, setDurationHours] = useState(() => Math.max(1, Math.round((+new Date(currentEnd) - +new Date(currentStart)) / 3600000)));
  const [reason, setReason] = useState("");

  const [counterOpen, setCounterOpen] = useState(false);
  const [counterStart, setCounterStart] = useState(() => toLocalInputValue(currentStart));
  const [counterHours, setCounterHours] = useState(() => Math.max(1, Math.round((+new Date(currentEnd) - +new Date(currentStart)) / 3600000)));
  const [counterReason, setCounterReason] = useState("");

  const [rejectOpen, setRejectOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const reschedulable = status === "pending" || status === "confirmed";
  const rows = reqQ.data ?? [];
  const open = rows.find((r: any) => r.status === "pending");
  const requestedByCustomer = open ? open.requested_by === customerId : false;
  const awaitingMe = open ? (viewer === "customer" ? !requestedByCustomer : requestedByCustomer) : false;
  const isMine = open ? !awaitingMe : false;

  if (!reschedulable && rows.length === 0) return null;

  const submitRequest = () => {
    const start = new Date(proposedStart);
    const end = new Date(start.getTime() + durationHours * 3600000);
    requestReschedule.mutate(
      { bookingId, proposedStart: start.toISOString(), proposedEnd: end.toISOString(), reason: reason || undefined },
      {
        onSuccess: () => { setShowRequestForm(false); setReason(""); toast.success(t("reschedule.requested", "Reschedule requested")); },
        onError: (e: any) => toast.error(e?.message ?? t("common.somethingWentWrong")),
      },
    );
  };

  const submitAccept = () => {
    if (!open) return;
    respond.mutate(
      { requestId: open.id, bookingId, action: "accept" },
      {
        onSuccess: () => toast.success(t("reschedule.accepted", "Reschedule accepted")),
        onError: (e: any) => toast.error(e?.message ?? t("common.somethingWentWrong")),
      },
    );
  };

  const submitReject = (r: string) => {
    if (!open) return;
    respond.mutate(
      { requestId: open.id, bookingId, action: "reject", reason: r },
      {
        onSuccess: () => { setRejectOpen(false); toast.success(t("reschedule.declined", "Reschedule declined")); },
        onError: (e: any) => toast.error(e?.message ?? t("common.somethingWentWrong")),
      },
    );
  };

  const submitCounter = () => {
    if (!open) return;
    const start = new Date(counterStart);
    const end = new Date(start.getTime() + counterHours * 3600000);
    respond.mutate(
      { requestId: open.id, bookingId, action: "counter", reason: counterReason || undefined, counterStart: start.toISOString(), counterEnd: end.toISOString() },
      {
        onSuccess: () => { setCounterOpen(false); setCounterReason(""); toast.success(t("reschedule.counterSent", "Alternative time proposed")); },
        onError: (e: any) => toast.error(e?.message ?? t("common.somethingWentWrong")),
      },
    );
  };

  const submitCancel = () => {
    if (!open) return;
    cancelReq.mutate(
      { requestId: open.id, bookingId },
      {
        onSuccess: () => { setCancelOpen(false); toast.success(t("reschedule.withdrawn", "Request withdrawn")); },
        onError: (e: any) => toast.error(e?.message ?? t("common.somethingWentWrong")),
      },
    );
  };

  const locale = "en-US";
  const fmt = (iso: string) => new Date(iso).toLocaleString(locale, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <Card className="mt-4 p-5">
      <div className="mb-3 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
        <CalendarClock className="h-3.5 w-3.5" /> {t("reschedule.title", "Rescheduling")}
      </div>

      {open ? (
        <div className="rounded-2xl bg-surface-2 p-3">
          <div className="text-sm font-bold">{t("reschedule.proposedTime", "Proposed time")}</div>
          <div className="mt-0.5 text-sm">{fmt(open.proposed_start_at)}</div>
          {open.request_reason && <div className="mt-1 text-xs text-muted-foreground">{open.request_reason}</div>}

          {awaitingMe ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={submitAccept} disabled={respond.isPending} className="inline-flex items-center gap-1.5 rounded-xl bg-navy px-3 py-2 text-xs font-bold text-navy-foreground disabled:opacity-50">
                <Check className="h-3.5 w-3.5" /> {t("reschedule.accept", "Accept")}
              </button>
              <button onClick={() => setRejectOpen(true)} disabled={respond.isPending} className="inline-flex items-center gap-1.5 rounded-xl bg-coral/10 px-3 py-2 text-xs font-bold text-coral disabled:opacity-50">
                <X className="h-3.5 w-3.5" /> {t("reschedule.reject", "Decline")}
              </button>
              {viewer === "provider" && (
                <button onClick={() => setCounterOpen((v) => !v)} disabled={respond.isPending} className="inline-flex items-center gap-1.5 rounded-xl bg-surface px-3 py-2 text-xs font-bold shadow-soft disabled:opacity-50">
                  <RefreshCw className="h-3.5 w-3.5" /> {t("reschedule.proposeOther", "Propose another time")}
                </button>
              )}
            </div>
          ) : (
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-muted-foreground">{t("reschedule.waiting", "Waiting for a response…")}</span>
              {isMine && (
                <button onClick={() => setCancelOpen(true)} className="text-xs font-bold text-coral">{t("reschedule.withdraw", "Withdraw")}</button>
              )}
            </div>
          )}

          {counterOpen && viewer === "provider" && (
            <div className="mt-3 space-y-2 border-t border-border pt-3">
              <input type="datetime-local" value={counterStart} onChange={(e) => setCounterStart(e.target.value)}
                className="h-10 w-full rounded-xl border border-border bg-surface px-2 text-sm" />
              <input type="number" min={1} step={1} value={counterHours} onChange={(e) => setCounterHours(Math.max(1, parseInt(e.target.value) || 1))}
                placeholder={t("reschedule.durationHours", "Duration (hours)")}
                className="h-10 w-full rounded-xl border border-border bg-surface px-2 text-sm" />
              <input value={counterReason} onChange={(e) => setCounterReason(e.target.value)} placeholder={t("reschedule.reasonOptional", "Reason (optional)")}
                className="h-10 w-full rounded-xl border border-border bg-surface px-2 text-sm" />
              <button onClick={submitCounter} disabled={respond.isPending} className="h-10 w-full rounded-xl bg-navy text-sm font-bold text-navy-foreground disabled:opacity-50">
                {respond.isPending ? t("common.saving") : t("reschedule.sendProposal", "Send proposal")}
              </button>
            </div>
          )}
        </div>
      ) : reschedulable ? (
        showRequestForm ? (
          <div className="space-y-2">
            <input type="datetime-local" value={proposedStart} onChange={(e) => setProposedStart(e.target.value)}
              className="h-10 w-full rounded-xl border border-border bg-surface px-2 text-sm" />
            <input type="number" min={1} step={1} value={durationHours} onChange={(e) => setDurationHours(Math.max(1, parseInt(e.target.value) || 1))}
              placeholder={t("reschedule.durationHours", "Duration (hours)")}
              className="h-10 w-full rounded-xl border border-border bg-surface px-2 text-sm" />
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("reschedule.reasonOptional", "Reason (optional)")}
              className="h-10 w-full rounded-xl border border-border bg-surface px-2 text-sm" />
            <div className="flex gap-2">
              <button onClick={submitRequest} disabled={requestReschedule.isPending} className="h-10 flex-1 rounded-xl bg-navy text-sm font-bold text-navy-foreground disabled:opacity-50">
                {requestReschedule.isPending ? t("common.saving") : t("reschedule.sendRequest", "Send request")}
              </button>
              <button onClick={() => setShowRequestForm(false)} className="h-10 rounded-xl border border-border px-4 text-sm font-bold">{t("common.cancel")}</button>
            </div>
          </div>
        ) : viewer === "customer" ? (
          <button onClick={() => setShowRequestForm(true)} className="text-sm font-bold text-navy">{t("reschedule.requestButton", "Request a different time")}</button>
        ) : (
          <p className="text-xs text-muted-foreground">{t("reschedule.noneOpen", "No open reschedule request.")}</p>
        )
      ) : null}

      {rows.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[11px] font-bold text-muted-foreground">{t("reschedule.history", "History")}</summary>
          <ul className="mt-2 space-y-1.5">
            {rows.map((r: any) => (
              <li key={r.id} className="text-[11px] text-muted-foreground">
                {(r.requested_by === customerId ? t("reschedule.byCustomer", "Customer") : t("reschedule.byProvider", "Provider"))}
                {" → "}{fmt(r.proposed_start_at)} · {String(t(`reschedule.status.${r.status}`, { defaultValue: r.status }))}
              </li>
            ))}
          </ul>
        </details>
      )}

      <ReasonDialog
        open={rejectOpen}
        title={t("reschedule.rejectTitle", "Decline this time?")}
        reasonPlaceholder={t("reschedule.rejectReasonPlaceholder", "Let them know why")}
        confirmLabel={t("reschedule.reject", "Decline")}
        cancelLabel={t("common.cancel")}
        confirmVariant="coral"
        requireReason
        pending={respond.isPending}
        onCancel={() => setRejectOpen(false)}
        onConfirm={submitReject}
      />
      <ReasonDialog
        open={cancelOpen}
        title={t("reschedule.withdrawTitle", "Withdraw this request?")}
        confirmLabel={t("reschedule.withdraw", "Withdraw")}
        cancelLabel={t("common.cancel")}
        confirmVariant="coral"
        requireReason={false}
        pending={cancelReq.isPending}
        onCancel={() => setCancelOpen(false)}
        onConfirm={submitCancel}
      />
    </Card>
  );
}
