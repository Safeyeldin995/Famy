import { useQuery } from "@tanstack/react-query";
import { appConfig, supabase } from "./supabase";

export type PaymobWalletCapabilities = {
  applePay: boolean;
  googlePay: boolean;
};

async function fetchPaymobWalletCapabilities(): Promise<PaymobWalletCapabilities> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  const response = await fetch(
    `${appConfig.webOrigin.replace(/\/$/, "")}/api/mobile/paymob-capabilities`,
    { headers },
  );
  const body = (await response.json()) as PaymobWalletCapabilities & { ok?: boolean };
  if (!response.ok || body.ok === false) {
    return { applePay: false, googlePay: false };
  }
  return { applePay: !!body.applePay, googlePay: !!body.googlePay };
}

export function usePaymobWalletCapabilities() {
  return useQuery({
    queryKey: ["paymob-wallet-capabilities"],
    queryFn: fetchPaymobWalletCapabilities,
    staleTime: 60_000,
  });
}