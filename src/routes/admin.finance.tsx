import { AdminLink as Link } from "@/components/admin/AdminNavigation";
import {
  AdminEmptyState,
  AdminQueryError,
  AdminQueryState,
  AdminTable,
  AdminTableBody,
  AdminTableHead,
  AdminTableRow,
  AdminTableTd,
  AdminTableTh,
} from "@/components/admin";
import { adminDate } from "@/components/admin/adminPresentation";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useAdminFinanceProviders,
  useAdminFinanceSummary,
  useSettlementClosedPeriod,
  type AdminFinanceProviderRow,
} from "@/lib/db/admin-finance-queries";
import { useProviderSettlementSettingsAdmin } from "@/lib/db/settings-queries";
import {
  financeRangeForDays,
  financeRangeForPreset,
  type FinancePreset,
} from "@/lib/settlement/cairoSettlementWeek";
import { balanceSentence } from "@/lib/settlement/moneyText";
import { providerCashDebtNearLimit } from "@/lib/settlement/settlementPresentation";
import { formatEGP } from "@/lib/utils";
import { useLang } from "@/components/famio/LanguageToggle";

export const Route = createFileRoute("/admin/finance")({ component: AdminFinancePage });

const KNOWN_METHODS = ["cash", "gateway", "transfer"] as const;

