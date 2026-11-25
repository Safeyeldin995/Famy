import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { requireOnlineWebSession } from "@/lib/web/onlineWebSession";
import { ONLINE_WEB_ROUTE_IDS, ONLINE_WEB_WALLET_TERMS_AR } from "@/lib/web/onlineWebSurface";
import { useMyProvider } from "@/lib/db/provider-queries";
import { siteHeadPrivate, siteLanguage } from "@/lib/site/seo";
import { currentLang } from "@/lib/i18n";
import { formatEGP } from "@/lib/format";

export const Route = createFileRoute("/online/wallet")({
  beforeLoad: async ({ location }) => {
    await requireOnlineWebSession(location.href);
  },
  head: ({ matches }) =>
    siteHeadPrivate(
      "/online/wallet",
      {
        ar: { title: "محفظة فامي | دروس أونلاين", description: "رصيد محفظتك لدروس أونلاين على فامي." },
        en: { title: "Famy wallet | Online lessons", description: "Your Famy wallet balance for online lessons." },
      },
      siteLanguage(matches),
    ),
  component: OnlineWallet,
});

function OnlineWallet() {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const providerQ = useMyProvider();
  const terms =
    currentLang() === "ar" ? ONLINE_WEB_WALLET_TERMS_AR : t("onlineWeb.walletTerms");

  useEffect(() => {
    if (providerQ.data?.id) {
      void nav({ to: ONLINE_WEB_ROUTE_IDS.providerLessons, replace: true });
    }
  }, [nav, providerQ.data?.id]);

  const balanceQ = useQuery({
    queryKey: ["customer-wallet-balance-web"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as (name: string, args?: object) => ReturnType<typeof supabase.rpc>)(
        "customer_wallet_balances",
      );
      if (error) throw error;
      const row = (data as { available_amount?: number }[] | null)?.[0];
      return Number(row?.available_amount ?? 0);
    },
  });

  const entriesQ = useQuery({
    queryKey: ["customer-wallet-entries-web"],
    queryFn: async () => {
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();
      if (userErr || !user?.id) return [];
      const { data, error } = await supabase
        .from("customer_wallet_entries" as never)
        .select("id, direction, amount, reason, created_at")
        .eq("customer_id", user.id)
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) throw error;
      return (data ?? []) as {
        id: string;
        direction: string;
        amount: number;
        reason: string;
        created_at: string;
      }[];
    },
  });

  return (
    <div className="space-y-6">
      <WalletBalanceHeader amount={balanceQ.data ?? 0} loading={balanceQ.isLoading} />
      <p className="text-pro-13 leading-relaxed text-muted-foreground">{terms}</p>
      <ul className="divide-y divide-border/60 rounded-2xl border border-border/60 bg-white">
        {(entriesQ.data ?? []).map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-3 text-pro-14">
            <span className="text-muted-foreground">{t(`onlineWeb.wallet.reason.${e.reason}`, e.reason)}</span>
            <span className="font-bold tabular-nums">
              {e.direction === "credit" ? "+" : "-"}
              {formatEGP(Number(e.amount), undefined, i18n.language)}
            </span>
          </li>
        ))}
        {entriesQ.data?.length === 0 && !entriesQ.isLoading ? (
          <li className="px-4 py-8 text-center text-pro-14 text-muted-foreground">
            {t("onlineWeb.wallet.noEntries")}
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function WalletBalanceHeader({ amount, loading }: { amount: number; loading: boolean }) {
  const { t, i18n } = useTranslation();
  return (
    <div className="rounded-3xl bg-white p-8 shadow-sm">
      <p className="text-pro-14 font-bold text-muted-foreground">{t("onlineWeb.wallet.balanceLabel")}</p>
      <p className="mt-2 text-pro-32 font-extrabold tabular-nums">
        {loading ? "…" : formatEGP(amount, undefined, i18n.language)}
      </p>
    </div>
  );
}