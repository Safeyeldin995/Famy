import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { formatEGP } from "@/lib/utils";
import {
  useProviderCashDebtBlocked,
  useProviderLedger,
  useProviderSettlementBalance,
  useProviderSettlementSettings,
  useRecordProviderTransfer,
  useWalletBookings,
} from "@/lib/db/provider-settlement-queries";
import {
  walletBookingRows,
  walletState,
  walletTransferRows,
  type WalletState,
} from "@/lib/settlement/walletView";
import { adminDate } from "@/components/admin/adminPresentation";
import { bookingCode } from "@/components/admin/operations";
import { AdminQueryError } from "@/components/admin/AdminQueryError";
import { useLang } from "@/components/famio/LanguageToggle";
import { InstapayLogo } from "@/components/famio/PaymentLogos";
import { useFamyInstapay } from "@/lib/db/payout-queries";

type Audience = "admin" | "pro";

const STATE_CLASS: Record<WalletState, string> = {
  providerOwes: "text-destructive",
  famyOwes: "text-success",
  even: "text-foreground",
};

function Signed({ value }: { value: number }) {
  // Sign and amount in separate spans so right-to-left text never flips them.
  return (
    <span
      className={`flex shrink-0 items-center gap-1 font-extrabold tabular-nums ${
        value < 0 ? "text-destructive" : "text-success"
      }`}
    >
      <span>{value < 0 ? "-" : "+"}</span>
      <span>{formatEGP(Math.abs(value))}</span>
    </span>
  );
}

/**
 * Uber-style provider wallet: one balance, the bookings that moved it and the money
 * transferred. The admin version can record a transfer; the provider version explains
 * how to settle.
 */
