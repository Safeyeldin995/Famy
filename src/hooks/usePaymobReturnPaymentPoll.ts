import { useEffect } from "react";

const MAX_TRIES = 10;
const INTERVAL_MS = 3000;

export function usePaymobReturnPaymentPoll(
  paymobReturn: "1" | undefined,
  refetch: () => Promise<unknown>,
) {
  useEffect(() => {
    if (paymobReturn !== "1") return;
    let cancelled = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = async () => {
      if (cancelled || tries >= MAX_TRIES) return;
      tries += 1;
      await refetch();
      if (tries < MAX_TRIES && !cancelled) {
        timer = setTimeout(() => void run(), INTERVAL_MS);
      }
    };

    void run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [paymobReturn, refetch]);
}