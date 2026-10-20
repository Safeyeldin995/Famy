import { AdminLink as Link } from "@/components/admin/AdminNavigation";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useAdminBookings, useAdminResolveReschedule } from "@/lib/db/admin-queries";
import {
  adminControl,
  adminScreen,
  bookingCode,
  canCancelBooking,
  matchesBooking,
  operationDate,
} from "@/components/admin/operations";
import { AdminBookingReadContext } from "@/components/admin/AdminBookingReadContext";
import { useRescheduleRequests } from "@/lib/db/queries";
import { useCancelBooking } from "@/lib/db/cancellation-queries";
import { CancelBookingDialog } from "@/components/famio/ui";
import { formatEGP } from "@/lib/utils";
import {
  isExpiredCapturedPayment,
  isProviderNoResponseCancellation,
} from "@/lib/booking/pending-expiry";
import { Search } from "lucide-react";
import { AdminQueryError } from "@/components/admin/AdminQueryError";

function AdminCancellationDetails({ cancellation }: { cancellation: any }) {
  const { t, i18n } = useTranslation();
  return (
    <div className="mt-3 space-y-1 rounded-xl border border-border/60 bg-surface p-3 text-xs">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
        {t("admin.bookings.cancellationDetails")}
      </p>
      <p>
        <span className="text-muted-foreground">{t("admin.bookings.reason")}:</span>{" "}
        {i18n.language.startsWith("ar") ? cancellation.reason_name_ar : cancellation.reason_name_en}
      </p>
      {cancellation.note && (
        <p>
          <span className="text-muted-foreground">{t("admin.bookings.note")}:</span>{" "}
          {cancellation.note}
        </p>
      )}
      <p>
        <span className="text-muted-foreground">{t("admin.bookings.cancelledBy")}:</span>{" "}
        {t(`adminOps.roles.${cancellation.cancelled_by_role}`, {
          defaultValue: t("adminOps.unknown"),
        })}
      </p>
      <p>
        <span className="text-muted-foreground">{t("admin.bookings.at")}:</span>{" "}
        {operationDate(cancellation.cancelled_at, i18n.language)}
      </p>
    </div>
  );
}