export function ProviderWalletPanel({
  providerId,
  audience,
}: {
  providerId: string | undefined;
  audience: Audience;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const ns = `wallet.${audience}`;
  const balance = useProviderSettlementBalance(providerId);
  const ledger = useProviderLedger(providerId, 200);
  const bookings = useWalletBookings(ledger.data);
  const settings = useProviderSettlementSettings();
  const record = useRecordProviderTransfer(providerId);
  const blockedQ = useProviderCashDebtBlocked(providerId);
  const famyInstapay = useFamyInstapay();
  // The form keeps the direction and cap from when it was opened, so a balance
  // refetch can't turn a "received" record into a payout.
  const [form, setForm] = useState<{ direction: "received" | "sent"; max: number } | null>(null);
  const open = form !== null;
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");

  if (!providerId) return null;

  const net = balance.data?.net ?? 0;
  const state = walletState(net);
  const limit = settings.data?.cash_debt_limit ?? 1000;
  const blocked = blockedQ.data === true;
  const bookingRows = walletBookingRows(ledger.data ?? [], bookings.data ?? new Map());
  const transfers = walletTransferRows(ledger.data ?? []);
  const owed = Math.abs(net);
  const amountValue = Number(amount);
  const amountValid = !!form && amountValue > 0 && amountValue <= form.max + 0.005;

  const startRecord = () => {
    setAmount(String(Math.round(owed * 100) / 100));
    setReference("");
    setForm({ direction: state === "providerOwes" ? "received" : "sent", max: owed });
  };

  const save = () => {
    if (!form || !amountValid || !reference.trim()) return;
    record.mutate(
      {
        direction: form.direction,
        amount: amountValue,
        reference: reference.trim(),
        reason: t("wallet.admin.reason"),
      },
      {
        onSuccess: () => {
          setForm(null);
          toast.success(t("wallet.admin.saved"));
        },
        onError: () => toast.error(t("wallet.admin.failed")),
      },
    );
  };

  return (
    <section
      id="provider-account"
      className="scroll-mt-24 space-y-5 rounded-2xl border border-border bg-surface p-4"
    >
      <h2 className="text-base font-extrabold">{t(`${ns}.title`)}</h2>

      {balance.isError || ledger.isError ? (
        <AdminQueryError
          message={t(`${ns}.loadError`)}
          onRetry={() => {
            void balance.refetch();
            void ledger.refetch();
          }}
        />
      ) : null}

      <div className="space-y-2 rounded-xl bg-surface-2/60 p-4">
        <p className="text-xs font-bold text-muted-foreground">{t(`${ns}.balanceLabel`)}</p>
        {balance.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <>
            <p className={`text-2xl font-extrabold tabular-nums ${STATE_CLASS[state]}`}>
              {state === "even" ? t(`${ns}.even`) : formatEGP(owed)}
            </p>
            {state !== "even" ? <p className="text-sm font-bold">{t(`${ns}.${state}`)}</p> : null}
            <p className="text-sm text-muted-foreground">{t(`${ns}.${state}Hint`)}</p>
            {blocked ? (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm font-bold text-destructive">
                {t(`${ns}.blocked`, { limit: formatEGP(limit) })}
              </p>
            ) : null}
            {audience === "pro" &&
            state === "providerOwes" &&
            (famyInstapay.data?.handle || famyInstapay.data?.payLink) ? (
              <div className="space-y-2 rounded-xl border border-border bg-background p-3">
                <div className="flex items-center gap-2">
                  <InstapayLogo className="h-3" />
                  <span className="text-sm font-bold">{t("payout.pro.payInTitle")}</span>
                </div>
                <p className="text-sm text-muted-foreground">{t("payout.pro.payInBody")}</p>
                {famyInstapay.data.handle ? (
                  <p className="text-sm font-bold">
                    <bdi dir="ltr">{famyInstapay.data.handle}</bdi>
                  </p>
                ) : null}
                {famyInstapay.data.payLink ? (
                  <a
                    href={famyInstapay.data.payLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="focus-ring inline-flex min-h-11 items-center rounded-xl bg-brand px-4 text-sm font-bold text-brand-foreground"
                  >
                    {t("payout.pro.payInOpen")}
                  </a>
                ) : null}
              </div>
            ) : null}
          </>
        )}

        {audience === "admin" && state !== "even" && !open ? (
          <button
            type="button"
            className="focus-ring min-h-11 rounded-xl bg-brand px-4 text-sm font-bold text-brand-foreground"
            onClick={startRecord}
          >
            {t(state === "providerOwes" ? "wallet.admin.actionReceive" : "wallet.admin.actionPay")}
          </button>
        ) : null}

        {audience === "admin" && open ? (
          <div className="space-y-3 rounded-xl border border-brand/30 bg-brand/5 p-3">
            <p className="text-sm font-extrabold">
              {t(
                form?.direction === "received"
                  ? "wallet.admin.actionReceive"
                  : "wallet.admin.actionPay",
              )}
            </p>
            <label className="block text-sm">
              <span className="font-semibold">{t("wallet.admin.amount")}</span>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1 block min-h-11 w-full rounded-xl border border-border bg-background px-3 text-sm tabular-nums"
              />
            </label>
            {amount && !amountValid ? (
              <p className="text-xs font-bold text-destructive">
                {t("wallet.admin.amountTooHigh")}
              </p>
            ) : null}
            <label className="block text-sm">
              <span className="font-semibold">{t("wallet.admin.reference")}</span>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder={t("wallet.admin.referencePlaceholder")}
                className="mt-1 block min-h-11 w-full rounded-xl border border-border bg-background px-3 text-sm"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={record.isPending || !amountValid || !reference.trim()}
                className="focus-ring min-h-11 rounded-xl bg-brand px-4 text-sm font-bold text-brand-foreground disabled:opacity-50"
                onClick={save}
              >
                {t("wallet.admin.save")}
              </button>
              <button
                type="button"
                disabled={record.isPending}
                className="focus-ring min-h-11 rounded-xl border border-border px-4 text-sm font-bold"
                onClick={() => setForm(null)}
              >
                {t("wallet.admin.cancel")}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <details className="rounded-xl border border-border px-3 py-2 text-sm">
        <summary className="cursor-pointer font-bold">{t(`${ns}.howTitle`)}</summary>
        <ul className="mt-2 list-disc space-y-1 ps-5 text-muted-foreground">
          <li>{t(`${ns}.how1`)}</li>
          <li>{t(`${ns}.how2`)}</li>
          <li>{t(`${ns}.how3`)}</li>
        </ul>
      </details>

      <div className="space-y-2">
        <h3 className="text-sm font-extrabold">{t(`${ns}.bookingsTitle`)}</h3>
        {ledger.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : ledger.isError ? null : bookingRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(`${ns}.bookingsEmpty`)}</p>
        ) : (
          <ul className="divide-y divide-border/50 rounded-xl border border-border text-sm">
            {bookingRows.map((r) => (
              <li key={r.bookingId} className="space-y-1 px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold">
                      {r.price != null
                        ? t(r.method === "cash" ? `${ns}.paidCash` : `${ns}.paidOnline`, {
                            amount: formatEGP(r.price),
                          })
                        : t(r.method === "cash" ? `${ns}.cashBooking` : `${ns}.onlineBooking`)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {adminDate(r.at, lang, false)} · {t("adminOps.booking")}{" "}
                      <bdi dir="ltr">{bookingCode(r.bookingId)}</bdi>
                    </p>
                  </div>
                  <Signed value={r.effect} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {r.commission != null
                    ? `${t(`${ns}.commission`)}: ${formatEGP(r.commission)}`
                    : null}
                  {r.commission != null && r.providerNet != null ? " · " : null}
                  {r.providerNet != null
                    ? `${t(`${ns}.providerNet`)}: ${formatEGP(r.providerNet)}`
                    : null}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-extrabold">{t(`${ns}.transfersTitle`)}</h3>
        {ledger.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : ledger.isError ? null : transfers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(`${ns}.transfersEmpty`)}</p>
        ) : (
          <ul className="divide-y divide-border/50 rounded-xl border border-border text-sm">
            {transfers.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 px-3 py-3">
                <div className="min-w-0">
                  <p className="font-bold">{t(`${ns}.transfer.${r.kind}`)}</p>
                  <p className="text-xs text-muted-foreground">
                    {adminDate(r.at, lang, false)}
                    {r.reference ? (
                      <>
                        {" · "}
                        <bdi dir="ltr">{r.reference}</bdi>
                      </>
                    ) : null}
                  </p>
                </div>
                <Signed value={r.effect} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
