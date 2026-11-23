import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";

export type WalletBalances = {
  ledger_balance: number;
  held_amount: number;
  available_amount: number;
};

export type WalletEntry = {
  id: string;
  direction: string;
  amount: number;
  reason: string;
  booking_id: string | null;
  created_at: string;
};

export type WalletRefundRequest = {
  id: string;
  amount: number;
  status: string;
  created_at: string;
  wallet_entry_id: string;
};

export function useWalletBalances() {
  return useQuery({
    queryKey: ["customer-wallet-balances"],
    queryFn: async (): Promise<WalletBalances> => {
      const { data, error } = await supabase.rpc("customer_wallet_balances");
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return {
        ledger_balance: Number((row as WalletBalances)?.ledger_balance ?? 0),
        held_amount: Number((row as WalletBalances)?.held_amount ?? 0),
        available_amount: Number((row as WalletBalances)?.available_amount ?? 0),
      };
    },
  });
}

export function useWalletEntries() {
  return useQuery({
    queryKey: ["customer-wallet-entries"],
    queryFn: async (): Promise<WalletEntry[]> => {
      const { data, error } = await supabase
        .from("customer_wallet_entries")
        .select("id, direction, amount, reason, booking_id, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as WalletEntry[];
    },
  });
}

export function useWalletRefundRequests() {
  return useQuery({
    queryKey: ["customer-wallet-refund-requests"],
    queryFn: async (): Promise<WalletRefundRequest[]> => {
      const { data, error } = await supabase
        .from("customer_wallet_refund_requests")
        .select("id, amount, status, created_at, wallet_entry_id")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as WalletRefundRequest[];
    },
  });
}

export function useRequestWalletRefund() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (walletEntryId: string) => {
      const { data, error } = await supabase.rpc("customer_request_wallet_refund", {
        p_wallet_entry_id: walletEntryId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["customer-wallet-balances"] });
      void qc.invalidateQueries({ queryKey: ["customer-wallet-entries"] });
      void qc.invalidateQueries({ queryKey: ["customer-wallet-refund-requests"] });
    },
  });
}