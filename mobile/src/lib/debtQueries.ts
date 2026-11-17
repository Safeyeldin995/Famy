import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { uploadFeeReceipt } from "@/lib/mobilePayments";

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

/**
 * The signed-in customer's unpaid fees: those that will be added to their next booking
 * (fees already riding on a live booking, or inside a receipt being checked, are left out),
 * plus their latest standalone payment attempt.
 */
export function useMyFeeDebts(customerId: string | undefined) {
  return useQuery({
    enabled: !!customerId,
    queryKey: ["customer-fee-debts", customerId],
    queryFn: async () => {
      const [debts, settlements] = await Promise.all([
        supabase.rpc("my_unpaid_fees"),
        supabase
          .from("customer_debt_settlements")
          .select("id, amount, method, status, rejection_reason, created_at")
          .eq("customer_id", customerId!)
          .order("created_at", { ascending: false })
          .limit(1),
      ]);
      if (debts.error) throw debts.error;
      if (settlements.error) throw settlements.error;
      const open = ((debts.data ?? []) as Omit<CustomerDebt, "status">[]).map((d) => ({
        ...d,
        status: "open",
        amount: Number(d.amount),
      })) as CustomerDebt[];
      const latest = (settlements.data?.[0] ?? null) as DebtSettlement | null;
      return {
        open,
        total: open.reduce((s, d) => s + d.amount, 0),
        inReview: latest?.status === "pending_review" ? { amount: Number(latest.amount) } : null,
        lastRejected: latest?.status === "rejected" ? latest : null,
      };
    },
  });
}

export function useSubmitDebtInstapay(customerId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (asset: {
      uri: string;
      fileName?: string | null;
      mimeType?: string | null;
      fileSize?: number;
    }) => {
      if (!customerId) throw new Error("auth required");
      const path = await uploadFeeReceipt(customerId, asset);
      const { error } = await supabase.rpc("customer_submit_debt_instapay", {
        p_proof_path: path,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customer-fee-debts", customerId] }),
  });
}
