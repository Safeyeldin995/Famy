import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normalizeDigitsToWestern } from "@/lib/otp/normalizePhone";

export type ProviderStatementRow = {
  id: string;
  created_at: string;
  booking_id: string | null;
  booking_code: string | null;
  price_total: number | null;
  commission: number | null;
  provider_share: number | null;
  kind: string;
  direction: "credit" | "debit";
  amount: number;
  note: string | null;
  payment_method: string | null;
  settlement_id: string | null;
};

export type ProviderStatement = {
  provider_id: string;
  provider_name: string;
  period_from: string;
  period_to: string;
  opening_balance: number;
  closing_balance: number;
  period_net: number;
  rows: ProviderStatementRow[];
};

export function useAdminProviderStatement(
  providerId: string | undefined,
  from: string | undefined,
  to: string | undefined,
) {
  return useQuery({
    enabled: !!providerId && !!from && !!to,
    queryKey: ["admin", "provider-statement", providerId, from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_provider_statement", {
        p_provider_id: providerId!,
        p_from: from!,
        p_to: to!,
      });
      if (error) throw error;
      return data as ProviderStatement;
    },
  });
}

export type ReportBucket = {
  bucket_start: string;
  bookings_created: number;
  bookings_completed: number;
  bookings_cancelled: number;
  revenue: number;
  platform_commission: number;
  cash_collected: number;
  card_received: number;
  instapay_received: number;
  refunds_total: number;
  cancellation_fees: number;
};

export type AdminReport = {
  period_from: string;
  period_to: string;
  group: "day" | "week" | "month";
  timezone: string;
  buckets: ReportBucket[];
  totals: Omit<ReportBucket, "bucket_start">;
  date_basis: Record<string, { basis: string; timestamp: string }>;
};

export function useAdminReports(
  from: string | undefined,
  to: string | undefined,
  group: "day" | "week" | "month",
) {
  return useQuery({
    enabled: !!from && !!to,
    queryKey: ["admin", "reports", from, to, group],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_reports", {
        p_from: from!,
        p_to: to!,
        p_group: group,
      });
      if (error) throw error;
      return data as AdminReport;
    },
  });
}

export type PaymentQueueTab =
  | "needs_action"
  | "refunds_due"
  | "receipts_ready"
  | "cash_to_confirm"
  | "paymob";

export function useAdminPaymentQueue(
  tab: PaymentQueueTab,
  page: number,
  query: string,
  pageSize = 50,
  enabled = true,
) {
  const q = query.trim();
  return useQuery({
    enabled,
    queryKey: ["admin", "payment-queue", tab, q, page, pageSize],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_payment_queue", {
        p_tab: tab,
        p_query: q,
        p_limit: pageSize,
        p_offset: page * pageSize,
      });
      if (error) throw error;
      return data as { total: number; items: unknown[]; tab: string; limit: number; offset: number };
    },
  });
}

export function useAdminPaymentQueueCounts() {
  return useQuery({
    queryKey: ["admin", "payment-queue-counts"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_payment_queue_counts");
      if (error) throw error;
      return data as {
        needs_action: number;
        refunds_due: number;
        receipts_ready: number;
        cash_to_confirm: number;
        fee_payments: number;
        paymob: number;
      };
    },
  });
}

export function useAdminResolvePaymobFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      paymentId?: string | null;
      unmappedTransactionId?: number | null;
      note: string;
    }) => {
      const { error } = await (supabase.rpc as any)("admin_resolve_paymob_flag", {
        p_payment_id: input.paymentId ?? null,
        p_unmapped_transaction_id: input.unmappedTransactionId ?? null,
        p_note: input.note,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "payment-queue"] });
      qc.invalidateQueries({ queryKey: ["admin", "payment-queue-counts"] });
      qc.invalidateQueries({ queryKey: ["admin", "payments"] });
    },
  });
}

export type GlobalSearchGroup<T> = { total: number; items: T[] };

export type AdminGlobalSearchResult = {
  query: string;
  customers: GlobalSearchGroup<{
    id: string;
    full_name: string | null;
    phone: string | null;
  }>;
  providers: GlobalSearchGroup<{
    provider_id: string;
    full_name: string | null;
    phone: string | null;
  }>;
  bookings: GlobalSearchGroup<{
    id: string;
    booking_code: string;
    status: string;
    customer_name: string | null;
    provider_name: string | null;
  }>;
};

export function useAdminGlobalSearch(query: string, enabled: boolean) {
  // A phone typed with Arabic digits matches the stored 0-9 digits.
  const trimmed = normalizeDigitsToWestern(query).trim();
  return useQuery({
    enabled: enabled && trimmed.length >= 2,
    queryKey: ["admin", "global-search", trimmed],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_global_search", {
        p_query: trimmed,
        p_limit: 15,
        p_offset: 0,
      });
      if (error) throw error;
      return data as AdminGlobalSearchResult;
    },
  });
}