function MoneyCard({
  label,
  value,
  hint,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  sub?: string;
  tone?: "default" | "brand" | "warn";
}) {
  const valueTone =
    tone === "brand" ? "text-brand" : tone === "warn" ? "text-destructive" : "text-foreground";
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <p className="text-sm font-bold text-foreground">{label}</p>
      <p className={`text-xl font-extrabold tabular-nums ${valueTone}`}>{value}</p>
      {sub ? <p className="text-xs font-semibold text-foreground">{sub}</p> : null}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function rangeDate(iso: string, lang: string) {
  const ar = lang.startsWith("ar");
  const d = new Date(iso);
  const opts = { timeZone: "Africa/Cairo", numberingSystem: "latn" } as const;
  const locale = ar ? "ar-EG-u-nu-latn" : "en-GB";
  const day = new Intl.DateTimeFormat(locale, {
    ...opts,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
  const time = new Intl.DateTimeFormat(locale, {
    ...opts,
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
  return `${day.replace("،", "")} ${ar ? "الساعة" : "at"} ${time}`;
}

/** Weekday name for a settlement weekday index (0 = Sunday). */
function weekdayName(weekday: number, lang: string) {
  // 15 Nov 2026 is a Sunday.
  const d = new Date(Date.UTC(2026, 10, 15 + (((weekday % 7) + 7) % 7), 12));
  return new Intl.DateTimeFormat(lang.startsWith("ar") ? "ar-EG" : "en-GB", {
    weekday: "long",
    timeZone: "Africa/Cairo",
  }).format(d);
}

function AdminFinancePage() {
  const { t } = useTranslation();
  const lang = useLang();
  const periodQ = useSettlementClosedPeriod();
  const settingsQ = useProviderSettlementSettingsAdmin();
  const [preset, setPreset] = useState<FinancePreset>("thisWeek");
  const [anchor, setAnchor] = useState(() => new Date().toISOString());
  const [fromDay, setFromDay] = useState("");
  const [toDay, setToDay] = useState("");

  const range = useMemo(() => {
    if (preset === "custom") return financeRangeForDays(fromDay, toDay);
    if (!periodQ.data) return null;
    return financeRangeForPreset(preset, periodQ.data, new Date(anchor));
  }, [preset, fromDay, toDay, periodQ.data, anchor]);

  const summaryQ = useAdminFinanceSummary(range?.from, range?.to);
  const providersQ = useAdminFinanceProviders();
  const limit = settingsQ.data?.cash_debt_limit ?? 1000;
  const warnPercent = settingsQ.data?.cash_debt_warn_percent ?? 80;

  const choosePreset = (next: FinancePreset) => {
    setPreset(next);
    setAnchor(new Date().toISOString());
  };

  const presets: { key: FinancePreset; label: string }[] = [
    { key: "thisWeek", label: t("admin.finance.periodThisWeek") },
    { key: "lastWeek", label: t("admin.finance.periodLastWeek") },
    { key: "thisMonth", label: t("admin.finance.periodThisMonth") },
    { key: "custom", label: t("admin.finance.periodCustom") },
  ];

  const rangeLabel = range
    ? t("admin.finance.rangeText", {
        from: rangeDate(range.from, lang),
        to:
          preset === "thisWeek" || preset === "thisMonth"
            ? t("admin.finance.now")
            : rangeDate(new Date(new Date(range.to).getTime() - 60_000).toISOString(), lang),
      })
    : null;

  const methodCards = (totals: Record<string, number>) => {
    const other = Object.entries(totals)
      .filter(([key]) => !(KNOWN_METHODS as readonly string[]).includes(key))
      .reduce((sum, [, amount]) => sum + amount, 0);
    const cards = KNOWN_METHODS.map((key) => ({
      key,
      amount: totals[key] ?? 0,
      label: t(
        key === "cash"
          ? "admin.finance.methodCash"
          : key === "gateway"
            ? "admin.finance.methodGateway"
            : "admin.finance.methodTransfer",
      ),
      hint: t(
        key === "cash"
          ? "admin.finance.methodCashHint"
          : key === "gateway"
            ? "admin.finance.methodGatewayHint"
            : "admin.finance.methodTransferHint",
      ),
    }));
    if (other > 0) {
      cards.push({
        key: "other" as never,
        amount: other,
        label: t("admin.finance.methodOther"),
        hint: t("admin.finance.methodOtherHint"),
      });
    }
    return cards;
  };

  const rows = providersQ.data ?? [];

  const statusCell = (row: AdminFinanceProviderRow) => {
    if (row.at_limit) {
      return (
        <span className="rounded-lg bg-destructive/15 px-2 py-0.5 text-xs font-bold text-destructive">
          {t("admin.finance.statusBlocked")}
        </span>
      );
    }
    if (providerCashDebtNearLimit(row.net, limit, warnPercent)) {
      return (
        <span className="rounded-lg bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-700 dark:text-amber-300">
          {t("admin.finance.statusNearLimit")}
        </span>
      );
    }
    return <span className="text-xs text-muted-foreground">{t("admin.finance.statusOk")}</span>;
  };

  const lastSettlementCell = (row: AdminFinanceProviderRow) => {
    const status = String(row.last_settlement_status ?? "").toLowerCase();
    if (!status) return t("admin.finance.noSettlementYet");
    if (status === "pending") return t("admin.finance.lastPending");
    if (status === "cancelled") return t("admin.finance.lastCancelled");
    return t("admin.finance.lastClosed", {
      date: row.last_settlement_at ? adminDate(row.last_settlement_at, lang, false) : "",
    }).trim();
  };

  return (
    <main className="space-y-6 px-4 py-5 sm:px-6">
      <header>
        <h1 className="text-xl font-extrabold">{t("admin.finance.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("admin.finance.subtitle")}</p>
      </header>

      <section className="space-y-3 rounded-2xl border border-border bg-surface p-4">
        <p className="text-sm font-bold">{t("admin.finance.periodLabel")}</p>
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label={t("admin.finance.periodLabel")}
        >
          {presets.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={preset === p.key}
              onClick={() => choosePreset(p.key)}
              className={`focus-ring min-h-11 rounded-xl border px-4 text-sm font-bold ${
                preset === p.key
                  ? "border-brand bg-brand text-brand-foreground"
                  : "border-border bg-background text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === "custom" ? (
          <div className="flex flex-wrap gap-3">
            <label className="block text-sm">
              <span className="font-semibold">{t("admin.finance.from")}</span>
              <input
                type="date"
                value={fromDay}
                onChange={(e) => setFromDay(e.target.value)}
                className="mt-1 block min-h-11 rounded-xl border border-border bg-background px-3"
              />
            </label>
            <label className="block text-sm">
              <span className="font-semibold">{t("admin.finance.to")}</span>
              <input
                type="date"
                value={toDay}
                onChange={(e) => setToDay(e.target.value)}
                className="mt-1 block min-h-11 rounded-xl border border-border bg-background px-3"
              />
            </label>
          </div>
        ) : null}
        {preset === "custom" && fromDay && toDay && !range ? (
          <p className="text-sm font-semibold text-destructive">
            {t("admin.finance.customInvalid")}
          </p>
        ) : null}
        {rangeLabel ? <p className="text-sm text-muted-foreground">{rangeLabel}</p> : null}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-extrabold">{t("admin.finance.paidTitle")}</h2>
          <p className="text-xs text-muted-foreground">{t("admin.finance.paidHint")}</p>
        </div>
        {!range ? null : (
          <AdminQueryState
            isLoading={summaryQ.isLoading}
            isError={summaryQ.isError}
            error={summaryQ.error}
            onRetry={() => summaryQ.refetch()}
            errorMessage={t("admin.finance.loadError")}
            skeletonCount={4}
          >
            {() => {
              const data = summaryQ.data;
              if (!data) return <AdminEmptyState title={t("admin.finance.emptySummary")} />;
              const cards = methodCards(data.totals_by_method);
              const total = Object.values(data.totals_by_method).reduce((a, b) => a + b, 0);
              return (
                <div className="space-y-3">
                  {total === 0 ? (
                    <p className="rounded-2xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                      {t("admin.finance.noPayments")}
                    </p>
                  ) : null}
                  <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                    <MoneyCard
                      label={t("admin.finance.paidTotal")}
                      value={formatEGP(total)}
                      hint={t("admin.finance.paidTotalHint")}
                      tone="brand"
                    />
                    {cards.map((c) => (
                      <MoneyCard
                        key={c.key}
                        label={c.label}
                        value={formatEGP(c.amount)}
                        hint={c.hint}
                      />
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                    <MoneyCard
                      label={t("admin.finance.platformShare")}
                      value={formatEGP(data.platform_share)}
                      hint={t("admin.finance.platformShareHint")}
                      tone="brand"
                    />
                  </div>
                </div>
              );
            }}
          </AdminQueryState>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-extrabold">{t("admin.finance.accountsTitle")}</h2>
          <p className="text-xs text-muted-foreground">{t("admin.finance.accountsHint")}</p>
        </div>
        {summaryQ.data ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <MoneyCard
              label={t("admin.finance.owedToProviders")}
              value={formatEGP(summaryQ.data.owed_to_providers)}
              hint={t("admin.finance.owedToProvidersHint")}
            />
            <MoneyCard
              label={t("admin.finance.owedByProviders")}
              value={formatEGP(summaryQ.data.owed_by_providers)}
              hint={t("admin.finance.owedByProvidersHint")}
              tone={summaryQ.data.owed_by_providers > 0 ? "warn" : "default"}
            />
            <MoneyCard
              label={t("admin.finance.pendingSettlements")}
              value={formatEGP(summaryQ.data.pending_settlement_amount)}
              sub={t("admin.finance.pendingSettlementsCount", {
                count: summaryQ.data.pending_settlement_count.toLocaleString("en-US"),
              })}
              hint={t("admin.finance.pendingSettlementsHint")}
            />
          </div>
        ) : null}

        <h3 className="pt-2 text-sm font-extrabold">{t("admin.finance.providersTitle")}</h3>
        {providersQ.isError ? (
          <AdminQueryError
            message={t("admin.finance.loadError")}
            error={providersQ.error}
            onRetry={() => providersQ.refetch()}
          />
        ) : providersQ.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : rows.length === 0 ? (
          <AdminEmptyState title={t("admin.finance.providersEmpty")} />
        ) : (
          <>
            <ul className="space-y-2 sm:hidden">
              {rows.map((row) => (
                <li
                  key={row.provider_id}
                  className="space-y-1 rounded-2xl border border-border bg-surface p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold">{row.full_name ?? "—"}</p>
                    <Link
                      to="/admin/provider/$id"
                      params={{ id: row.provider_id }}
                      hash="provider-account"
                      className="focus-ring text-xs font-bold text-brand"
                    >
                      {t("admin.finance.openAccount")}
                    </Link>
                  </div>
                  <p
                    className={`text-sm font-bold ${
                      row.net < 0
                        ? "text-destructive"
                        : row.net > 0
                          ? "text-success"
                          : "text-muted-foreground"
                    }`}
                  >
                    {balanceSentence(row.net, "admin", t, formatEGP)}
                  </p>
                  <div>{statusCell(row)}</div>
                  <p className="text-xs text-muted-foreground">
                    {t("admin.finance.colLastSettlement")}: {lastSettlementCell(row)}
                  </p>
                </li>
              ))}
            </ul>
            <div className="hidden sm:block">
              <AdminTable>
                <AdminTableHead>
                  <AdminTableTh>{t("admin.finance.colProvider")}</AdminTableTh>
                  <AdminTableTh>{t("admin.finance.colBalance")}</AdminTableTh>
                  <AdminTableTh>{t("admin.finance.colStatus")}</AdminTableTh>
                  <AdminTableTh>{t("admin.finance.colLastSettlement")}</AdminTableTh>
                  <AdminTableTh />
                </AdminTableHead>
                <AdminTableBody>
                  {rows.map((row) => (
                    <AdminTableRow key={row.provider_id}>
                      <AdminTableTd className="font-semibold">{row.full_name ?? "—"}</AdminTableTd>
                      <AdminTableTd
                        className={`text-sm font-bold ${
                          row.net < 0
                            ? "text-destructive"
                            : row.net > 0
                              ? "text-success"
                              : "text-muted-foreground"
                        }`}
                      >
                        {balanceSentence(row.net, "admin", t, formatEGP)}
                      </AdminTableTd>
                      <AdminTableTd>{statusCell(row)}</AdminTableTd>
                      <AdminTableTd className="text-xs text-muted-foreground">
                        {lastSettlementCell(row)}
                      </AdminTableTd>
                      <AdminTableTd>
                        <Link
                          to="/admin/provider/$id"
                          params={{ id: row.provider_id }}
                          hash="provider-account"
                          className="focus-ring text-xs font-bold text-brand"
                        >
                          {t("admin.finance.openAccount")}
                        </Link>
                      </AdminTableTd>
                    </AdminTableRow>
                  ))}
                </AdminTableBody>
              </AdminTable>
            </div>
          </>
        )}
      </section>

      <section className="space-y-2 rounded-2xl border border-border bg-surface-2/40 p-4">
        <h2 className="text-sm font-extrabold">{t("admin.finance.howTitle")}</h2>
        <ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground">
          <li>{t("admin.finance.how1")}</li>
          <li>{t("admin.finance.how2")}</li>
          <li>
            {t("admin.finance.how3", {
              day: weekdayName(settingsQ.data?.settlement_weekday ?? 0, lang),
            })}
          </li>
          <li>{t("admin.finance.how4", { limit: formatEGP(limit) })}</li>
          <li>{t("admin.finance.how5")}</li>
        </ul>
      </section>
    </main>
  );
}
