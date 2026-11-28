import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invalidateAdminPaymentQueue } from "@/lib/db/admin-payment-invalidation";

// The RPCs below are added by 20261126170000_admin_wallet_ops.sql and are not
// in the generated types yet.
type UntypedRpc = (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
const rpc: UntypedRpc = (fn, args) =>
  (supabase.rpc as unknown as UntypedRpc).call(supabase, fn, args);

export type WalletRefundBlock =
  | "booking_not_found"
  | "no_held_money"
  | "booking_active"
  | "already_refunded"
  | "nothing_left"
  | "refunded_to_card"
  | "card_refund_unknown";

export type AdminRefundTerms = {
  booking_id: string;
  customer_id: string;
  booking_status: string;
  mode: "cancelled" | "completed" | "active";
  payment_id: string | null;
  payment_status: string | null;
  payment_method_type: string | null;
  funded_total: number;
  already_refunded: number;
  /** Returned to the card by Paymob; no longer held. */
  card_refunded: number;
  cancellation_fee: number;
  carried_fees: number;
  max_refundable: number;
  blocked: WalletRefundBlock | null;
};

export type AdminMoneyPayment = {
  id: string;
  status: string;
  method_type: string | null;
  method: string | null;
  amount: number;
  funded_total: number;
  wallet_applied: number;
  wallet_released: number;
  refund_amount: number;
  refund_channel: string | null;
  refund_reference: string | null;
  wallet_refunded_total: number;
  /** Returned to the card by Paymob (refund webhook). */
  gateway_refunded: number;
  gateway_refund_unknown: boolean;
  captured_at: string | null;
  created_at: string;
};

export type AdminMoneyWalletEntry = {
  id: string;
  direction: "credit" | "debit";
  amount: number;
  reason: string;
  created_at: string;
  admin_name: string | null;
  note: string | null;
};

export type AdminMoneyLedgerEntry = {
  kind: string;
  direction: "credit" | "debit";
  amount: number;
  created_at: string;
};

export type AdminBookingMoneySummary = {
  booking_id: string;
  status: string;
  service_mode: string | null;
  price_total: number;
  price_discount: number;
  carried_fees_amount: number;
  commission_amount: number | null;
  commission_percent: number | null;
  provider_net: number | null;
  payments: AdminMoneyPayment[];
  wallet_entries: AdminMoneyWalletEntry[];
  provider_ledger: AdminMoneyLedgerEntry[];
  refund_terms: AdminRefundTerms;
};

export type WalletCategory = "compensation" | "lesson_refund" | "correction" | "gift" | "other";
export const WALLET_CATEGORIES: WalletCategory[] = [
  "compensation",
  "lesson_refund",
  "correction",
  "gift",
  "other",
];

export type AdminWalletHistoryItem = {
  id: string;
  created_at: string;
  direction: "credit" | "debit";
  amount: number;
  reason: string;
  balance_after: number;
  booking_id: string | null;
  payment_id: string | null;
  admin_id: string | null;
  admin_name: string | null;
  category: WalletCategory | null;
  note: string | null;
};

export type AdminWalletLedgerItem = {
  id: string;
  created_at: string;
  customer_id: string;
  customer_name: string | null;
  direction: "credit" | "debit";
  amount: number;
  reason: string;
  booking_id: string | null;
  admin_id: string | null;
  admin_name: string | null;
  category: WalletCategory | null;
  note: string | null;
};

export type AdminOpsToday = {
  lessons_today: number;
  requests_today: number;
  completed_today: number;
  cancelled_today: number;
  paid_today: number;
  commission_today: number;
};

export type AdminOpsProblems = {
  paymob_flags: number;
  push_failures: number;
  app_errors: number;
  stuck_pending: number;
  stuck_active: number;
  attendance_failed: number;
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeRefundTerms(raw: Record<string, unknown>): AdminRefundTerms {
  return {
    booking_id: String(raw.booking_id ?? ""),
    customer_id: String(raw.customer_id ?? ""),
    booking_status: String(raw.booking_status ?? ""),
    mode: (raw.mode as AdminRefundTerms["mode"]) ?? "active",
    payment_id: (raw.payment_id as string | null) ?? null,
    payment_status: (raw.payment_status as string | null) ?? null,
    payment_method_type: (raw.payment_method_type as string | null) ?? null,
    funded_total: num(raw.funded_total),
    already_refunded: num(raw.already_refunded),
    card_refunded: num(raw.card_refunded),
    cancellation_fee: num(raw.cancellation_fee),
    carried_fees: num(raw.carried_fees),
    max_refundable: num(raw.max_refundable),
    blocked: (raw.blocked as WalletRefundBlock | null) ?? null,
  };
}

export function useAdminBookingMoney(bookingId: string | null | undefined) {
  return useQuery({
    queryKey: ["admin", "booking-money", bookingId],
    enabled: !!bookingId,
    queryFn: async (): Promise<AdminBookingMoneySummary> => {
      const { data, error } = await rpc("admin_booking_money_summary", { p_booking_id: bookingId });
      if (error) throw error;
      const raw = data as Record<string, unknown>;
      return {
        ...(raw as unknown as AdminBookingMoneySummary),
        price_total: num(raw.price_total),
        price_discount: num(raw.price_discount),
        carried_fees_amount: num(raw.carried_fees_amount),
        commission_amount: raw.commission_amount == null ? null : num(raw.commission_amount),
        provider_net: raw.provider_net == null ? null : num(raw.provider_net),
        refund_terms: normalizeRefundTerms((raw.refund_terms ?? {}) as Record<string, unknown>),
      };
    },
  });
}

export function useAdminRefundBookingToWallet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      bookingId: string;
      customerId: string;
      amount: number;
      note: string;
      idempotencyKey: string;
    }) => {
      const { data, error } = await rpc("admin_refund_booking_to_wallet", {
        p_booking_id: input.bookingId,
        p_amount: input.amount,
        p_note: input.note,
        p_idempotency_key: input.idempotencyKey,
      });
      if (error) throw error;
      return data as { wallet_entry_id: string; amount: number };
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ["admin", "booking-money", vars.bookingId] });
      void qc.invalidateQueries({ queryKey: ["admin", "customer", vars.customerId] });
      void qc.invalidateQueries({ queryKey: ["admin", "wallet-history", vars.customerId] });
      void qc.invalidateQueries({ queryKey: ["admin", "wallet-ledger"] });
      void qc.invalidateQueries({ queryKey: ["admin", "bookings"] });
      void qc.invalidateQueries({ queryKey: ["admin", "booking", vars.bookingId] });
      void qc.invalidateQueries({ queryKey: ["admin", "ops-problems"] });
      invalidateAdminPaymentQueue(qc);
    },
  });
}

