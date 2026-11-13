import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SettlementClosedPeriod } from "@/lib/settlement/cairoSettlementWeek";

export type AdminFinanceSummary = {
  totals_by_method: Record<string, number>;
  platform_share: number;
  owed_to_providers: number;
  owed_by_providers: number;
  pending_settlement_count: number;
  pending_settlement_amount: number;
  period_from: string;
  period_to: string;
};

export type AdminFinanceProviderRow = {
  provider_id: string;
  full_name: string | null;
  net: number;
  cash_held: number;
  at_limit: boolean;
  last_settlement_at: string | null;
  last_settlement_status: string | null;
};

export function useSettlementClosedPeriod() {
  return useQuery({
    queryKey: ["provider-settlement-closed-period"],
    queryFn: async (): Promise<SettlementClosedPeriod> => {
      const { data, error } = await supabase.rpc("provider_settlement_closed_period");
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as SettlementClosedPeriod | undefined;
      if (!row?.period_start) throw new Error("Missing settlement period");
      return row;
    },
  });
}

export function useAdminFinanceSummary(from: string | undefined, to: string | undefined) {
  return useQuery({
    enabled: !!from && !!to,
    queryKey: ["admin-finance-summary", from, to],
    queryFn: async (): Promise<AdminFinanceSummary> => {
      const { data, error } = await supabase.rpc("admin_finance_summary", {
        p_from: from!,
        p_to: to!,
      });
      if (error) throw error;
      const raw = data as Record<string, unknown>;
      const methods = (raw.totals_by_method ?? {}) as Record<string, unknown>;
      const totals: Record<string, number> = {};
      for (const [k, v] of Object.entries(methods)) {
        totals[k] = Number(v ?? 0);
      }
      return {
        totals_by_method: totals,
        platform_share: Number(raw.platform_share ?? 0),
        owed_to_providers: Number(raw.owed_to_providers ?? 0),
        owed_by_providers: Number(raw.owed_by_providers ?? 0),
        pending_settlement_count: Number(raw.pending_settlement_count ?? 0),
        pending_settlement_amount: Number(raw.pending_settlement_amount ?? 0),
        period_from: String(raw.period_from),
        period_to: String(raw.period_to),
      };
    },
  });
}

export function useAdminFinanceProviders() {
  return useQuery({
    queryKey: ["admin-finance-providers"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_finance_provider_rows");
      if (error) throw error;
      const rows = (data ?? []) as Record<string, unknown>[];
      return rows.map((row) => ({
        provider_id: String(row.provider_id),
        full_name: row.full_name != null ? String(row.full_name) : null,
        net: Number(row.net ?? 0),
        cash_held: Number(row.cash_held ?? 0),
        at_limit: Boolean(row.at_limit),
        last_settlement_at: row.last_settlement_at != null ? String(row.last_settlement_at) : null,
        last_settlement_status: row.last_settlement_status != null ? String(row.last_settlement_status) : null,
      })) satisfies AdminFinanceProviderRow[];
    },
  });
}
