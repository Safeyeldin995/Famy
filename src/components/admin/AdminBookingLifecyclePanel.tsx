import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { operationDate } from "./operations";
import {
  useAdminSetBookingSessionTimes,
  useAdminSetBookingStatus,
} from "@/lib/db/admin-queries";
import type { Database } from "@/integrations/supabase/types";

type TargetStatus = Database["public"]["Enums"]["booking_status"];

const TARGET_STATUSES: TargetStatus[] = [
  "confirmed",
  "on_the_way",
  "arrived",
  "arrival_confirmed",
  "in_progress",
  "completion_requested",
  "completed",
  "cancelled",
];

export function AdminBookingLifecyclePanel({
  booking,
}: {
  booking: {
    id: string;
    status: string;
    start_at: string;
    end_at: string;
    created_at: string;
    status_changed_at?: string | null;
    arrival_confirmed_at?: string | null;
    session_started_at?: string | null;
    session_ended_at?: string | null;
    completion_requested_at?: string | null;
    completed_at?: string | null;
    cancelled_at?: string | null;
  };
}) {
  const { t, i18n } = useTranslation();
  const setStatus = useAdminSetBookingStatus();
  const setTimes = useAdminSetBookingSessionTimes();
  const [targetStatus, setTargetStatus] = useState(booking.status as TargetStatus);
  const [reason, setReason] = useState("");
  const [sessionStarted, setSessionStarted] = useState(booking.session_started_at?.slice(0, 16) ?? "");
  const [sessionEnded, setSessionEnded] = useState(booking.session_ended_at?.slice(0, 16) ?? "");
  const [arrivalConfirmed, setArrivalConfirmed] = useState(
    booking.arrival_confirmed_at?.slice(0, 16) ?? "",
  );

  const timeline = [
    { key: "created", at: booking.created_at },
    { key: "status", at: booking.status_changed_at },
    { key: "arrival_confirmed", at: booking.arrival_confirmed_at },
    { key: "session_started", at: booking.session_started_at },
    { key: "session_ended", at: booking.session_ended_at },
    { key: "completion_requested", at: booking.completion_requested_at },
    { key: "completed", at: booking.completed_at },
    { key: "cancelled", at: booking.cancelled_at },
  ].filter((row) => row.at);

  return (
    <div className="mt-4 space-y-4 rounded-xl border border-border/60 bg-surface p-3 text-xs">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {t("admin.bookings.lifecycleTimeline")}
        </p>
        <ol className="mt-2 space-y-1">
          {timeline.map((row) => (
            <li key={row.key}>
              <span className="font-semibold">{t(`admin.bookings.lifecycle.${row.key}`)}: </span>
              {operationDate(row.at!, i18n.language)}
            </li>
          ))}
        </ol>
      </div>

      <div className="space-y-2">
        <p className="font-bold">{t("admin.bookings.changeStatus")}</p>
        <select
          value={targetStatus}
          onChange={(e) => setTargetStatus(e.target.value as TargetStatus)}
          className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm"
        >
          {TARGET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`adminOps.status.${s}`, { defaultValue: s })}
            </option>
          ))}
        </select>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("admin.bookings.statusReasonPlaceholder")}
          className="min-h-[72px] w-full rounded-lg border border-border bg-background px-2 py-2 text-sm"
        />
        <button
          type="button"
          disabled={!reason.trim() || setStatus.isPending}
          onClick={() =>
            setStatus.mutate(
              { bookingId: booking.id, status: targetStatus, reason: reason.trim() },
              {
                onSuccess: () => {
                  toast.success(t("admin.bookings.statusUpdated"));
                  setReason("");
                },
                onError: () => toast.error(t("adminOps.actionError")),
              },
            )
          }
          className="focus-ring rounded-lg bg-brand px-3 py-2 text-xs font-bold text-brand-foreground disabled:opacity-50"
        >
          {t("admin.bookings.applyStatus")}
        </button>
      </div>

      <div className="space-y-2">
        <p className="font-bold">{t("admin.bookings.sessionTimes")}</p>
        <label className="block">
          <span className="text-muted-foreground">{t("admin.bookings.sessionStarted")}</span>
          <input
            type="datetime-local"
            value={sessionStarted}
            onChange={(e) => setSessionStarted(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1"
          />
        </label>
        <label className="block">
          <span className="text-muted-foreground">{t("admin.bookings.sessionEnded")}</span>
          <input
            type="datetime-local"
            value={sessionEnded}
            onChange={(e) => setSessionEnded(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1"
          />
        </label>
        <label className="block">
          <span className="text-muted-foreground">{t("admin.bookings.arrivalConfirmedAt")}</span>
          <input
            type="datetime-local"
            value={arrivalConfirmed}
            onChange={(e) => setArrivalConfirmed(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1"
          />
        </label>
        <button
          type="button"
          disabled={!reason.trim() || setTimes.isPending}
          onClick={() =>
            setTimes.mutate(
              {
                bookingId: booking.id,
                reason: reason.trim(),
                sessionStartedAt: sessionStarted ? new Date(sessionStarted).toISOString() : null,
                sessionEndedAt: sessionEnded ? new Date(sessionEnded).toISOString() : null,
                arrivalConfirmedAt: arrivalConfirmed ? new Date(arrivalConfirmed).toISOString() : null,
              },
              {
                onSuccess: () => toast.success(t("admin.bookings.sessionTimesUpdated")),
                onError: () => toast.error(t("adminOps.actionError")),
              },
            )
          }
          className="focus-ring rounded-lg border border-border px-3 py-2 text-xs font-bold disabled:opacity-50"
        >
          {t("admin.bookings.saveSessionTimes")}
        </button>
      </div>
    </div>
  );
}
