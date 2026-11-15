import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  instapayConfig,
  sortPayoutMethods,
  type PayoutMethodInsert,
  type PayoutMethodRow,
} from "@shared/payout/payoutMethods";

const COLS =
  "id, provider_id, method, holder_name, bank_name, account_number, wallet_phone, instapay_address, is_default, created_at";

export function usePayoutMethods(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ["provider-payout-methods", providerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_payout_methods")
        .select(COLS)
        .eq("provider_id", providerId!);
      if (error) throw error;
      return sortPayoutMethods((data ?? []) as PayoutMethodRow[]);
    },
  });
}

export function usePayoutMethodMutations(providerId: string | undefined) {
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["provider-payout-methods", providerId] });
  const add = useMutation({
    mutationFn: async (row: PayoutMethodInsert) => {
      const { error } = await supabase.from("provider_payout_methods").insert(row);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  // The database keeps exactly one primary method (first added becomes primary;
  // removing the primary promotes the oldest remaining one).
  const remove = useMutation({
    mutationFn: async (row: PayoutMethodRow) => {
      const { error } = await supabase.from("provider_payout_methods").delete().eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  const makeDefault = useMutation({
    mutationFn: async (row: PayoutMethodRow) => {
      const { error } = await supabase.rpc("set_primary_payout_method", { p_method_id: row.id });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  return { add, remove, makeDefault };
}

/** Famy's own InstaPay details (address + payment link), editable by admin. */
export function useFamyInstapay(enabled = true) {
  return useQuery({
    enabled,
    queryKey: ["famy-instapay"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_methods")
        .select("public_config")
        .eq("code", "instapay")
        .eq("is_active", true)
        .maybeSingle();
      if (error) throw error;
      return instapayConfig(data?.public_config);
    },
  });
}
