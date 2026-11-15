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
  const remove = useMutation({
    mutationFn: async (row: PayoutMethodRow) => {
      const { error } = await supabase.from("provider_payout_methods").delete().eq("id", row.id);
      if (error) throw error;
      // Keep one primary method when the primary one is removed.
      if (row.is_default) {
        const { data } = await supabase
          .from("provider_payout_methods")
          .select("id")
          .eq("provider_id", row.provider_id)
          .order("created_at", { ascending: true })
          .limit(1);
        const next = data?.[0]?.id;
        if (next)
          await supabase
            .from("provider_payout_methods")
            .update({ is_default: true })
            .eq("id", next);
      }
    },
    onSuccess: invalidate,
  });
  const makeDefault = useMutation({
    mutationFn: async (row: PayoutMethodRow) => {
      // Clear first: only one primary method per provider is allowed.
      const { error: clearErr } = await supabase
        .from("provider_payout_methods")
        .update({ is_default: false })
        .eq("provider_id", row.provider_id)
        .eq("is_default", true);
      if (clearErr) throw clearErr;
      const { error } = await supabase
        .from("provider_payout_methods")
        .update({ is_default: true })
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  return { add, remove, makeDefault };
}

/** Famy's own InstaPay details (address + payment link), editable by admin. */
export function useFamyInstapay() {
  return useQuery({
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
