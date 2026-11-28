import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  parseFirstLessonGuarantee,
  parseGuaranteeStatus,
  parseMyLaunchCommission,
  type FirstLessonGuaranteeSettings,
  type FirstLessonGuaranteeStatus,
  type MyLaunchCommission,
} from "@shared/offers/launchOffers";

/** Public setting: is the first-lesson guarantee on, and for which sections? */
export function useFirstLessonGuaranteeSettings() {
  return useQuery({
    queryKey: ["settings", "first_lesson_guarantee"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<FirstLessonGuaranteeSettings> => {
      const { data, error } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "first_lesson_guarantee")
        .maybeSingle();
      if (error) throw error;
      return parseFirstLessonGuarantee(data?.value ?? null);
    },
  });
}

export function useFirstLessonGuaranteeStatus(bookingId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["first-lesson-guarantee", bookingId],
    enabled: !!bookingId && enabled,
    queryFn: async (): Promise<FirstLessonGuaranteeStatus> => {
      const { data, error } = await supabase.rpc(
        "first_lesson_guarantee_status" as never,
        { p_booking_id: bookingId } as never,
      );
      if (error) throw error;
      return parseGuaranteeStatus(data);
    },
  });
}

export function useClaimFirstLessonGuarantee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { bookingId: string; feedback: string | null }) => {
      const { data, error } = await supabase.rpc(
        "claim_first_lesson_guarantee" as never,
        { p_booking_id: input.bookingId, p_feedback: input.feedback } as never,
      );
      if (error) throw error;
      const r = (data ?? {}) as { amount?: number | string };
      return { amount: Number(r.amount ?? 0) };
    },
    onSettled: (_d, _e, vars) => {
      void qc.invalidateQueries({ queryKey: ["first-lesson-guarantee", vars.bookingId] });
      void qc.invalidateQueries({ queryKey: ["customer-wallet-balances"] });
      void qc.invalidateQueries({ queryKey: ["customer-wallet-entries"] });
    },
  });
}

/** Provider: «عمولتك أقل لحد ...» while the new-tutor commission applies. */
export function useMyLaunchCommission(enabled = true) {
  return useQuery({
    queryKey: ["my-launch-commission"],
    enabled,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<MyLaunchCommission> => {
      const { data, error } = await supabase.rpc("my_launch_commission" as never);
      if (error) throw error;
      return parseMyLaunchCommission(data);
    },
  });
}
