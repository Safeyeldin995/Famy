import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ProviderBalance = {
  total_credits: number;
  total_debits: number;
  net: number;
  cash_held_for_platform: number;
};

export type ProviderSettlementRow = {
  id: string;
  provider_id: string;
  period_start: string;
  period_end: string;
  amount: number;
  direction: "famy_pays_provider" | "provider_pays_famy";
  status: string;
  totals_by_method: Record<string, number>;
  payment_reference: string | null;
  note: string | null;
  created_at: string;
  settled_at: string | null;
};

export type ProviderLedgerRow = {
  id: string;
  kind: string;
  direction: "credit" | "debit";
  amount: number;
  payment_method: string | null;
  note: string | null;
  booking_id: string | null;
  created_at: string;
};

export function useProviderSettlementBalance(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ["provider-settlement-balance", providerId],
    queryFn: async (): Promise<ProviderBalance> => {
      const { data, error } = await supabase.rpc("provider_balance", {
        p_provider_id: providerId!,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as ProviderBalance | undefined;
      return {
        total_credits: Number(row?.total_credits ?? 0),
        total_debits: Number(row?.total_debits ?? 0),
        net: Number(row?.net ?? 0),
        cash_held_for_platform: Number(row?.cash_held_for_platform ?? 0),
      };
    },
  });
}

export function useProviderCashDebtBlocked(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ["provider-cash-debt-blocked", providerId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("provider_cash_debt_blocked", {
        p_provider_id: providerId!,
      });
      if (error) throw error;
      return Boolean(data);
    },
  });
}

export function useProviderSettlements(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ["provider-settlements", providerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_settlements")
        .select("*")
        .eq("provider_id", providerId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ProviderSettlementRow[];
    },
  });
}

export function useProviderLedger(providerId: string | undefined, limit = 50) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ["provider-ledger", providerId, limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_ledger_entries")
        .select("id, kind, direction, amount, payment_method, note, booking_id, created_at")
        .eq("provider_id", providerId!)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as ProviderLedgerRow[];
    },
  });
}

export function useProviderSettlementPeriod() {
  return useQuery({
    queryKey: ["provider-settlement-closed-period"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("provider_settlement_closed_period");
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as {
        period_start: string;
        period_end: string;
        next_settlement_at: string;
      };
      return row;
    },
  });
}

export function useProviderWeekLedgerTotals(providerId: string | undefined, periodStart: string | undefined) {
  return useQuery({
    enabled: !!providerId && !!periodStart,
    queryKey: ["provider-week-ledger", providerId, periodStart],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_ledger_entries")
        .select("kind, amount")
        .eq("provider_id", providerId!)
        .gte("created_at", periodStart!);
      if (error) throw error;
      let cash = 0;
      let online = 0;
      for (const row of data ?? []) {
        const amount = Number(row.amount ?? 0);
        if (row.kind === "cash_collected_platform_share") cash += amount;
        if (row.kind === "online_provider_share") online += amount;
      }
      return { cash, online };
    },
  });
}

export function useProviderSettlementSettings() {
  return useQuery({
    queryKey: ["settings", "provider_settlement"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "provider_settlement")
        .maybeSingle();
      if (error) throw error;
      const value = (data?.value ?? {}) as Record<string, unknown>;
      return {
        cash_debt_limit: Number(value.cash_debt_limit ?? 1000),
        cash_debt_warn_percent: Number(value.cash_debt_warn_percent ?? 80),
        settlement_weekday: Number(value.settlement_weekday ?? 0),
      };
    },
  });
}

export function settlementBalanceHeadline(
  net: number,
  t: (key: string, opts?: Record<string, string>) => string,
  formatAmount: (n: number) => string,
) {
  if (net > 0) return t("pro.settlement.famyOwesYou", { amount: formatAmount(net) });
  if (net < 0) return t("pro.settlement.youOweFamy", { amount: formatAmount(Math.abs(net)) });
  return t("pro.settlement.balanced");
}
