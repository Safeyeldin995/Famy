type T = (key: string, params?: Record<string, unknown>) => string;

/**
 * What the customer reads before cancelling: whether it is a request (the tutor
 * hasn't accepted yet, always free) or a booked lesson, and the fee with its reason.
 */
export function cancelDialogCopy(input: {
  pending: boolean;
  fee: number | null;
  policySummary: string;
  formatAmount: (n: number) => string;
  t: T;
}): { title: string; body: string } {
  const { pending, fee, policySummary, formatAmount, t } = input;
  if (pending) {
    return {
      title: t("onlineWeb.cancel.requestTitle"),
      body: t("onlineWeb.cancel.requestFree"),
    };
  }
  if (fee != null && fee > 0) {
    return {
      title: t("onlineWeb.cancel.lessonTitle"),
      body: `${t("onlineWeb.cancel.lessonFee", { amount: formatAmount(fee) })} ${policySummary}`.trim(),
    };
  }
  return {
    title: t("onlineWeb.cancel.lessonTitle"),
    body: `${t("onlineWeb.cancel.lessonFree")} ${policySummary}`.trim(),
  };
}

/** Confirmation shown after a successful cancel. */
export function cancelSuccessCopy(input: {
  pending: boolean;
  fee: number | null;
  formatAmount: (n: number) => string;
  t: T;
}): string {
  const { pending, fee, formatAmount, t } = input;
  if (pending) return t("onlineWeb.cancel.requestDone");
  if (fee != null && fee > 0) return t("onlineWeb.cancel.lessonDoneFee", { amount: formatAmount(fee) });
  return t("onlineWeb.cancel.lessonDoneFree");
}
