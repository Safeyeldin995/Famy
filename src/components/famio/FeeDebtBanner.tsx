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
 * Website version of the app's fee banner. Unpaid cancellation fees are added to the
 * customer's next booking; they can also pay them now by card (Paymob) or InstaPay
 * (receipt checked by Famy). Renders nothing when clear.
 */
export function FeeDebtBanner() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const debts = useMyFeeDebts(user?.id);
  const submit = useSubmitDebtInstapay(user?.id);
  const famyInstapay = useFamyInstapay();
  const [mode, setMode] = useState<"choose" | "instapay">("choose");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const d = debts.data;
  if (!d || (d.total <= 0 && !d.inReview)) return null;

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

  const onReceipt = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    submit.mutate(file, {
      onSuccess: () => setMode("choose"),
      onError: (err) =>
        setError(
          t(
            err instanceof Error && err.message === "fileTooLarge"
              ? "payment.fileTooLarge"
              : "payment.uploadFailed",
          ),
        ),
    });
  };

  if (d.total <= 0 && d.inReview) {
    return (
      <section className="rounded-2xl border border-border bg-surface p-4" role="status">
        <p className="text-sm font-bold">
          {t("feeDebt.inReview", { amount: formatEGP(d.inReview.amount) })}
        </p>
      </section>
    );
  }

  return (
    <section
      className="space-y-2 rounded-2xl border border-amber-500/50 bg-surface p-4"
      role="status"
    >
      <p className="text-base font-extrabold">
        {t("feeDebt.title", { amount: formatEGP(d.total) })}
      </p>
      <p className="text-sm text-muted-foreground">{t("feeDebt.body")}</p>
      {mode === "choose" ? (
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
          <div className="flex flex-wrap gap-2">
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
            <label
              className={`${btn} inline-flex cursor-pointer items-center bg-brand text-brand-foreground ${
                submit.isPending ? "pointer-events-none opacity-50" : ""
              }`}
            >
              {submit.isPending ? t("payment.uploading") : t("feeDebt.uploadReceipt")}
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={onReceipt}
                disabled={submit.isPending}
                className="hidden"
              />
            </label>
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
