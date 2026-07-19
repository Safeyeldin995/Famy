import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useAdminProvider, useProviderEligibility, useSetProviderVerified, useSetProviderActive, useSetProviderServiceStatus, useDocumentSignedUrl } from "@/lib/db/admin-queries";
import { useProviderAvailability, useProviderVacations, useAddVacation, useDeleteVacation } from "@/lib/db/provider-queries";
import { ChevronLeft, FileText, ShieldCheck, Trash2, Check, X } from "lucide-react";
import { AdminQueryError } from "@/components/admin/AdminQueryError";

function EligibilitySection({ providerId }: { providerId: string }) {
  const { t } = useTranslation();
  const q = useProviderEligibility(providerId);
  if (q.isLoading) return <div className="h-24 animate-pulse rounded-2xl bg-muted" />;
  if (q.isError) return <AdminQueryError compact message={t("admin.providers.loadError")} error={q.error} onRetry={() => q.refetch()} />;
  const services = q.data ?? [];
  const eligible = services.some((service) => service.is_eligible);
  return (
    <section id="marketplace-eligibility" className="rounded-2xl border border-border/60 bg-surface p-4 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{t("admin.provider.eligibilityTitle")}</h3>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${eligible ? "bg-mint/20 text-success" : "bg-coral/10 text-coral"}`}>
          {t("admin.provider.marketplaceEligible", "Marketplace eligible")}: {eligible ? t("common.yes", "Yes") : t("common.no", "No")}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{eligible ? t("admin.provider.eligibleBody") : t("admin.provider.notEligibleBody")}</p>
      {services.length === 0 ? (
        <p className="mt-3 rounded-xl bg-coral/5 p-3 text-xs font-semibold text-coral">BLOCKED BY BUSINESS DATA — no Provider service is configured.</p>
      ) : services.map((e) => {
        const rows: Array<{ ok: boolean; label: string; to?: string }> = [
          { ok: e.identity_valid, label: t("admin.provider.eligIdentity", "Provider identity is valid") },
          { ok: e.account_active, label: t("admin.provider.eligActive"), to: "/admin/providers" },
          { ok: e.verified, label: t("admin.provider.eligVerified"), to: "/admin/providers" },
          { ok: e.service_approved, label: t("admin.provider.eligApprovedService"), to: "/admin/services" },
          { ok: e.service_active, label: t("admin.provider.eligServiceActive", "Service is active and Customer-visible"), to: "/admin/services" },
          { ok: e.price_valid, label: `${t("admin.provider.eligPriceValid")} (${e.effective_price}; ${e.minimum_price ?? "—"}–${e.maximum_price ?? "—"})`, to: "/admin/services" },
          { ok: e.requirements_complete, label: t("admin.provider.eligRequirementsMet"), to: "/admin/services" },
          { ok: e.evidence_approved, label: t("admin.provider.eligEvidence", "Required evidence is approved"), to: "/admin/services" },
          { ok: e.zone_covered, label: t("admin.provider.eligZoneCovered"), to: "/admin/zones" },
          { ok: e.availability_valid, label: t("admin.provider.eligAvailability"), to: "#provider-availability" },
          { ok: e.operational_clear, label: t("admin.provider.eligOperational", "No blocking operational state"), to: "/admin/operations" },
        ];
        return <div key={e.service_id} className="mt-3 rounded-xl border border-border/60 p-3">
          <div className="flex items-center justify-between gap-2 text-xs font-bold">
            <span>{e.service_name_en}</span>
            <span className={e.is_eligible ? "text-success" : "text-coral"}>{e.is_eligible ? "ELIGIBLE" : "BLOCKED BY BUSINESS DATA"}</span>
          </div>
          <ul className="mt-2 space-y-1.5">
            {rows.map((r) => <li key={r.label} className="flex items-center gap-2 text-xs">
              {r.ok ? <Check className="h-3.5 w-3.5 shrink-0 text-success" /> : <X className="h-3.5 w-3.5 shrink-0 text-coral" />}
              {r.to ? <Link to={r.to as any} className={r.ok ? "text-foreground" : "font-semibold text-coral underline"}>{r.label}</Link> : <span>{r.label}</span>}
            </li>)}
          </ul>
          {!e.is_eligible && <ul className="mt-2 list-disc ps-5 text-[11px] font-semibold text-coral">{e.failure_reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
        </div>;
      })}
    </section>
  );
}

const DAY_LABEL_KEYS = [
  "admin.provider.daySun", "admin.provider.dayMon", "admin.provider.dayTue", "admin.provider.dayWed",
  "admin.provider.dayThu", "admin.provider.dayFri", "admin.provider.daySat",
];

function AvailabilitySection({ providerId }: { providerId: string }) {
  const { t } = useTranslation();
  const rulesQ = useProviderAvailability(providerId);
  const vacQ = useProviderVacations(providerId);
  const addVac = useAddVacation();
  const delVac = useDeleteVacation();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");

  const canBlock = !!start && !!end && reason.trim().length > 0;

  return (
    <section id="provider-availability">
      <h3 className="mb-2 px-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">{t("admin.provider.availability")}</h3>
      <div className="rounded-xl border border-border/60 bg-surface p-3">
        <p className="text-[11px] font-bold text-muted-foreground">{t("admin.provider.weeklyHours")}</p>
        {(rulesQ.data ?? []).length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">{t("admin.provider.noWeeklyHours")}</p>
        ) : (
          <ul className="mt-1 space-y-0.5 text-xs">
            {rulesQ.data!.map((r: any) => (
              <li key={r.id} dir="ltr" className="text-start">{t(DAY_LABEL_KEYS[r.weekday])}: {r.start_time?.slice(0, 5)} – {r.end_time?.slice(0, 5)}</li>
            ))}
          </ul>
        )}

        <p className="mt-3 text-[11px] font-bold text-muted-foreground">{t("admin.provider.blockedPeriods")}</p>
        {(vacQ.data ?? []).length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">{t("admin.provider.none")}</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {vacQ.data!.map((v: any) => (
              <li key={v.id} className="flex items-center justify-between text-xs">
                <span dir="ltr" className="text-start">{v.start_date} → {v.end_date}{v.reason ? ` — ${v.reason}` : ""}</span>
                <button onClick={() => delVac.mutate({ id: v.id, providerId })} aria-label={t("common.delete")} className="focus-ring text-muted-foreground hover:text-coral"><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 space-y-2 border-t border-border pt-3">
          <p className="text-[11px] font-bold text-muted-foreground">{t("admin.provider.blockPeriodLabel")}</p>
          <div className="flex flex-wrap gap-2">
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} aria-label={t("admin.provider.blockStart")} className="focus-ring h-9 rounded-lg border border-border bg-surface px-2 text-xs" />
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} aria-label={t("admin.provider.blockEnd")} className="focus-ring h-9 rounded-lg border border-border bg-surface px-2 text-xs" />
          </div>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("admin.provider.reasonRequired")} aria-label={t("admin.provider.reasonRequired")} className="focus-ring h-9 w-full rounded-lg border border-border bg-surface px-2 text-xs" />
          <button
            disabled={!canBlock || addVac.isPending}
            onClick={() => { addVac.mutate({ providerId, start_date: start, end_date: end, reason }); setStart(""); setEnd(""); setReason(""); }}
            className="focus-ring rounded-lg bg-coral px-3 py-1.5 text-xs font-bold text-coral-foreground disabled:opacity-50"
          >
            {addVac.isPending ? t("admin.provider.blocking") : t("admin.provider.blockPeriod")}
          </button>
        </div>
      </div>
    </section>
  );
}