export function useAdminWalletAdjust() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      customerId: string;
      direction: "credit" | "debit";
      amount: number;
      category: WalletCategory;
      note: string;
      bookingId?: string | null;
      idempotencyKey: string;
    }) => {
      const { data, error } = await rpc("admin_wallet_adjust", {
        p_customer_id: input.customerId,
        p_direction: input.direction,
        p_amount: input.amount,
        p_category: input.category,
        p_note: input.note.trim() || null,
        p_booking_id: input.bookingId ?? null,
        p_idempotency_key: input.idempotencyKey,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ["admin", "customer", vars.customerId] });
      void qc.invalidateQueries({ queryKey: ["admin", "wallet-history", vars.customerId] });
      void qc.invalidateQueries({ queryKey: ["admin", "wallet-ledger"] });
    },
  });
}

export function useAdminCustomerWalletHistory(customerId: string, page = 0, pageSize = 50) {
  return useQuery({
    queryKey: ["admin", "wallet-history", customerId, page, pageSize],
    enabled: !!customerId,
    queryFn: async () => {
      const { data, error } = await rpc("admin_customer_wallet_history", {
        p_customer_id: customerId,
        p_limit: pageSize,
        p_offset: page * pageSize,
      });
      if (error) throw error;
      const raw = data as { balance: unknown; total: unknown; items: AdminWalletHistoryItem[] };
      return {
        balance: num(raw.balance),
        total: num(raw.total),
        items: (raw.items ?? []).map((i) => ({
          ...i,
          amount: num(i.amount),
          balance_after: num(i.balance_after),
        })),
      };
    },
  });
}

