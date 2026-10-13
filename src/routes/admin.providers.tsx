import { createFileRoute, Link, useRouterState } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useAdminProviders, useSetProviderActive,
  useAdminIdentityConflicts, type AdminProviderFilter,
} from "@/lib/db/admin-queries";
import { Search, ChevronRight, ShieldCheck } from "lucide-react";
import { AdminQueryError } from "@/components/admin/AdminQueryError";
import { adminPath } from "@/lib/preview/previewPath";
import { isProviderWorkQueueKey } from "@/lib/db/admin-work-queue";

export const Route = createFileRoute("/admin/providers")({ component: ProviderManagement });

const FILTER_KEYS: { key: AdminProviderFilter; labelKey: string }[] = [
  { key: "pending", labelKey: "admin.providers.filterPending" },
  { key: "verified", labelKey: "admin.providers.filterVerified" },
  { key: "suspended", labelKey: "admin.providers.filterSuspended" },
  { key: "all", labelKey: "admin.providers.filterAll" },
];

function ProviderManagement() {
  const { t } = useTranslation();
  const queueParam = useRouterState({ select: (state) => (state.location.search as Record<string, unknown>).queue });
  const queue = isProviderWorkQueueKey(queueParam) ? queueParam : undefined;
  const [filter, setFilter] = useState<AdminProviderFilter>("pending");
  const [query, setQuery] = useState("");
  const q = useAdminProviders(queue ? "all" : filter, queue);
  const conflictsQ = useAdminIdentityConflicts();
  const setActive = useSetProviderActive();

  const rows = useMemo(() => {
    const all = q.data ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((p: any) => {
      const name = String(p.profile?.full_name ?? "").toLowerCase();
      const phone = String(p.profile?.phone ?? "").toLowerCase();
      const city = String(p.city ?? "").toLowerCase();
      return name.includes(needle) || phone.includes(needle) || city.includes(needle);
    });
  }, [q.data, query]);

  return (
    <div className="px-5 py-5 space-y-4">
      <div>
        <h1 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">{t("admin.providers.title")}</h1>
        <p className="text-xs text-muted-foreground">{t("admin.providers.subtitle")}</p>
        {queue && <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-bold">{t("adminWorkQueue." + queue)}</span>
          <Link to={adminPath("/admin/providers") as "/admin/providers"} search={{} as any}
            className="focus-ring inline-flex min-h-11 items-center rounded-xl border border-border px-3 text-sm font-bold">
            {t("adminReview.clearQueue")}
          </Link>
        </div>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-h-11 min-w-[240px] flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("admin.providers.searchPlaceholder")}
            className="w-full bg-transparent text-sm outline-none"
          />
        </div>
        {!queue && <div className="flex gap-1 rounded-xl border border-border bg-surface p-1">
          {FILTER_KEYS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`focus-ring min-h-11 rounded-lg px-3 py-2 text-xs font-bold ${filter === f.key ? "bg-brand text-brand-foreground" : "text-muted-foreground"}`}
            >
              {t(f.labelKey)}
            </button>
          ))}
        </div>}
      </div>

      {(conflictsQ.data ?? []).length > 0 && (
        <section className="rounded-2xl border border-coral/30 bg-coral/5 p-4" aria-label={t("adminReview.identityConflicts")}>
          <h2 className="text-sm font-extrabold text-coral">{t("adminReview.identityConflicts")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("adminReview.identityConflictsHint")}</p>
          <ul className="mt-2 space-y-2">
            {conflictsQ.data!.map((conflict: any) => (
              <li key={`${conflict.user_id}-${conflict.issue_code}`} className="rounded-xl bg-surface p-3 text-xs">
                <div className="font-bold">{conflict.full_name || conflict.user_id}</div>
                <div className="font-semibold text-coral">{conflict.details}</div>
                {conflict.provider_id && <Link to={adminPath("/admin/provider/$id") as "/admin/provider/$id"} params={{ id: conflict.provider_id }} className="focus-ring mt-1 inline-flex min-h-11 items-center font-bold text-brand underline">{t("adminReview.reviewApplication")}</Link>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {q.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-muted" />)}
        </div>
      ) : q.isError ? (
        <AdminQueryError message={t("admin.providers.loadError")} error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("admin.providers.noResults")}</p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-2xl border border-border/60 bg-surface shadow-sm">
          {rows.map((p: any) => {
            const suspended = p.is_verified && !p.is_active;
            return (
              <li key={p.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <Link to={adminPath("/admin/provider/$id") as "/admin/provider/$id"} params={{ id: p.id }} className="focus-ring min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{p.profile?.full_name || t("admin.providers.unnamed")}</p>
                    <p className="truncate text-xs text-muted-foreground">{p.city} · {t("admin.providers.hourlyRate", { rate: p.hourly_rate })} · {t("admin.providers.yearsExp", { years: p.years_experience })}</p>
                    <p dir="ltr" className="mt-1 text-[11px] text-muted-foreground">{p.profile?.phone}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] font-semibold">
                      <span className="text-brand">{t("admin.providers.trust", { score: Math.round(Number(p.trust?.score ?? 0)) })}</span>
                      <span className="text-amber-600">★ {Number(p.ratings?.rating_avg ?? 0).toFixed(1)}</span>
                      <span className="text-muted-foreground">{t("admin.providers.jobs", { count: Number(p.ratings?.rating_count ?? 0) })}</span>
                    </div>
                  </Link>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className={`rounded-full px-2 py-1 text-xs font-bold ${p.is_verified ? "bg-mint/20 text-success" : "bg-amber-100 text-amber-700"}`}>
                      {p.is_verified ? t("admin.providers.verified") : String(t("pro.onboardingWizard.status." + p.onboarding_status, p.onboarding_status || t("admin.providers.pending")))}
                    </span>
                    {suspended && (
                      <span className="rounded-full bg-coral/10 px-2 py-0.5 text-[10px] font-bold uppercase text-coral">{t("admin.providers.suspended")}</span>
                    )}
                    <ChevronRight className="rtl-flip mt-1 h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {!p.is_verified ? (
                    <Link to={adminPath("/admin/provider/$id") as "/admin/provider/$id"} params={{ id: p.id }}
                      className="focus-ring inline-flex min-h-11 items-center rounded-xl bg-brand px-4 text-sm font-bold text-brand-foreground">
                      {t("adminReview.reviewApplication")}
                    </Link>
                  ) : (
                    <button
                      disabled={setActive.isPending}
                      onClick={() => setActive.mutate({ id: p.id, active: !p.is_active })}
                      className={`focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold disabled:opacity-50 ${
                        p.is_active ? "border border-coral text-coral" : "bg-brand text-brand-foreground"
                      }`}
                    >
                      <ShieldCheck className="h-3.5 w-3.5" />
                      {p.is_active ? t("admin.providers.suspend") : t("admin.providers.unsuspend")}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