function AdminRescheduleHistory({
  bookingId,
  customerId,
}: {
  bookingId: string;
  customerId: string;
}) {
  const { t, i18n } = useTranslation();
  const reqQ = useRescheduleRequests(bookingId);
  const resolve = useAdminResolveReschedule();
  const [reason, setReason] = useState("");
  const rows = reqQ.data ?? [];
  const open = rows.find((r: any) => r.status === "pending");

  if (rows.length === 0)
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        {t("admin.bookings.noRescheduleHistory")}
      </p>
    );

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
        {t("admin.bookings.rescheduleHistory")}
      </p>
      <ul className="space-y-1">
        {rows.map((r: any) => (
          <li key={r.id} className="text-xs text-muted-foreground">
            {t("admin.bookings.rescheduleProposed", {
              who:
                r.requested_by === customerId
                  ? t("admin.bookings.customer")
                  : t("admin.bookings.provider"),
              date: operationDate(r.proposed_start_at, i18n.language),
              status: t(`adminOps.status.${r.status}`, { defaultValue: t("adminOps.unknown") }),
            })}
            {r.response_reason ? ` (${r.response_reason})` : ""}
          </li>
        ))}
      </ul>
      {open && (
        <div className="space-y-2 rounded-xl border border-coral/30 bg-coral/5 p-2">
          <p className="text-xs font-bold text-coral">{t("admin.bookings.adminIntervene")}</p>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("admin.provider.reasonRequired")}
            aria-label={t("admin.provider.reasonRequired")}
            className="focus-ring h-9 w-full rounded-lg border border-border bg-surface px-2 text-xs"
          />
          <div className="flex gap-2">
            <button
              disabled={!reason.trim() || resolve.isPending}
              onClick={() =>
                resolve.mutate(
                  { requestId: open.id, bookingId, action: "accept", reason },
                  { onSuccess: () => setReason("") },
                )
              }
              className="focus-ring rounded-lg bg-brand px-3 py-1.5 text-xs font-bold text-brand-foreground disabled:opacity-50"
            >
              {t("admin.bookings.forceAccept")}
            </button>
            <button
              disabled={!reason.trim() || resolve.isPending}
              onClick={() =>
                resolve.mutate(
                  { requestId: open.id, bookingId, action: "reject", reason },
                  { onSuccess: () => setReason("") },
                )
              }
              className="focus-ring rounded-lg border border-coral px-3 py-1.5 text-xs font-bold text-coral disabled:opacity-50"
            >
              {t("admin.bookings.forceReject")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute("/admin/bookings")({
  component: AdminBookingsRoute,
  validateSearch: (
    search: Record<string, unknown>,
  ): { status?: string; statuses?: string; booking?: string } => ({
    ...(typeof search.booking === "string" ? { booking: search.booking } : {}),
    ...(typeof search.status === "string" ? { status: search.status } : {}),
    ...(search.statuses === "disputed,no_show" ? { statuses: search.statuses } : {}),
  }),
});

// Real booking_status enum: pending, confirmed, in_progress, completed,
// cancelled, no_show. "Accepted" in the product brief maps to "confirmed" —
// there is no separate "accepted" state in the schema. completion_requested
// is included so the Operations dashboard can deep-link into it.
const STATUS_FILTERS = [
  { key: "disputed", labelKey: "adminOps.status.disputed" },
  { key: "pending", labelKey: "admin.bookings.status.pending" },
  { key: "confirmed", labelKey: "admin.bookings.status.confirmed" },
  { key: "in_progress", labelKey: "admin.bookings.status.inProgress" },
  { key: "completion_requested", labelKey: "admin.bookings.status.completionRequested" },
  { key: "completed", labelKey: "admin.bookings.status.completed" },
  { key: "cancelled", labelKey: "admin.bookings.status.cancelled" },
  { key: "no_show", labelKey: "admin.bookings.status.noShow" },
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

export function AdminBookings({
  search,
}: {
  search: { status?: string; statuses?: string; booking?: string };
}) {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<string>(
    search.statuses ? "problems" : (search.status ?? ""),
  );
  const [query, setQuery] = useState(search.booking ?? "");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const q = useAdminBookings(status === "problems" ? ["disputed", "no_show"] : status || undefined);
  const cancelBooking = useCancelBooking();
  const cancelTarget = (q.data ?? []).find((b: any) => b.id === cancelId) as any;

  const rows = useMemo(() => {
    const all = q.data ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((b: any) => matchesBooking(b, needle));
  }, [q.data, query]);

  return (
    <div className={adminScreen}>
      <div>
        <h1 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
          {t("admin.bookings.title")}
        </h1>
        <p className="text-xs text-muted-foreground">{t("admin.bookings.subtitle")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-10 min-w-[260px] flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("adminOps.search")}
            aria-label={t("adminOps.search")}
            className="w-full bg-transparent text-sm outline-none"
          />
        </div>
        <div className="flex w-full flex-wrap gap-2" aria-label={t("admin.bookings.allStatuses")}>
          {[
            { key: "", labelKey: "adminOps.all" },
            { key: "problems", labelKey: "adminWorkQueue.bookings_needing_action" },
            ...STATUS_FILTERS,
          ].map((s) => (
            <button
              key={s.key}
              aria-pressed={status === s.key}
              onClick={() => setStatus(s.key)}
              className={`${adminControl} ${status === s.key ? "bg-brand text-brand-foreground" : "bg-surface"}`}
            >
              {t(s.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {q.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : q.isError ? (
        <AdminQueryError
          message={t("admin.bookings.loadError")}
          error={q.error}
          onRetry={() => q.refetch()}
        />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("admin.bookings.noResults")}</p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-2xl border border-border/60 bg-surface shadow-sm">
          {rows.map((b: any) => {
            const payment = latestPayment(b.payments);
            const isOpen = expanded === b.id;
            return (
              <li key={b.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-x-1 text-sm font-bold">
                      <Link
                        to={"/admin/customer/$id" as const}
                        params={{ id: b.customer_id }}
                        className="inline-flex min-h-11 items-center text-brand hover:underline"
                      >
                        {b.customer?.full_name || t("admin.bookings.customer")}
                      </Link>
                      {" → "}
                      <Link
                        to={"/admin/provider/$id" as const}
                        params={{ id: b.provider?.id }}
                        className="inline-flex min-h-11 items-center text-brand hover:underline"
                      >
                        {b.provider?.profile?.full_name || t("admin.bookings.provider")}
                      </Link>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {operationDate(b.start_at, i18n.language)} ·{" "}
                      {formatEGP(Number(b.price_total ?? 0))}
                    </p>
                    <p className="text-sm">
                      {i18n.language.startsWith("ar") ? b.service?.name_ar : b.service?.name_en}
                    </p>
                    <bdi dir="ltr" className="font-mono text-xs text-muted-foreground">
                      {bookingCode(b.id)}
                    </bdi>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="rounded-full bg-muted px-2 py-1 text-xs font-bold">
                      {t(`adminOps.status.${b.status}`, { defaultValue: t("adminOps.unknown") })}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase ${paymentTone(payment?.status)}`}
                    >
                      {payment
                        ? t(`adminOps.status.${payment.status}`, {
                            defaultValue: t("adminOps.unknown"),
                          })
                        : t("admin.bookings.noPayment")}
                    </span>
                    {isProviderNoResponseCancellation(b) &&
                    (b.payments ?? []).some((p: any) => isExpiredCapturedPayment(p)) ? (
                      <span className="rounded-full bg-coral/10 px-2 py-0.5 text-xs font-bold uppercase text-coral">
                        {t("admin.bookings.expiredCaptured")}
                      </span>
                    ) : isProviderNoResponseCancellation(b) ? (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold uppercase">
                        {t("admin.bookings.expiredNoResponse")}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {(b.status === "disputed" || b.status === "no_show") && (
                    <Link
                      className={adminControl}
                      to={"/admin/cases" as const}
                      search={{
                        tab: b.status === "disputed" ? "disputes" : "no_shows",
                        booking: b.id,
                      }}
                    >
                      {t(b.status === "disputed" ? "adminOps.dispute" : "adminOps.noShow")}
                    </Link>
                  )}
                  {canCancelBooking(b.status) && (
                    <button
                      onClick={() => setCancelId(b.id)}
                      className="focus-ring rounded-lg border border-coral px-3 py-1.5 text-xs font-bold text-coral"
                    >
                      {t("adminOps.cancel")}
                    </button>
                  )}
                  <button
                    onClick={() => setExpanded(isOpen ? null : b.id)}
                    className="focus-ring rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground"
                  >
                    {isOpen ? t("adminOps.hide") : t("adminOps.details")}
                  </button>
                </div>

                {b.status === "cancelled" && isProviderNoResponseCancellation(b) && (
                  <p className="mt-2 text-xs font-semibold text-muted-foreground">
                    {t("bookingDetail.expiredReason")}
                  </p>
                )}
                {b.status === "cancelled" && b.cancellation && (
                  <AdminCancellationDetails cancellation={b.cancellation} />
                )}

                {isOpen && (
                  <div className="mt-3">
                    {b.family_member && (
                      <div className="mb-3 space-y-1 rounded-xl border border-border/60 bg-surface p-3 text-xs">
                        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                          {t("admin.bookings.familyMemberSnapshot")}
                        </p>
                        <p>
                          <span className="text-muted-foreground">{t("admin.bookings.for")}:</span>{" "}
                          {b.family_member.full_name} (
                          {b.family_member.relationship === "other"
                            ? b.family_member.relationship_other || t("admin.bookings.other")
                            : t(`familyMembers.relationships.${b.family_member.relationship}`, {
                                defaultValue: t("admin.bookings.other"),
                              })}
                          )
                        </p>
                        {b.family_member.date_of_birth && (
                          <p>
                            <span className="text-muted-foreground">
                              {t("admin.bookings.dob")}:
                            </span>{" "}
                            {b.family_member.date_of_birth}
                          </p>
                        )}
                        {b.family_member.phone && (
                          <p>
                            <span className="text-muted-foreground">
                              {t("admin.bookings.phone")}:
                            </span>{" "}
                            <span dir="ltr">{b.family_member.phone}</span>
                          </p>
                        )}
                        {b.family_member.allergies && (
                          <p>
                            <span className="text-muted-foreground">
                              {t("admin.bookings.allergies")}:
                            </span>{" "}
                            {b.family_member.allergies}
                          </p>
                        )}
                        {b.family_member.medical_notes && (
                          <p>
                            <span className="text-muted-foreground">
                              {t("admin.bookings.medicalNotes")}:
                            </span>{" "}
                            {b.family_member.medical_notes}
                          </p>
                        )}
                        {b.family_member.access_notes && (
                          <p>
                            <span className="text-muted-foreground">
                              {t("admin.bookings.accessNotes")}:
                            </span>{" "}
                            {b.family_member.access_notes}
                          </p>
                        )}
                        {b.family_member.emergency_contact_name && (
                          <p>
                            <span className="text-muted-foreground">
                              {t("admin.bookings.emergencyContact")}:
                            </span>{" "}
                            {b.family_member.emergency_contact_name}{" "}
                            {b.family_member.emergency_contact_phone && (
                              <span dir="ltr">({b.family_member.emergency_contact_phone})</span>
                            )}
                          </p>
                        )}
                      </div>
                    )}
                    <AdminBookingReadContext bookingId={b.id} status={b.status} />
                    <AdminRescheduleHistory bookingId={b.id} customerId={b.customer_id} />
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
        title={t("admin.bookings.cancelDialogTitle")}
        body={t("admin.bookings.cancelDialogBody")}
        reasonLabel={t("admin.bookings.reason")}
        notePlaceholder={t("admin.bookings.addNote")}
        confirmLabel={t("admin.bookings.cancelBooking")}
        cancelLabel={t("admin.bookings.keepBooking")}
        pending={cancelBooking.isPending}
        onCancel={() => setCancelId(null)}
        onConfirm={(reasonId, note) =>
          cancelBooking.mutate(
            { bookingId: cancelId!, reasonId, note },
            {
              onSuccess: () => {
                setCancelId(null);
                toast.success(t("admin.bookings.cancelSuccess"));
              },
              onError: () => toast.error(t("adminOps.actionError")),
            },
          )
        }
      />
    </div>
  );
}

function AdminBookingsRoute() {
  const search = Route.useSearch();
  return <AdminBookings search={search} />;
}