export type WalletLedgerFilters = {
  from?: string | null;
  to?: string | null;
  adminId?: string | null;
  reason?: string | null;
};

export function useAdminWalletLedger(filters: WalletLedgerFilters, page = 0, pageSize = 100) {
  return useQuery({
    queryKey: ["admin", "wallet-ledger", filters, page, pageSize],
    queryFn: async () => {
      const { data, error } = await rpc("admin_wallet_ledger", {
        p_from: filters.from ?? null,
        p_to: filters.to ?? null,
        p_admin_id: filters.adminId ?? null,
        p_reason: filters.reason ?? null,
        p_limit: pageSize,
        p_offset: page * pageSize,
      });
      if (error) throw error;
      const raw = data as {
        total: unknown;
        credits: unknown;
        debits: unknown;
        admins: { id: string; name: string | null }[];
        items: AdminWalletLedgerItem[];
      };
      return {
        total: num(raw.total),
        credits: num(raw.credits),
        debits: num(raw.debits),
        admins: raw.admins ?? [],
        items: (raw.items ?? []).map((i) => ({ ...i, amount: num(i.amount) })),
      };
    },
  });
}

export function useAdminOpsToday() {
  return useQuery({
    queryKey: ["admin", "ops-today"],
    refetchInterval: 60_000,
    queryFn: async (): Promise<AdminOpsToday> => {
      const { data, error } = await rpc("admin_ops_today");
      if (error) throw error;
      const raw = (data ?? {}) as Record<string, unknown>;
      return {
        lessons_today: num(raw.lessons_today),
        requests_today: num(raw.requests_today),
        completed_today: num(raw.completed_today),
        cancelled_today: num(raw.cancelled_today),
        paid_today: num(raw.paid_today),
        commission_today: num(raw.commission_today),
      };
    },
  });
}

export type AdminProblemBookingKind = "stuck_pending" | "stuck_active" | "attendance_failed";
export const ADMIN_PROBLEM_BOOKING_KINDS: AdminProblemBookingKind[] = [
  "stuck_pending",
  "stuck_active",
  "attendance_failed",
];

/** The bookings a home problem card counts (admin_ops_problem_booking_ids). */
export function useAdminProblemBookingIds(kind: AdminProblemBookingKind | null) {
  return useQuery({
    queryKey: ["admin", "ops-problem-bookings", kind],
    enabled: !!kind,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await rpc("admin_ops_problem_booking_ids", { p_kind: kind });
      if (error) throw error;
      return (data ?? []) as string[];
    },
  });
}

export function useAdminOpsProblems() {
  return useQuery({
    queryKey: ["admin", "ops-problems"],
    refetchInterval: 60_000,
    queryFn: async (): Promise<AdminOpsProblems> => {
      const { data, error } = await rpc("admin_ops_problems");
      if (error) throw error;
      const raw = (data ?? {}) as Record<string, unknown>;
      return {
        paymob_flags: num(raw.paymob_flags),
        push_failures: num(raw.push_failures),
        app_errors: num(raw.app_errors),
        stuck_pending: num(raw.stuck_pending),
        stuck_active: num(raw.stuck_active),
        attendance_failed: num(raw.attendance_failed),
      };
    },
  });
}
