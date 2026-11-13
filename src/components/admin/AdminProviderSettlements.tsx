import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { formatEGP } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  useProviderLedger,
  useProviderSettlementBalance,
  useProviderSettlements,
} from "@/lib/db/provider-settlement-queries";
import { useQueryClient } from "@tanstack/react-query";
import { providerSettlementDirectionLabel } from "@/lib/settlement/providerSettlementDirection";
import { settlementPeriodShort, settlementStatusLabel } from "@/lib/settlement/settlementPresentation";
import { useLang } from "@/components/famio/LanguageToggle";

export function AdminProviderSettlements({ providerId }: { providerId: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const qc = useQueryClient();
  const balance = useProviderSettlementBalance(providerId);
  const settlements = useProviderSettlements(providerId);
  const ledger = useProviderLedger(providerId, 40);
  const [settlementId, setSettlementId] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");

  const selectedSettlement = (settlements.data ?? []).find((s) => s.id === settlementId);

  const settle = async () => {
    if (!settlementId || !reference.trim() || !reason.trim()) {
      toast.error(t("admin.settlement.referenceRequired"));
      return;
    }
    const { error } = await supabase.rpc("admin_mark_provider_settlement_settled", {
      p_settlement_id: settlementId,
      p_reference: reference.trim(),
      p_note: note.trim() || null,
      p_reason: reason.trim(),
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("admin.settlement.settled"));
    setSettlementId(null);
    setReference("");
    setNote("");
    setReason("");
    void qc.invalidateQueries({ queryKey: ["provider-settlements", providerId] });
    void qc.invalidateQueries({ queryKey: ["provider-ledger", providerId] });
    void qc.invalidateQueries({ queryKey: ["provider-settlement-balance", providerId] });
  };

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-surface p-4">
      <h2 className="text-sm font-extrabold uppercase tracking-wide text-muted-foreground">
        {t("admin.settlement.title")}
      </h2>
      {balance.data && (
        <p className="text-sm font-semibold">
          {t("admin.settlement.net")}: {formatEGP(balance.data.net)}
          {" · "}
          {t("admin.settlement.cashHeld")}: {formatEGP(balance.data.cash_held_for_platform)}
        </p>
      )}
      <h3 className="text-xs font-bold text-muted-foreground">{t("pro.settlement.history")}</h3>
      <ul className="space-y-2">
        {(settlements.data ?? []).map((s) => (
          <li key={s.id} className="rounded-xl border border-border/60 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold tabular-nums">{formatEGP(s.amount)}</span>
              <span className="text-xs font-bold">{settlementStatusLabel(s.status, t)}</span>
            </div>
            <p className="text-xs font-semibold text-foreground">
              {providerSettlementDirectionLabel(s.direction, t)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {settlementPeriodShort(s.period_start, s.period_end, lang)}
            </p>
            {s.status === "pending" && (
              <button
                type="button"
                className="focus-ring mt-2 rounded-lg bg-brand px-3 py-1.5 text-xs font-bold text-brand-foreground"
                onClick={() => setSettlementId(s.id)}
              >
                {t("admin.settlement.markSettled")}
              </button>
            )}
          </li>
        ))}
      </ul>
      {settlementId && (
        <div className="space-y-2 rounded-xl border border-brand/30 bg-brand/5 p-3">
          {selectedSettlement ? (
            <p className="text-sm font-bold">
              {formatEGP(selectedSettlement.amount)} ·{" "}
              {providerSettlementDirectionLabel(selectedSettlement.direction, t)}
            </p>
          ) : null}
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={t("admin.settlement.reference")}
            className="w-full rounded-xl border border-border px-3 py-2 text-sm"
          />
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("admin.settlement.noteOptional")}
            className="w-full rounded-xl border border-border px-3 py-2 text-sm"
            rows={2}
          />
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("adminReview.reason")}
            className="w-full rounded-xl border border-border px-3 py-2 text-sm"
            rows={2}
          />
          <button
            type="button"
            className="focus-ring rounded-xl bg-brand px-4 py-2 text-xs font-bold text-brand-foreground"
            onClick={() => void settle()}
          >
            {t("admin.settlement.markSettled")}
          </button>
        </div>
      )}
      <h3 className="text-xs font-bold text-muted-foreground">{t("pro.settlement.ledger")}</h3>
      <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
        {(ledger.data ?? []).map((row) => (
          <li key={row.id} className="flex justify-between gap-2 border-b border-border/40 py-1">
            <span>{row.kind}</span>
            <span>
              {row.direction} {formatEGP(row.amount)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
