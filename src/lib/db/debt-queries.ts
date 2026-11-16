import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type CustomerDebt = {
  id: string;
  booking_id: string;
  kind: string;
  amount: number;
  status: string;
  created_at: string;
};

export type DebtSettlement = {
  id: string;
  amount: number;
  method: string;
  status: string;
  rejection_reason: string | null;
  created_at: string;
};

/** The signed-in customer's unpaid fees and their latest payment attempt. */
export function useMyFeeDebts(customerId: string | undefined) {
  return useQuery({
    enabled: !!customerId,
    queryKey: ["customer-fee-debts", customerId],
    queryFn: async () => {
      const [debts, settlements] = await Promise.all([
        supabase
          .from("customer_debts")
          .select("id, booking_id, kind, amount, status, created_at")
          .eq("customer_id", customerId!)
          .eq("status", "open")
          .order("created_at", { ascending: true }),
        supabase
          .from("customer_debt_settlements")
          .select("id, amount, method, status, rejection_reason, created_at")
          .eq("customer_id", customerId!)
          .order("created_at", { ascending: false })
          .limit(1),
      ]);
      if (debts.error) throw debts.error;
      if (settlements.error) throw settlements.error;
      const open = (debts.data ?? []).map((d) => ({
        ...d,
        amount: Number(d.amount),
      })) as CustomerDebt[];
      const latest = (settlements.data?.[0] ?? null) as DebtSettlement | null;
      return {
        open,
        total: open.reduce((s, d) => s + d.amount, 0),
        inReview: latest?.status === "pending_review",
        lastRejected: latest?.status === "rejected" ? latest : null,
      };
    },
  });
}

export function useSubmitDebtInstapay(customerId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (reference: string) => {
      const { error } = await supabase.rpc("customer_submit_debt_instapay", {
        p_reference: reference,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customer-fee-debts", customerId] }),
  });
}

export type AdminDebtSettlement = DebtSettlement & {
  customer_id: string;
  instapay_reference: string | null;
  customer_name: string | null;
};
export type AdminCustomerDebt = CustomerDebt & {
  customer_id: string;
  provider_id: string;
  customer_name: string | null;
};

async function namesFor(ids: string[]) {
  if (!ids.length) return new Map<string, string | null>();
  const { data, error } = await supabase.from("profiles").select("id, full_name").in("id", ids);
  if (error) throw error;
  return new Map((data ?? []).map((p) => [p.id as string, (p.full_name as string | null) ?? null]));
}

/** Admin: InstaPay fee payments waiting for review, and all open fee debts. */
export function useAdminFeeDebts() {
  return useQuery({
    queryKey: ["admin", "fee-debts"],
    queryFn: async () => {
      const [settlements, debts] = await Promise.all([
        supabase
          .from("customer_debt_settlements")
          .select(
            "id, customer_id, amount, method, status, instapay_reference, rejection_reason, created_at",
          )
          .eq("status", "pending_review")
          .order("created_at", { ascending: true }),
        supabase
          .from("customer_debts")
          .select("id, customer_id, provider_id, booking_id, kind, amount, status, created_at")
          .eq("status", "open")
          .order("created_at", { ascending: true }),
      ]);
      if (settlements.error) throw settlements.error;
      if (debts.error) throw debts.error;
      const names = await namesFor([
        ...new Set(
          [...(settlements.data ?? []), ...(debts.data ?? [])].map((r) => r.customer_id as string),
        ),
      ]);
      return {
        settlements: (settlements.data ?? []).map((s) => ({
          ...s,
          amount: Number(s.amount),
          customer_name: names.get(s.customer_id as string) ?? null,
        })) as AdminDebtSettlement[],
        debts: (debts.data ?? []).map((d) => ({
          ...d,
          amount: Number(d.amount),
          customer_name: names.get(d.customer_id as string) ?? null,
        })) as AdminCustomerDebt[],
      };
    },
  });
}

export function useAdminDebtActions() {
  const qc = useQueryClient();
  const done = () => {
    qc.invalidateQueries({ queryKey: ["admin", "fee-debts"] });
    qc.invalidateQueries({ queryKey: ["admin-finance-summary"] });
  };
  const review = useMutation({
    mutationFn: async (v: { id: string; approve: boolean; reason?: string }) => {
      const { error } = await supabase.rpc("admin_review_debt_settlement", {
        p_settlement_id: v.id,
        p_approve: v.approve,
        p_reason: v.reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: done,
  });
  const waive = useMutation({
    mutationFn: async (v: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("admin_waive_customer_debt", {
        p_debt_id: v.id,
        p_reason: v.reason,
      });
      if (error) throw error;
    },
    onSuccess: done,
  });
  return { review, waive };
}
