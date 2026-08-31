export type PaymobReturnPollingOptions = {
  enabled: boolean;
  getPaymentStatus: () => string | undefined;
  isOnline: boolean;
  refetch: () => void | Promise<unknown>;
  intervalMs?: number;
  maxAttempts?: number;
  setIntervalFn?: (fn: () => void, ms: number) => number;
  clearIntervalFn?: (id: number) => void;
};

export function runPaymobReturnPolling(options: PaymobReturnPollingOptions): () => void {
  if (!options.enabled || !options.isOnline) return () => {};

  const status = options.getPaymentStatus();
  if (status === "captured" || status === "rejected") return () => {};

  const intervalMs = options.intervalMs ?? 2000;
  const maxAttempts = options.maxAttempts ?? 15;
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;

  let attempts = 0;
  const timer = setIntervalFn(() => {
    attempts += 1;
    void options.refetch();

    const latestStatus = options.getPaymentStatus();
    if (latestStatus === "captured" || latestStatus === "rejected" || attempts >= maxAttempts) {
      clearIntervalFn(timer);
    }
  }, intervalMs);

  return () => clearIntervalFn(timer);
}
