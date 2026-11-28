/**
 * Launch offers data layer (20261128160000_launch_offers).
 * Settings rows are public-read / admin-write (settings_public_read,
 * settings_admin_write) and validated by trg_validate_launch_offer_settings.
 * Money moves only through SECURITY DEFINER RPCs.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Json } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import {
  parseFirstLessonGuarantee,
  parseGuaranteeStatus,
  parseLaunchCommission,
  parseMyLaunchCommission,
  type FirstLessonGuaranteeSettings,
  type FirstLessonGuaranteeStatus,
  type LaunchCommissionSettings,
  type MyLaunchCommission,
} from "@/lib/offers/launchOffers";

type UntypedRpc = (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;
const rpc: UntypedRpc = (fn, args) =>
  (supabase.rpc as unknown as UntypedRpc).call(supabase, fn, args);

async function readSetting(key: string): Promise<unknown> {
  const { data, error } = await supabase
    .from("settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;
  return data?.value ?? null;
}

async function writeSetting(key: string, value: unknown): Promise<void> {
  const { error } = await supabase
    .from("settings")
    .upsert({ key, value: value as Json }, { onConflict: "key" });
  if (error) throw error;
}

export function useFirstLessonGuaranteeSettings() {
  return useQuery({
    queryKey: ["settings", "first_lesson_guarantee"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<FirstLessonGuaranteeSettings> =>
      parseFirstLessonGuarantee(await readSetting("first_lesson_guarantee")),
  });
}

export function useLaunchCommissionSettings() {
  return useQuery({
    queryKey: ["settings", "launch_commission"],
    queryFn: async (): Promise<LaunchCommissionSettings> =>
      parseLaunchCommission(await readSetting("launch_commission")),
  });
}

export function useUpdateFirstLessonGuaranteeSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (value: FirstLessonGuaranteeSettings) =>
      writeSetting("first_lesson_guarantee", value),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["settings", "first_lesson_guarantee"] });
    },
  });
}

export function useUpdateLaunchCommissionSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (value: LaunchCommissionSettings) => writeSetting("launch_commission", value),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["settings", "launch_commission"] });
    },
  });
}

export function useFirstLessonGuaranteeStatus(
  bookingId: string | null | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: ["first-lesson-guarantee", bookingId],
    enabled: !!bookingId && enabled,
    queryFn: async (): Promise<FirstLessonGuaranteeStatus> => {
      const { data, error } = await rpc("first_lesson_guarantee_status", {
        p_booking_id: bookingId,
      });
      if (error) throw error;
      return parseGuaranteeStatus(data);
    },
  });
}

export function useClaimFirstLessonGuarantee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { bookingId: string; feedback: string | null }) => {
      const { data, error } = await rpc("claim_first_lesson_guarantee", {
        p_booking_id: input.bookingId,
        p_feedback: input.feedback,
      });
      if (error) throw error;
      const r = (data ?? {}) as { amount?: number | string };
      return { amount: Number(r.amount ?? 0) };
    },
    onSettled: (_d, _e, vars) => {
      void qc.invalidateQueries({ queryKey: ["first-lesson-guarantee", vars.bookingId] });
      void qc.invalidateQueries({ queryKey: ["customer-wallet-balance-web"] });
      void qc.invalidateQueries({ queryKey: ["customer-wallet-entries-web"] });
    },
  });
}

export function useMyLaunchCommission(enabled = true) {
  return useQuery({
    queryKey: ["my-launch-commission"],
    enabled,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<MyLaunchCommission> => {
      const { data, error } = await rpc("my_launch_commission");
      if (error) throw error;
      return parseMyLaunchCommission(data);
    },
  });
}

export type AdminGuaranteeClaim = {
  id: string;
  amount: number;
  feedback: string | null;
  status: "claimed" | "reversed";
  created_at: string;
  reversed_at: string | null;
  reverse_note: string | null;
};

export function useAdminFirstLessonGuarantee(bookingId: string | null | undefined) {
  return useQuery({
    queryKey: ["admin", "first-lesson-guarantee", bookingId],
    enabled: !!bookingId,
    queryFn: async (): Promise<AdminGuaranteeClaim | null> => {
      const { data, error } = await rpc("admin_first_lesson_guarantee_for_booking", {
        p_booking_id: bookingId,
      });
      if (error) throw error;
      if (!data) return null;
      const r = data as Record<string, unknown>;
      return {
        id: String(r.id),
        amount: Number(r.amount ?? 0),
        feedback: typeof r.feedback === "string" ? r.feedback : null,
        status: r.status === "reversed" ? "reversed" : "claimed",
        created_at: String(r.created_at ?? ""),
        reversed_at: typeof r.reversed_at === "string" ? r.reversed_at : null,
        reverse_note: typeof r.reverse_note === "string" ? r.reverse_note : null,
      };
    },
  });
}

export function useAdminReverseFirstLessonGuarantee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      claimId: string;
      bookingId: string;
      customerId: string;
      note: string;
      idempotencyKey: string;
    }) => {
      const { error } = await rpc("admin_reverse_first_lesson_guarantee", {
        p_claim_id: input.claimId,
        p_note: input.note,
        p_idempotency_key: input.idempotencyKey,
      });
      if (error) throw error;
    },
    onSettled: (_d, _e, vars) => {
      void qc.invalidateQueries({ queryKey: ["admin", "first-lesson-guarantee", vars.bookingId] });
      void qc.invalidateQueries({ queryKey: ["admin", "booking-money", vars.bookingId] });
      void qc.invalidateQueries({ queryKey: ["admin", "wallet-history", vars.customerId] });
      void qc.invalidateQueries({ queryKey: ["admin", "wallet-ledger"] });
      void qc.invalidateQueries({ queryKey: ["admin", "customer", vars.customerId] });
    },
  });
}
