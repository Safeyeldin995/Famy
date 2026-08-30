import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type MonitoringSummary = {
  recent_errors: number;
  failed_payments: number;
  failed_notifications: number;
  oldest_error_at: string | null;
  oldest_failed_payment_at: string | null;
  oldest_failed_notification_at: string | null;
};

export type ErrorLogRow = {
  id: string;
  created_at: string;
  message_safe: string;
  source: string;
  context_route: string | null;
  context_label: string | null;
};

export type FailedPaymentRow = {
  id: string;
  status: string;
  created_at: string;
  booking_id: string;
};

export type FailedNotificationRow = {
  id: string;
  status: string;
  attempts: number;
  last_error_safe: string | null;
  created_at: string;
};

const MONITORING_WINDOW_DAYS = 7;
const ROW_LIMIT = 10;

export function useAdminMonitoringSummary() {
  return useQuery({
    queryKey: ["admin", "monitoring-summary", MONITORING_WINDOW_DAYS],
    queryFn: async () => {
      const since = new Date(Date.now() - MONITORING_WINDOW_DAYS * 86_400_000).toISOString();
      const { data, error } = await supabase.rpc("admin_monitoring_summary", { p_since: since });
      if (error) throw error;
      const row = (data ?? [])[0] as MonitoringSummary | undefined;
      return {
        recent_errors: Number(row?.recent_errors ?? 0),
        failed_payments: Number(row?.failed_payments ?? 0),
        failed_notifications: Number(row?.failed_notifications ?? 0),
        oldest_error_at: row?.oldest_error_at ?? null,
        oldest_failed_payment_at: row?.oldest_failed_payment_at ?? null,
        oldest_failed_notification_at: row?.oldest_failed_notification_at ?? null,
      } satisfies MonitoringSummary;
    },
    refetchInterval: 60_000,
  });
}

export function useAdminRecentErrorLogs() {
  return useQuery({
    queryKey: ["admin", "monitoring", "error-logs", MONITORING_WINDOW_DAYS],
    queryFn: async () => {
      const since = new Date(Date.now() - MONITORING_WINDOW_DAYS * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("error_logs")
        .select("id, created_at, message_safe, source, context_route, context_label")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(ROW_LIMIT);
      if (error) throw error;
      return (data ?? []) as ErrorLogRow[];
    },
  });
}

export function useAdminRecentFailedPayments() {
  return useQuery({
    queryKey: ["admin", "monitoring", "failed-payments"],
    queryFn: async () => {
      const since = new Date(Date.now() - MONITORING_WINDOW_DAYS * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("payments")
        .select("id, status, created_at, booking_id")
        .in("status", ["failed", "rejected"])
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(ROW_LIMIT);
      if (error) throw error;
      return (data ?? []) as FailedPaymentRow[];
    },
  });
}

export function useAdminRecentFailedNotifications() {
  return useQuery({
    queryKey: ["admin", "monitoring", "failed-notifications"],
    queryFn: async () => {
      const since = new Date(Date.now() - MONITORING_WINDOW_DAYS * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("notification_outbox")
        .select("id, status, attempts, last_error_safe, created_at")
        .in("status", ["failed", "dead"])
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(ROW_LIMIT);
      if (error) throw error;
      return (data ?? []) as FailedNotificationRow[];
    },
  });
}
