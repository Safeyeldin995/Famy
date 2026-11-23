/** Client-side mirror of per-mode cancellation policy (admin settings JSON). */

export type CancellationPolicySlice = {
  fee_mode: "fixed" | "percent";
  fee_value: number;
  free_cancel_hours: number;
};

export type CancellationPolicySettings = {
  in_person?: CancellationPolicySlice;
  online?: CancellationPolicySlice;
  fee_mode?: "fixed" | "percent";
  fee_value?: number;
  free_cancel_hours?: number;
};

export function cancellationPolicyForMode(
  settings: CancellationPolicySettings | null | undefined,
  serviceMode: "in_person" | "online",
): CancellationPolicySlice {
  const fallback: CancellationPolicySlice =
    serviceMode === "online"
      ? { fee_mode: "percent", fee_value: 50, free_cancel_hours: 4 }
      : { fee_mode: "fixed", fee_value: 0, free_cancel_hours: 2 };

  if (!settings) return fallback;

  const slice = serviceMode === "online" ? settings.online : settings.in_person;
  if (slice) {
    return {
      fee_mode: slice.fee_mode === "percent" ? "percent" : "fixed",
      fee_value: Math.max(Number(slice.fee_value) || 0, 0),
      free_cancel_hours: Math.max(Number(slice.free_cancel_hours) || 0, 0),
    };
  }

  if (settings.fee_mode != null) {
    return {
      fee_mode: settings.fee_mode === "percent" ? "percent" : "fixed",
      fee_value: Math.max(Number(settings.fee_value) || 0, 0),
      free_cancel_hours: Math.max(Number(settings.free_cancel_hours) || 0, 0),
    };
  }

  return fallback;
}

export function cancellationFeeForTotal(
  total: number,
  policy: CancellationPolicySlice,
): number {
  const safeTotal = Math.max(total, 0);
  const raw =
    policy.fee_mode === "percent"
      ? Math.round((safeTotal * Math.min(policy.fee_value, 100)) / 100)
      : policy.fee_value;
  return Math.min(Math.max(raw, 0), safeTotal);
}

export function walletRefundOnCustomerCancel(total: number, fee: number): number {
  return Math.max(total - Math.min(fee, total), 0);
}