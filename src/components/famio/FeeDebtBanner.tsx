import { useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import { useMyFeeDebts, useSubmitDebtInstapay } from "@/lib/db/debt-queries";
import { useFamyInstapay } from "@/lib/db/payout-queries";
import { formatEGP } from "@/lib/utils";
import { CardBrands, InstapayLogo } from "@/components/famio/PaymentLogos";

const btn = "focus-ring min-h-11 rounded-xl px-4 text-sm font-bold disabled:opacity-50";

/**
 * Website version of the app's fee banner: unpaid cancellation fees block booking until
 * paid by card (Paymob) or InstaPay (confirmed by Famy). Renders nothing when clear.
 */
export function FeeDebtBanner() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const debts = useMyFeeDebts(user?.id);
  const submit = useSubmitDebtInstapay(user?.id);
  const famyInstapay = useFamyInstapay();
  const [mode, setMode] = useState<"choose" | "instapay">("choose");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const d = debts.data;
  if (!d || d.total <= 0) return null;

  const payCard = async () => {
    setBusy(true);
    setError("");
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("auth");
      const res = await fetch("/api/mobile/debt-checkout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await res.json();
      if (!res.ok || !body.ok || typeof body.checkoutUrl !== "string") throw new Error("checkout");
      window.location.assign(body.checkoutUrl);
    } catch {
      setError(t("feeDebt.cardFailed"));
      setBusy(false);
    }
  };

  return (
    <section
      className="space-y-2 rounded-2xl border border-destructive/40 bg-surface p-4"
      role="alert"
    >
      <p className="text-base font-extrabold">
        {t("feeDebt.title", { amount: formatEGP(d.total) })}
      </p>
      <p className="text-sm text-muted-foreground">{t("feeDebt.body")}</p>
      {d.inReview ? (
        <p className="text-sm font-bold">{t("feeDebt.inReview")}</p>
      ) : mode === "choose" ? (
        <>
          {d.lastRejected ? (
            <p className="text-sm text-destructive">
              {t("feeDebt.rejected", { reason: d.lastRejected.rejection_reason ?? "" })}
            </p>
          ) : null}
          <CardBrands />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              className={`${btn} bg-brand text-brand-foreground`}
              onClick={payCard}
            >
              {t("feeDebt.payCard")}
            </button>
            <button
              type="button"
              className={`${btn} border border-border`}
              onClick={() => setMode("instapay")}
            >
              {t("feeDebt.payInstapay")}
            </button>
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <InstapayLogo className="h-3" />
          <p className="text-sm">{t("feeDebt.instapaySteps", { amount: formatEGP(d.total) })}</p>
          {famyInstapay.data?.handle ? (
            <p className="text-sm font-bold">
              <bdi dir="ltr">{famyInstapay.data.handle}</bdi>
            </p>
          ) : null}
          {famyInstapay.data?.payLink ? (
            <a
              href={famyInstapay.data.payLink}
              target="_blank"
              rel="noopener noreferrer"
              className={`${btn} inline-flex items-center border border-border`}
            >
              {t("payout.pro.payInOpen")}
            </a>
          ) : null}
          <label className="block text-sm">
            <span className="font-semibold">{t("feeDebt.reference")}</span>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              dir="ltr"
              className="mt-1 block min-h-11 w-full rounded-xl border border-border bg-background px-3 text-sm"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={submit.isPending || reference.trim().length < 4}
              className={`${btn} bg-brand text-brand-foreground`}
              onClick={() =>
                submit.mutate(reference.trim(), {
                  onSuccess: () => {
                    setMode("choose");
                    setReference("");
                  },
                  onError: () => setError(t("common.somethingWentWrong")),
                })
              }
            >
              {t("feeDebt.sendReference")}
            </button>
            <button
              type="button"
              className={`${btn} border border-border`}
              onClick={() => setMode("choose")}
            >
              {t("payout.pro.cancel")}
            </button>
          </div>
        </div>
      )}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </section>
  );
}