export const Route = createFileRoute("/admin/provider/$id")({ component: AdminProvider });

function AdminProvider() {
  const { t } = useTranslation();
  const { id } = Route.useParams();
  const q = useAdminProvider(id);
  const setVerified = useSetProviderVerified();
  const setActive = useSetProviderActive();
  const setServiceStatus = useSetProviderServiceStatus();
  const sign = useDocumentSignedUrl();
  const [showConfirm, setShowConfirm] = useState(false);
  const [showRejectApplication, setShowRejectApplication] = useState(false);
  const [applicationRejectReason, setApplicationRejectReason] = useState("");
  const [rejectingServiceId, setRejectingServiceId] = useState<string | null>(null);
  const [serviceRejectReason, setServiceRejectReason] = useState("");

  if (q.isLoading) return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  if (q.isError) return <div className="p-6"><AdminQueryError message={t("admin.providers.loadError")} error={q.error} onRetry={() => q.refetch()} /></div>;
  const p: any = q.data;
  if (!p) return <div className="p-6 text-sm text-muted-foreground">{t("admin.provider.notFound")}</div>;

  const suspended = p.is_verified && !p.is_active;

  const openDoc = async (path: string) => {
    const url = await sign.mutateAsync(path);
    window.open(url, "_blank", "noopener");
  };

  const toggleSuspend = () => {
    setActive.mutate(
      { id: p.id, active: !p.is_active },
      {
        onSuccess: () => setShowConfirm(false),
        onError: (e: any) => toast.error(e?.message ?? t("admin.providers.approveError")),
      },
    );
  };

  return (
    <div className="px-5 py-4 space-y-4">
      <Link to="/admin/providers" className="focus-ring inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground" aria-label={t("common.back")}>
        <ChevronLeft className="h-4 w-4" /> {t("common.back")}
      </Link>

      <section className="rounded-2xl border border-border/60 bg-surface p-4 shadow-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-extrabold">{p.profile?.full_name || t("admin.provider.unnamed")}</h2>
            <p dir="ltr" className="text-xs text-muted-foreground">{p.profile?.phone} · {p.profile?.email}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${p.is_verified ? "bg-mint/20 text-success" : "bg-amber-100 text-amber-700"}`}>
              {p.is_verified ? t("admin.providers.verified") : t("admin.providers.pending")}
            </span>
            {suspended && (
              <span className="rounded-full bg-coral/10 px-2 py-0.5 text-[10px] font-bold uppercase text-coral">{t("admin.providers.suspended")}</span>
            )}
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div><dt className="text-muted-foreground">{t("admin.provider.city")}</dt><dd className="font-semibold">{p.city}</dd></div>
          <div><dt className="text-muted-foreground">{t("admin.provider.rate")}</dt><dd className="font-semibold">{t("admin.providers.hourlyRate", { rate: p.hourly_rate })}</dd></div>
          <div><dt className="text-muted-foreground">{t("admin.provider.experience")}</dt><dd className="font-semibold">{t("admin.provider.yearsValue", { years: p.years_experience })}</dd></div>
          <div><dt className="text-muted-foreground">{t("admin.provider.trustScore")}</dt><dd className="font-semibold">{Math.round(Number(p.trust?.score ?? 0))}</dd></div>
          <div><dt className="text-muted-foreground">{t("admin.provider.rating")}</dt><dd className="font-semibold">★ {Number(p.ratings?.rating_avg ?? 0).toFixed(1)}</dd></div>
          <div><dt className="text-muted-foreground">{t("admin.provider.completedJobs")}</dt><dd className="font-semibold">{Number(p.ratings?.rating_count ?? 0)}</dd></div>
        </dl>
        {p.bio_en && <p className="mt-3 text-xs text-muted-foreground">{p.bio_en}</p>}
      </section>

      <EligibilitySection providerId={p.id} />

      <AvailabilitySection providerId={p.id} />

      <section>
        <h3 className="mb-2 px-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">{t("admin.provider.documents")}</h3>
        {(p.documents ?? []).length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">{t("admin.provider.noDocuments")}</p>
        ) : (
          <ul className="space-y-2">
            {p.documents.map((d: any) => (
              <li key={d.id}>
                <button
                  onClick={() => openDoc(d.storage_path)}
                  className="focus-ring flex w-full items-center gap-3 rounded-xl border border-border/60 bg-surface p-3 text-start"
                >
                  <FileText className="h-4 w-4 shrink-0 text-navy" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{d.type}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{d.status} · {new Date(d.created_at).toLocaleDateString()}</p>
                  </div>
                  <span className="shrink-0 text-[11px] font-semibold text-coral">{t("admin.provider.open")}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 px-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">{t("admin.provider.requestedServices")}</h3>
        {(p.services ?? []).length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">{t("admin.provider.noServicesRequested")}</p>
        ) : (
          <ul className="space-y-2">
            {p.services.map((ps: any) => (
              <li key={ps.id} className="rounded-xl border border-border/60 bg-surface p-3">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{ps.service?.name_en}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{ps.service?.category?.name_en} · {ps.status}</p>
                    {ps.status === "rejected" && ps.rejection_reason && (
                      <p className="mt-0.5 text-[11px] text-coral">{t("admin.provider.reasonPrefix", { reason: ps.rejection_reason })}</p>
                    )}
                  </div>
                  {ps.status === "pending" && (
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        disabled={setServiceStatus.isPending}
                        onClick={() => setServiceStatus.mutate(
                          { providerServiceId: ps.id, status: "approved" },
                          { onError: (e: any) => toast.error(e?.message ?? t("admin.provider.approveServiceError")) },
                        )}
                        className="focus-ring rounded-lg bg-navy px-3 py-1.5 text-[11px] font-bold text-navy-foreground disabled:opacity-50"
                      >{t("admin.providers.approve")}</button>
                      <button
                        disabled={setServiceStatus.isPending}
                        onClick={() => { setRejectingServiceId(ps.id); setServiceRejectReason(""); }}
                        className="focus-ring rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold disabled:opacity-50"
                      >{t("admin.providers.reject")}</button>
                    </div>
                  )}
                </div>
                {rejectingServiceId === ps.id && (
                  <div className="mt-2 space-y-2 rounded-lg border border-coral/30 bg-coral/5 p-2">
                    <p className="text-[11px] font-bold text-coral">{t("admin.providers.rejectReasonLabel")}</p>
                    <textarea
                      value={serviceRejectReason}
                      onChange={(e) => setServiceRejectReason(e.target.value)}
                      rows={2}
                      placeholder={t("admin.provider.rejectServicePlaceholder")}
                      aria-label={t("admin.providers.rejectReasonLabel")}
                      className="w-full resize-none rounded-lg border border-border bg-surface p-2 text-xs"
                    />
                    <div className="flex gap-2">
                      <button
                        disabled={!serviceRejectReason.trim() || setServiceStatus.isPending}
                        onClick={() => setServiceStatus.mutate(
                          { providerServiceId: ps.id, status: "rejected", reason: serviceRejectReason.trim() },
                          {
                            onSuccess: () => setRejectingServiceId(null),
                            onError: (e: any) => toast.error(e?.message ?? t("admin.provider.rejectServiceError")),
                          },
                        )}
                        className="focus-ring rounded-lg bg-coral px-3 py-1.5 text-[11px] font-bold text-coral-foreground disabled:opacity-50"
                      >{t("admin.providers.confirmReject")}</button>
                      <button onClick={() => setRejectingServiceId(null)} className="focus-ring rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold">{t("common.cancel")}</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex gap-2 pt-2">
        {!p.is_verified ? (
          <>
            <button
              disabled={setVerified.isPending}
              onClick={() => setVerified.mutate(
                { id: p.id, verified: true },
                { onError: (e: any) => toast.error(e?.message ?? t("admin.providers.approveError")) },
              )}
              className="focus-ring flex-1 rounded-xl bg-navy py-3 text-sm font-bold text-navy-foreground disabled:opacity-50"
            >{t("admin.providers.approve")}</button>
            <button
              disabled={setVerified.isPending}
              onClick={() => { setApplicationRejectReason(""); setShowRejectApplication(true); }}
              className="focus-ring flex-1 rounded-xl border border-border py-3 text-sm font-bold disabled:opacity-50"
            >{t("admin.providers.reject")}</button>
          </>
        ) : (
          <button
            disabled={setActive.isPending}
            onClick={() => setShowConfirm(true)}
            className={`focus-ring flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold disabled:opacity-50 ${
              p.is_active ? "border border-coral text-coral" : "bg-navy text-navy-foreground"
            }`}
          >
            <ShieldCheck className="h-4 w-4" />
            {p.is_active ? t("admin.provider.suspendProvider") : t("admin.provider.unsuspendProvider")}
          </button>
        )}
      </div>

      {showConfirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-6" onClick={() => setShowConfirm(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="suspend-provider-title" className="w-full max-w-sm rounded-3xl bg-surface p-5" onClick={(e) => e.stopPropagation()}>
            <div id="suspend-provider-title" className="text-base font-extrabold">
              {p.is_active ? t("admin.provider.suspendConfirmTitle") : t("admin.provider.unsuspendConfirmTitle")}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {p.is_active ? t("admin.provider.suspendConfirmBody") : t("admin.provider.unsuspendConfirmBody")}
            </p>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setShowConfirm(false)} className="focus-ring h-11 flex-1 rounded-2xl border border-border bg-surface text-sm font-bold">{t("common.cancel")}</button>
              <button onClick={toggleSuspend} disabled={setActive.isPending} className="focus-ring h-11 flex-1 rounded-2xl bg-coral text-sm font-bold text-coral-foreground disabled:opacity-50">
                {p.is_active ? t("admin.provider.confirmSuspend") : t("admin.provider.unsuspendProvider")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRejectApplication && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-6" onClick={() => setShowRejectApplication(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="reject-application-title" className="w-full max-w-sm rounded-3xl bg-surface p-5" onClick={(e) => e.stopPropagation()}>
            <div id="reject-application-title" className="text-base font-extrabold">{t("admin.provider.rejectApplicationTitle")}</div>
            <p className="mt-1 text-xs text-muted-foreground">{t("admin.provider.rejectApplicationBody")}</p>
            <textarea
              value={applicationRejectReason}
              onChange={(e) => setApplicationRejectReason(e.target.value)}
              rows={3}
              placeholder={t("admin.provider.reasonRequired")}
              aria-label={t("admin.provider.reasonRequired")}
              className="mt-3 w-full resize-none rounded-xl border border-border bg-surface p-2 text-sm"
            />
            <div className="mt-4 flex gap-2">
              <button onClick={() => setShowRejectApplication(false)} className="focus-ring h-11 flex-1 rounded-2xl border border-border bg-surface text-sm font-bold">{t("common.cancel")}</button>
              <button
                disabled={!applicationRejectReason.trim() || setVerified.isPending}
                onClick={() => setVerified.mutate(
                  { id: p.id, verified: false, reason: applicationRejectReason.trim() },
                  {
                    onSuccess: () => setShowRejectApplication(false),
                    onError: (e: any) => toast.error(e?.message ?? t("admin.providers.rejectError")),
                  },
                )}
                className="focus-ring h-11 flex-1 rounded-2xl bg-coral text-sm font-bold text-coral-foreground disabled:opacity-50"
              >{t("admin.providers.confirmReject")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
