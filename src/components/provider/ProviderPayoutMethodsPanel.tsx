import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import {
  PAYOUT_METHODS,
  buildPayoutInsert,
  emptyPayoutDraft,
  payoutDestination,
  type PayoutFieldError,
  type PayoutMethodDraft,
} from "@/lib/payout/payoutMethods";
import { usePayoutMethodMutations, usePayoutMethods } from "@/lib/db/payout-queries";
import { PayoutMethodLogo } from "@/components/famio/PaymentLogos";
import { AdminQueryError } from "@/components/admin/AdminQueryError";

type Audience = "admin" | "pro";

function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="focus-ring inline-flex min-h-9 items-center gap-1 rounded-lg border border-border px-2 text-xs font-bold"
      aria-label={`${label}: ${value}`}
      onClick={() => {
        navigator.clipboard
          .writeText(value)
          .then(() => toast.success(t("payout.admin.copied")))
          .catch(() => toast.error(t("common.somethingWentWrong")));
      }}
    >
      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </button>
  );
}

const inputCls =
  "mt-1 block min-h-11 w-full rounded-xl border border-border bg-background px-3 text-sm";

/**
 * Where Famy sends a provider's money. Providers add and manage their methods;
 * admin sees them with copy buttons when sending a payout.
 */
export function ProviderPayoutMethodsPanel({
  providerId,
  audience,
}: {
  providerId: string | undefined;
  audience: Audience;
}) {
  const { t } = useTranslation();
  const list = usePayoutMethods(providerId);
  const { add, remove, makeDefault } = usePayoutMethodMutations(providerId);
  const [draft, setDraft] = useState<PayoutMethodDraft | null>(null);
  const [errors, setErrors] = useState<PayoutFieldError[]>([]);
  if (!providerId) return null;

  const ns = audience === "admin" ? "payout.admin" : "payout.pro";
  const rows = list.data ?? [];
  const busy = add.isPending || remove.isPending || makeDefault.isPending;
  const set = (patch: Partial<PayoutMethodDraft>) => draft && setDraft({ ...draft, ...patch });
  const err = (f: PayoutFieldError) =>
    errors.includes(f) ? (
      <span className="mt-1 block text-xs font-bold text-destructive">
        {t(`payout.pro.errors.${f}`)}
      </span>
    ) : null;

  const save = () => {
    if (!draft) return;
    const built = buildPayoutInsert(providerId, draft, rows.length === 0);
    if (!built.ok) return setErrors(built.errors);
    setErrors([]);
    add.mutate(built.row, {
      onSuccess: () => {
        setDraft(null);
        toast.success(t("payout.pro.saved"));
      },
      onError: () => toast.error(t("payout.pro.failed")),
    });
  };

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-surface p-4">
      <div>
        <h2 className="text-base font-extrabold">{t(`${ns}.title`)}</h2>
        {audience === "pro" ? (
          <p className="text-sm text-muted-foreground">{t("payout.pro.subtitle")}</p>
        ) : null}
      </div>

      {list.isError ? (
        <AdminQueryError message={t(`${ns}.loadError`)} onRetry={() => void list.refetch()} />
      ) : list.isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : rows.length === 0 && !draft ? (
        <p className="text-sm text-muted-foreground">{t(`${ns}.empty`)}</p>
      ) : null}

      {rows.length > 0 ? (
        <ul className="divide-y divide-border/50 rounded-xl border border-border text-sm">
          {rows.map((r) => {
            const dest = payoutDestination(r);
            return (
              <li key={r.id} className="space-y-2 px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <PayoutMethodLogo method={r.method} />
                  <span className="font-bold">{t(`payout.methods.${r.method}`)}</span>
                  {r.is_default ? (
                    <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-bold text-brand">
                      {t(`${ns}.default`)}
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{r.holder_name}</p>
                    {r.bank_name ? <p className="text-muted-foreground">{r.bank_name}</p> : null}
                    <p className="font-bold tabular-nums">
                      <bdi dir="ltr">{dest}</bdi>
                    </p>
                  </div>
                  {audience === "admin" ? (
                    <div className="flex flex-wrap gap-2">
                      <CopyButton value={dest} label={t("payout.admin.copy")} />
                      <CopyButton value={r.holder_name} label={t("payout.admin.holder")} />
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-3">
                      {!r.is_default ? (
                        <button
                          type="button"
                          disabled={busy}
                          className="focus-ring min-h-9 text-xs font-bold text-brand disabled:opacity-50"
                          onClick={() => makeDefault.mutate(r)}
                        >
                          {t("payout.pro.makeDefault")}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={busy}
                        className="focus-ring min-h-9 text-xs font-bold text-destructive disabled:opacity-50"
                        onClick={() =>
                          remove.mutate(r, {
                            onSuccess: () => toast.success(t("payout.pro.removed")),
                            onError: () => toast.error(t("payout.pro.failed")),
                          })
                        }
                      >
                        {t("payout.pro.remove")}
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {audience === "pro" && draft ? (
        <div className="space-y-3 rounded-xl border border-brand/30 bg-brand/5 p-3">
          <fieldset>
            <legend className="text-sm font-semibold">{t("payout.pro.method")}</legend>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {PAYOUT_METHODS.map((m) => (
                <label
                  key={m}
                  className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm font-bold ${
                    draft.method === m
                      ? "border-brand bg-brand/10 text-brand"
                      : "border-border bg-background"
                  }`}
                >
                  <input
                    type="radio"
                    name="payout-method"
                    className="sr-only"
                    checked={draft.method === m}
                    onChange={() => {
                      setErrors([]);
                      set({ method: m });
                    }}
                  />
                  <PayoutMethodLogo method={m} />
                  {t(`payout.methods.${m}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block text-sm">
            <span className="font-semibold">{t("payout.pro.holderName")}</span>
            <input
              value={draft.holderName}
              onChange={(e) => set({ holderName: e.target.value })}
              placeholder={t("payout.pro.holderPlaceholder")}
              autoComplete="name"
              className={inputCls}
            />
            {err("holderName")}
          </label>
          {draft.method === "bank" ? (
            <>
              <label className="block text-sm">
                <span className="font-semibold">{t("payout.pro.bankName")}</span>
                <input
                  value={draft.bankName}
                  onChange={(e) => set({ bankName: e.target.value })}
                  placeholder={t("payout.pro.bankPlaceholder")}
                  className={inputCls}
                />
                {err("bankName")}
              </label>
              <label className="block text-sm">
                <span className="font-semibold">{t("payout.pro.accountNumber")}</span>
                <input
                  value={draft.accountNumber}
                  onChange={(e) => set({ accountNumber: e.target.value })}
                  dir="ltr"
                  className={inputCls}
                />
                {err("accountNumber")}
              </label>
            </>
          ) : draft.method === "instapay" ? (
            <label className="block text-sm">
              <span className="font-semibold">{t("payout.pro.instapayAddress")}</span>
              <input
                value={draft.instapayAddress}
                onChange={(e) => set({ instapayAddress: e.target.value })}
                placeholder="name@instapay"
                dir="ltr"
                autoCapitalize="none"
                className={inputCls}
              />
              {err("instapayAddress")}
            </label>
          ) : (
            <label className="block text-sm">
              <span className="font-semibold">{t("payout.pro.walletPhone")}</span>
              <input
                value={draft.walletPhone}
                onChange={(e) => set({ walletPhone: e.target.value })}
                placeholder="01012345678"
                inputMode="tel"
                dir="ltr"
                className={inputCls}
              />
              {err("walletPhone")}
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={add.isPending}
              className="focus-ring min-h-11 rounded-xl bg-brand px-4 text-sm font-bold text-brand-foreground disabled:opacity-50"
              onClick={save}
            >
              {t("payout.pro.save")}
            </button>
            <button
              type="button"
              className="focus-ring min-h-11 rounded-xl border border-border px-4 text-sm font-bold"
              onClick={() => {
                setDraft(null);
                setErrors([]);
              }}
            >
              {t("payout.pro.cancel")}
            </button>
          </div>
        </div>
      ) : audience === "pro" ? (
        <button
          type="button"
          className="focus-ring min-h-11 rounded-xl border border-border px-4 text-sm font-bold"
          onClick={() => setDraft(emptyPayoutDraft())}
        >
          {t("payout.pro.add")}
        </button>
      ) : null}
    </section>
  );
}
