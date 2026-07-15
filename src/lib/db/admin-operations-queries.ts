/**
 * Admin Operations dashboard — Famy Patch 4 / Module 2. All counts/ages come
 * from admin_operations_summary() (one round trip, server-side aggregation —
 * see 20260716020000_admin_operations_and_audit_trail.sql). The four queues
 * with no existing dedicated/filterable admin screen (pending provider
 * services, flagged pricing, pending requirement reviews, notification
 * delivery failures) also get a small bounded row list so the queue is
 * directly actionable from this page; the others link into the existing
 * filtered screens (/admin/bookings, /admin/payments, /admin/cases).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type OperationsQueueKey =
  | 'pending_provider_services'
  | 'pending_requirement_reviews'
  | 'flagged_provider_pricing'
  | 'open_disputes'
  | 'open_no_show_reports'
  | 'open_support_tickets'
  | 'stuck_completion_requests'
  | 'payments_needing_review'
  | 'notification_delivery_failures';

export type OperationsSummaryRow = {
  queue: OperationsQueueKey;
  item_count: number;
  oldest_at: string | null;
};

export function useAdminOperationsSummary() {
  return useQuery({
    queryKey: ['admin', 'operations-summary'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_operations_summary');
      if (error) throw error;
      return (data ?? []) as OperationsSummaryRow[];
    },
    refetchInterval: 60_000,
  });
}

const ROW_LIMIT = 10;

export function useAdminPendingProviderServices() {
  return useQuery({
    queryKey: ['admin', 'operations', 'pending-provider-services'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('provider_services')
        .select('id, provider_id, created_at, provider:providers(id, profile:profiles(full_name)), service:services(name_en, name_ar)')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(ROW_LIMIT);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAdminFlaggedProviderPricing() {
  return useQuery({
    queryKey: ['admin', 'operations', 'flagged-provider-pricing'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('provider_services')
        .select('id, provider_id, price_override, created_at, provider:providers(id, profile:profiles(full_name)), service:services(name_en, name_ar)')
        .eq('flagged_for_review', true)
        .order('created_at', { ascending: true })
        .limit(ROW_LIMIT);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAdminPendingRequirementReviews() {
  return useQuery({
    queryKey: ['admin', 'operations', 'pending-requirement-reviews'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('provider_requirement_fulfillments')
        .select('id, provider_id, created_at, evidence_storage_path, provider:providers(id, profile:profiles(full_name)), requirement:service_requirements(name_en, name_ar, service:services(name_en, name_ar))')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(ROW_LIMIT);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export type NotificationFailureRow = {
  id: string;
  recipient_user_id: string;
  status: string;
  attempts: number;
  last_error_safe: string | null;
  created_at: string;
  next_attempt_at: string;
};

export function useAdminNotificationFailures() {
  return useQuery({
    queryKey: ['admin', 'operations', 'notification-failures'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notification_outbox')
        .select('id, recipient_user_id, status, attempts, last_error_safe, created_at, next_attempt_at')
        .in('status', ['failed', 'dead'])
        .order('created_at', { ascending: true })
        .limit(ROW_LIMIT);
      if (error) throw error;
      return (data ?? []) as NotificationFailureRow[];
    },
  });
}

export function useAdminRetryNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('admin_retry_notification', { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'operations'] });
    },
  });
}
