import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { formatEGP } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  useProviderLedger,
  useProviderSettlementBalance,
  useProviderSettlements,
  type ProviderSettlementRow,
} from "@/lib/db/provider-settlement-queries";
import { useQueryClient } from "@tanstack/react-query";
import {
  balanceSentence,
  isSettlementOpen,
  ledgerKindLabel,
  ledgerSignedAmount,
  settlementStateLabel,
  settlementTone,
} from "@/lib/settlement/moneyText";
import { settlementPeriodShort } from "@/lib/settlement/settlementPresentation";
import { adminDate } from "@/components/admin/adminPresentation";
import { bookingCode } from "@/components/admin/operations";
import { AdminQueryError } from "@/components/admin";
import { useLang } from "@/components/famio/LanguageToggle";

function toneClass(tone: ReturnType<typeof settlementTone>) {
  if (tone === "pending") return "bg-amber-500/15 text-amber-800 dark:text-amber-200";
  if (tone === "done") return "bg-success/15 text-success";
  return "bg-muted text-muted-foreground";
}

export function AdminProviderSettlements({ providerId }: { providerId: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const qc = useQueryClient();
  const balance = useProviderSettlementBalance(providerId);
  const settlements = useProviderSettlements(providerId);
  const ledger = useProviderLedger(providerId, 60);
  const [settlementId, setSettlementId] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const all = (settlements.data ?? []).filter((s) => Number(s.amount) > 0);
  const open = all.filter(isSettlementOpen);
  const closed = all.filter((s) => !isSettlementOpen(s));
  const selected = open.find((s) => s.id === settlementId) ?? null;

  const reset = () => {
    setSettlementId(null);
    setReference("");
    setNote("");
  };

  const settle = async () => {
    if (!selected) return;
    if (!reference.trim()) {
      toast.error(t("admin.settlement.referenceRequired"));
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("admin_mark_provider_settlement_settled", {
      p_settlement_id: selected.id,
      p_reference: reference.trim(),
      p_note: note.trim() || null,
      p_reason: t("admin.settlement.defaultReason"),
    });
    setBusy(false);
    if (error) {
      toast.error(t("admin.settlement.saveFailed"));
      return;
    }
    toast.success(t("admin.settlement.settled"));
    reset();
    void qc.invalidateQueries({ queryKey: ["provider-settlements", providerId] });
    void qc.invalidateQueries({ queryKey: ["provider-ledger", providerId] });
    void qc.invalidateQueries({ queryKey: ["provider-settlement-balance", providerId] });
    void qc.invalidateQueries({ queryKey: ["admin-finance-summary"] });
    void qc.invalidateQueries({ queryKey: ["admin-finance-providers"] });
  };

  const week = (s: ProviderSettlementRow) =>
    t("admin.settlement.week", {
      range: settlementPeriodShort(s.period_start, s.period_end, lang),
    });

  const loadError = balance.isError || settlements.isError || ledger.isError;

  return (
    <section
      id="provider-account"
      className="scroll-mt-24 space-y-5 rounded-2xl border border-border bg-surface p-4"
    >
      <h2 className="text-base font-extrabold">{t("admin.settlement.title")}</h2>

      {loadError ? (
        <AdminQueryError
          message={t("admin.settlement.loadError")}
          onRetry={() => {
            void balance.refetch();
            void settlements.refetch();
            void ledger.refetch();
          }}
        />
      ) : null}

      {balance.data ? (
        <div className="space-y-1 rounded-xl bg-surface-2/60 p-3">
          <p className="text-xs font-bold text-muted-foreground">
            {t("admin.settlement.balanceNow")}
          </p>
          <p
            className={`text-lg font-extrabold ${
              balance.data.net < 0 ? "text-destructive" : balance.data.net > 0 ? "text-success" : ""
            }`}
          >
            {balanceSentence(balance.data.net, "admin", t, formatEGP)}
          </p>
          {balance.data.cash_held_for_platform > 0 &&
          Math.abs(balance.data.cash_held_for_platform + balance.data.net) > 0.005 ? (
            <p className="text-xs text-muted-foreground">
              {t("admin.settlement.cashCommission", {
                amount: formatEGP(balance.data.cash_held_for_platform),
              })}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-2">
        <h3 className="text-sm font-extrabold">{t("admin.settlement.openTitle")}</h3>
        {open.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("admin.settlement.openEmpty")}</p>
        ) : (
          <ul className="space-y-2">
            {open.map((s) => (
              <li key={s.id} className="space-y-2 rounded-xl border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-base font-extrabold tabular-nums">
                    {formatEGP(s.amount)}
                  </span>
                  <span
                    className={`rounded-lg px-2 py-0.5 text-xs font-bold ${toneClass(settlementTone(s))}`}
                  >
                    {settlementStateLabel(s, "admin", t)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{week(s)}</p>
                {settlementId !== s.id ? (
                  <button
                    type="button"
                    className="focus-ring min-h-11 rounded-xl bg-brand px-4 text-sm font-bold text-brand-foreground"
                    onClick={() => {
                      reset();
                      setSettlementId(s.id);
                    }}
                  >
                    {s.direction === "famy_pays_provider"
                      ? t("admin.settlement.actionFamyPays")
                      : t("admin.settlement.actionProviderPays")}
                  </button>
                ) : (
                  <div className="space-y-3 rounded-xl border border-brand/30 bg-brand/5 p-3">
                    <p className="text-sm font-extrabold">
                      {s.direction === "famy_pays_provider"
                        ? t("admin.settlement.confirmFamyPays", { amount: formatEGP(s.amount) })
                        : t("admin.settlement.confirmProviderPays", {
                            amount: formatEGP(s.amount),
                          })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("admin.settlement.confirmHint")}
                    </p>
                    <label className="block text-sm">
                      <span className="font-semibold">{t("admin.settlement.reference")}</span>
                      <input
                        value={reference}
                        onChange={(e) => setReference(e.target.value)}
                        placeholder={t("admin.settlement.referencePlaceholder")}
                        className="mt-1 block min-h-11 w-full rounded-xl border border-border bg-background px-3 text-sm"
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="font-semibold">{t("admin.settlement.noteOptional")}</span>
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={2}
                        className="mt-1 block w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy || !reference.trim()}
                        className="focus-ring min-h-11 rounded-xl bg-brand px-4 text-sm font-bold text-brand-foreground disabled:opacity-50"
                        onClick={() => void settle()}
                      >
                        {t("admin.settlement.save")}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className="focus-ring min-h-11 rounded-xl border border-border px-4 text-sm font-bold"
                        onClick={reset}
                      >
                        {t("admin.settlement.back")}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-extrabold">{t("admin.settlement.historyTitle")}</h3>
        {closed.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("admin.settlement.historyEmpty")}</p>
        ) : (
          <ul className="divide-y divide-border/60 rounded-xl border border-border">
            {closed.slice(0, 12).map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-bold tabular-nums">{formatEGP(s.amount)}</p>
                  <p className="text-xs text-muted-foreground">
                    {week(s)}
                    {s.settled_at ? ` · ${adminDate(s.settled_at, lang, false)}` : ""}
                    {s.payment_reference ? (
                      <>
                        {" · "}
                        <bdi dir="ltr">{s.payment_reference}</bdi>
                      </>
                    ) : null}
                  </p>
                </div>
                <span
                  className={`rounded-lg px-2 py-0.5 text-xs font-bold ${toneClass(settlementTone(s))}`}
                >
                  {settlementStateLabel(s, "admin", t)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-extrabold">{t("admin.settlement.movementsTitle")}</h3>
        <p className="text-xs text-muted-foreground">{t("admin.settlement.movementsHint")}</p>
        {(ledger.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("admin.settlement.movementsEmpty")}</p>
        ) : (
          <ul className="max-h-80 divide-y divide-border/40 overflow-y-auto rounded-xl border border-border text-sm">
            {(ledger.data ?? []).map((row) => {
              const signed = ledgerSignedAmount(row.direction, row.amount);
              return (
                <li key={row.id} className="flex items-start justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{ledgerKindLabel(row.kind, t)}</p>
                    <p className="text-xs text-muted-foreground">
                      {adminDate(row.created_at, lang)}
                      {row.booking_id ? (
                        <>
                          {" · "}
                          {t("adminOps.booking")} <bdi dir="ltr">{bookingCode(row.booking_id)}</bdi>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <span
                    className={`flex shrink-0 items-center gap-1 font-extrabold tabular-nums ${
                      signed < 0 ? "text-destructive" : "text-success"
                    }`}
                  >
                    <span>{signed < 0 ? "-" : "+"}</span>
                    <span>{formatEGP(Math.abs(signed))}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
