import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  cancellationPolicyForMode,
  type CancellationPolicySettings,
} from "@/lib/customerWallet/cancellationPolicy";
import { currentLang } from "@/lib/i18n";
import {
  onlineWebCancelPolicySummaryAr,
  onlineWebCancelPolicySummaryEn,
  onlineCancellationPolicyForWeb,
} from "@/lib/online/smoothFlowUx";

export function useOnlineCancellationPolicySummary(): {
  summary: string;
  isLoading: boolean;
} {
  const q = useQuery({
    queryKey: ["settings", "cancellation_policy", "online-web"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "cancellation_policy")
        .maybeSingle();
      if (error) throw error;
      return (data?.value as CancellationPolicySettings | null) ?? null;
    },
    staleTime: 60_000,
  });

  const lang = currentLang();
  if (q.isLoading || q.data === undefined) {
    const fallback = onlineCancellationPolicyForWeb();
    return {
      summary:
        lang === "ar"
          ? onlineWebCancelPolicySummaryAr()
          : onlineWebCancelPolicySummaryEn(),
      isLoading: q.isLoading,
    };
  }

  const slice = cancellationPolicyForMode(q.data, "online");
  const summary =
    lang === "ar"
      ? formatOnlineCancelPolicyAr(slice)
      : formatOnlineCancelPolicyEn(slice);
  return { summary, isLoading: false };
}

function formatOnlineCancelPolicyAr(slice: {
  free_cancel_hours: number;
  fee_value: number;
  fee_mode: string;
}): string {
  if (slice.fee_mode === "percent" && slice.fee_value > 0) {
    return `لو لغيت قبل ${slice.free_cancel_hours} ساعات من الحصة، الإلغاء مجاني. بعد كده بتتخصم ${slice.fee_value}% من قيمة الحصة، والباقي يرجع لمحفظتك على فامي.`;
  }
  return `لو لغيت قبل ${slice.free_cancel_hours} ساعات من الحصة، الإلغاء مجاني.`;
}

function formatOnlineCancelPolicyEn(slice: {
  free_cancel_hours: number;
  fee_value: number;
  fee_mode: string;
}): string {
  if (slice.fee_mode === "percent" && slice.fee_value > 0) {
    return `Cancel more than ${slice.free_cancel_hours} hours before the lesson for free. After that, a ${slice.fee_value}% fee applies; the rest is credited to your Famy wallet.`;
  }
  return `Cancel more than ${slice.free_cancel_hours} hours before the lesson for free.`;
}