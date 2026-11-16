import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

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
