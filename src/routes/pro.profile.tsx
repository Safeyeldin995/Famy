import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { ProviderShell } from "@/components/famio/ProviderShell";
import { ProviderPageHero } from "@/components/famio/ProviderPageHero";
import { Card, PrimaryButton, Avatar } from "@/components/famio/ui";
import { QueryError } from "@/components/famio/QueryError";
import { supabase } from "@/integrations/supabase/client";
import { useServiceAreasSettings } from "@/lib/db/settings-queries";
import {
  useMyProvider,
  useUpdateProvider,
  useAllServices,
  useMyProviderServices,
  useToggleProviderService,
  useSetProviderPrice,
  useRequirementsForService,
  useMyRequirementFulfillments,
  useDeclareRequirement,
  useUploadRequirementEvidence,
  useMyMarketplaceEligibility,
} from "@/lib/db/provider-queries";
import {
  FileText,
  ShieldCheck,
  LogOut,
  Camera,
  Loader2,
  Upload,
  Bell,
  ChevronDown,
} from "lucide-react";
import { LanguageToggle, useLang } from "@/components/famio/LanguageToggle";
import { customerPath, proPath } from "@/lib/preview/previewPath";
import { TeachingCapabilitiesEditor } from "@/components/provider/TeachingCapabilitiesEditor";
import { isTutoringCategorySlug } from "@/lib/tutoring/teachingCapabilities";
import {
  dedupeEligibilityReasons,
  mapMarketplaceEligibilityFailureReason,
  type MappedEligibilityReason,
} from "@/lib/provider/marketplaceEligibilityReasons";
import { providerProfileSaveErrorKey } from "@/lib/provider/providerProfileSaveErrors";



export const Route = createFileRoute("/pro/profile")({ component: ProProfile });

// Real city/area options now come from the shared useServiceAreasSettings()
// source (also used by setup.tsx and pro.onboarding.tsx).

function ProProfile() {
  const { t } = useTranslation();
  const lang = useLang();
  const p = useMyProvider();
  const provider = p.data as any;
  const eligibilityQ = useMyMarketplaceEligibility(provider?.id);
  const update = useUpdateProvider();
  const services = useAllServices();
  const mine = useMyProviderServices(provider?.id);
  const toggle = useToggleProviderService();
  const setPrice = useSetProviderPrice();
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [priceErrors, setPriceErrors] = useState<Record<string, string>>({});
  const [expandedReqService, setExpandedReqService] = useState<string | null>(null);
  const [eligibilityExpanded, setEligibilityExpanded] = useState(false);
  const nav = useNavigate();
  const qc = useQueryClient();

  const dedupedReasons = useMemo(
    () =>
      dedupeEligibilityReasons(
        (eligibilityQ.data ?? []) as Array<{
          service_id: string;
          failure_reasons?: string[] | null;
        }>,
      ),
    [eligibilityQ.data],
  );


  const [bioEn, setBioEn] = useState("");
  const [bioAr, setBioAr] = useState("");
  const [years, setYears] = useState<number>(0);
  const [city, setCity] = useState("");
  const [uploading, setUploading] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const profileHydrated = useRef(false);
  const areasQ = useServiceAreasSettings();
  const cityOptions = (areasQ.data ?? []).filter((a) => a.enabled).map((a) => a.name);

  useEffect(() => {
    if (!provider || profileHydrated.current) return;
    setBioEn(provider.bio_en ?? "");
    setBioAr(provider.bio_ar ?? "");
    setYears(provider.years_experience ?? 0);
    setCity(provider.city ?? "");
    profileHydrated.current = true;
  }, [provider]);

  const onPickAvatar = async (file: File) => {
    try {
      setUploading(true);
      const objectUrl = URL.createObjectURL(file);
      setPhotoPreview((prev) => {
        if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
        return objectUrl;
      });
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("auth required");
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, file, { contentType: file.type, upsert: true });
      if (upErr) throw upErr;
      const { error: dbErr } = await supabase
        .from("profiles")
        .update({ avatar_url: path })
        .eq("id", user.id);
      if (dbErr) throw dbErr;
      await qc.invalidateQueries({ queryKey: ["my-provider"] });
      await qc.invalidateQueries({ queryKey: ["avatar-url"] });
    } catch (e: any) {
      toast.error(e?.message ?? t("pro.profile.uploadFailed"));
    } finally {
      setUploading(false);
    }
  };



  if (p.isLoading) {
    return <ProviderShell><div className="p-8 text-center text-sm">{t("pro.common.loading")}</div></ProviderShell>;
  }

  if (p.isError) {
    return (
      <ProviderShell>
        <QueryError onRetry={() => p.refetch()} />
      </ProviderShell>
    );
  }

  if (!provider) return <ProviderShell><div className="p-8 text-center text-sm">{t("pro.common.loading")}</div></ProviderShell>;

  const identityFieldsLocked = provider.onboarding_status === "APPROVED";

  const handleSave = () =>
    update.mutate(
      { bio_en: bioEn, bio_ar: bioAr, years_experience: years, city },
      {
        onError: (error: unknown) => {
          const message = error instanceof Error ? error.message : undefined;
          toast.error(t(providerProfileSaveErrorKey(message)));
        },
      },
    );

  const eligibilityRows = eligibilityQ.data ?? [];

  const myIds = new Set((mine.data ?? []).map((s: any) => s.service_id));
  const myStatus = new Map((mine.data ?? []).map((s: any) => [s.service_id, s.status]));
  const myPriceOverride = new Map((mine.data ?? []).map((s: any) => [s.service_id, s.price_override]));

  const submitPrice = (serviceId: string, min: number | null, max: number | null) => {
    const raw = priceDrafts[serviceId];
    if (raw === undefined) return;
    const trimmed = raw.trim();
    const value = trimmed === "" ? null : Number(trimmed);
    if (value !== null) {
      if (!Number.isFinite(value) || value < 0) {
        setPriceErrors((e) => ({ ...e, [serviceId]: t("pro.profile.priceInvalid", "Enter a valid price.") }));
        return;
      }
      if (min != null && value < min) {
        setPriceErrors((e) => ({ ...e, [serviceId]: t("pro.profile.priceBelowMin", { min }) }));
        return;
      }
      if (max != null && value > max) {
        setPriceErrors((e) => ({ ...e, [serviceId]: t("pro.profile.priceAboveMax", { max }) }));
        return;
      }
    }
    setPriceErrors((e) => ({ ...e, [serviceId]: "" }));
    setPrice.mutate(
      { providerId: provider.id, serviceId, price: value },
      { onError: (e: any) => setPriceErrors((errs) => ({ ...errs, [serviceId]: e?.message ?? t("common.somethingWentWrong") })) },
    );
  };
  const logout = async () => {
    await qc.cancelQueries(); qc.clear();
    await supabase.auth.signOut();
    nav({ to: customerPath("/login") as "/login", replace: true });
  };


  return (
    <ProviderShell>
      <ProviderPageHero
        title={t("pro.profile.title")}
        compact
        right={<LanguageToggle variant="hero" />}
      />
      <div className="min-w-0 space-y-5 overflow-x-hidden px-5 pb-28 pt-2">
        <Card className="flex items-center gap-3 rounded-[1.25rem] p-4">
          <div className="relative h-16 w-16 shrink-0">
            {photoPreview ? (
              <img src={photoPreview} alt="" className="h-16 w-16 rounded-2xl object-cover" />
            ) : (
              <Avatar
                src={provider?.profile?.avatar_url}
                alt=""
                className="h-16 w-16 rounded-2xl"
              />
            )}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              aria-label={t("pro.profile.changePhoto")}
              className="absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-full bg-brand text-white shadow-soft ring-2 ring-white active:scale-95 disabled:opacity-60"
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPickAvatar(f);
                e.target.value = "";
              }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="break-words text-base font-bold leading-snug">{provider.profile?.full_name || t("pro.profile.famioUser")}</div>
            <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
              {provider.is_verified ? <><ShieldCheck className="h-3 w-3 text-success" /> {t("pro.profile.verified")}</> : t("pro.profile.verificationPending")}
            </div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="mt-1 text-[11px] font-bold text-brand disabled:opacity-60"
            >
              {uploading ? t("pro.profile.uploading") : t("pro.profile.changePhoto")}
            </button>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-extrabold">{t("pro.profile.marketplaceEligible")}</div>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${eligibilityRows.some((row) => row.is_eligible) ? "bg-mint/20 text-success" : "bg-coral/10 text-coral"}`}
            >
              {eligibilityRows.some((row) => row.is_eligible)
                ? t("pro.profile.eligibilityYes")
                : t("pro.profile.eligibilityNo")}
            </span>
          </div>
          {eligibilityQ.isLoading ? (
            <div className="mt-2 h-10 animate-pulse rounded-xl bg-muted" />
          ) : eligibilityQ.isError ? (
            <div className="mt-2">
              <QueryError compact onRetry={() => eligibilityQ.refetch()} />
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              {dedupedReasons.length > 0 ? (
                <ul className="space-y-1.5 text-xs">
                  {dedupedReasons.map((entry) => (
                    <li key={entry.mapped.i18nKey}>
                      <EligibilityReasonItem
                        mapped={entry.mapped}
                        t={t}
                        onServiceFocus={(serviceId) => {
                          document
                            .getElementById(`service-${serviceId}`)
                            ?.scrollIntoView({ behavior: "smooth", block: "center" });
                        }}
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
              {eligibilityRows.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setEligibilityExpanded((v) => !v)}
                  className="flex w-full items-center justify-between rounded-xl border border-border/60 px-2 py-2 text-[11px] font-bold text-brand"
                >
                  {t("pro.profile.eligibilityByService")}
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${eligibilityExpanded ? "rotate-180" : ""}`}
                  />
                </button>
              ) : null}
              {eligibilityExpanded ? (
                <div className="space-y-2">
                  {eligibilityRows.map((row) => (
                    <div key={row.service_id} className="rounded-xl border border-border/60 p-2 text-xs">
                      <div className="break-words font-bold">
                        {lang === "ar" ? row.service_name_ar : row.service_name_en}
                      </div>
                      {row.is_eligible ? (
                        <div className="mt-1 text-success">{t("pro.profile.eligibilityServiceReady")}</div>
                      ) : (
                        <ul className="mt-1 space-y-1 text-coral">
                          {(row.failure_reasons ?? []).map((reason) => {
                            const mapped = mapMarketplaceEligibilityFailureReason(
                              reason,
                              row.service_id,
                            );
                            return (
                              <li key={reason}>
                                <EligibilityReasonItem
                                  mapped={mapped}
                                  t={t}
                                  onServiceFocus={(serviceId) => {
                                    document
                                      .getElementById(`service-${serviceId}`)
                                      ?.scrollIntoView({ behavior: "smooth", block: "center" });
                                  }}
                                />
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}
              {!eligibilityQ.isLoading && eligibilityRows.length === 0 ? (
                <div className="text-xs text-coral">{t("pro.profile.eligibilityBlockedByData")}</div>
              ) : null}
            </div>
          )}
        </Card>


        {/* About */}
        <div>
          <h2 className="mb-2 px-1 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">{t("pro.profile.about")}</h2>
          <Card className="space-y-3 p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={t("pro.profile.bioEn")}>
                <textarea
                  value={bioEn}
                  onChange={(e) => setBioEn(e.target.value)}
                  rows={3}
                  className="w-full rounded-xl border border-border bg-surface p-2 text-sm"
                />
              </Field>
              <Field label={t("pro.profile.bioAr")}>
                <textarea
                  value={bioAr}
                  onChange={(e) => setBioAr(e.target.value)}
                  rows={3}
                  dir="rtl"
                  className="w-full rounded-xl border border-border bg-surface p-2 text-sm"
                />
              </Field>
            </div>
            <Field label={t("pro.profile.yearsExperience")}>
              {identityFieldsLocked ? (
                <div className="rounded-xl border border-border/60 bg-surface-2 px-3 py-2 text-sm font-semibold">
                  {years}
                  <p className="mt-1 text-[11px] font-medium text-muted-foreground">
                    {t("pro.profile.verifiedFieldReviewNote")}
                  </p>
                </div>
              ) : (
                <input
                  type="number"
                  min={0}
                  value={years}
                  onChange={(e) => setYears(Number(e.target.value))}
                  className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm"
                />
              )}
            </Field>
            <Field label={t("pro.profile.cityLabel")}>
              {identityFieldsLocked ? (
                <div className="rounded-xl border border-border/60 bg-surface-2 px-3 py-2 text-sm font-semibold">
                  {city || t("pro.profile.cityUnset")}
                  <p className="mt-1 text-[11px] font-medium text-muted-foreground">
                    {t("pro.profile.verifiedFieldReviewNote")}
                  </p>
                </div>
              ) : areasQ.isError ? (
                <div className="mt-2">
                  <QueryError compact onRetry={() => areasQ.refetch()} />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {cityOptions.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCity(c)}
                      className={`h-10 truncate rounded-xl border px-2 text-xs font-semibold transition-all ${
                        city === c
                          ? "border-brand bg-brand/[0.04] text-brand"
                          : "border-border bg-surface text-muted-foreground"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}
            </Field>
            <PrimaryButton onClick={handleSave} disabled={update.isPending}>
              {update.isPending ? t("pro.common.saving") : t("pro.profile.saveChanges")}
            </PrimaryButton>
            {update.isSuccess && (
              <div className="text-center text-xs font-semibold text-success">{t("pro.common.saved")}</div>
            )}
          </Card>
        </div>

        {/* Services */}
        <div>
          <h2 className="mb-2 px-1 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">{t("pro.profile.servicesOffer")}</h2>
          {services.isError || mine.isError ? (
            <QueryError compact onRetry={() => { void services.refetch(); void mine.refetch(); }} />
          ) : (
          <Card className="divide-y divide-border">
            {(services.data ?? []).map((s: any) => {
              const on = myIds.has(s.id);
              const sname = lang === "ar" ? (s.name_ar ?? s.name_en) : (s.name_en ?? s.name_ar);
              const cname = lang === "ar" ? (s.category?.name_ar ?? s.category?.name_en) : (s.category?.name_en ?? s.category?.name_ar);
              const currentOverride = myPriceOverride.get(s.id);
              const priceError = priceErrors[s.id];
              return (
                <div key={s.id} id={`service-${s.id}`} className="px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-1.5">
                        <div className="break-words text-sm font-semibold leading-snug">{sname}</div>
                        {on && myStatus.get(s.id) === "pending" && (
                          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">{t("pro.profile.servicePending")}</span>
                        )}
                        {on && myStatus.get(s.id) === "rejected" && (
                          <span className="shrink-0 rounded-full bg-coral/15 px-2 py-0.5 text-[10px] font-bold text-coral">{t("pro.profile.serviceRejected")}</span>
                        )}
                      </div>
                      <div className="break-words text-[11px] text-muted-foreground">{cname}</div>
                    </div>
                    <button
                      onClick={() => toggle.mutate({ providerId: provider.id, serviceId: s.id, on: !on })}
                      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${on ? "bg-brand" : "bg-muted"}`}
                      aria-pressed={on}
                    >
                      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-soft transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
                    </button>
                  </div>

                  {on && s.provider_pricing_allowed && (
                    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        placeholder={t("pro.profile.pricePlaceholder", "Your price (EGP/hr)")}
                        value={priceDrafts[s.id] ?? (currentOverride != null ? String(currentOverride) : "")}
                        onChange={(e) => setPriceDrafts((d) => ({ ...d, [s.id]: e.target.value }))}
                        className="h-9 w-40 rounded-lg border border-border bg-surface px-2 text-xs"
                      />
                      <button
                        onClick={() => submitPrice(s.id, s.minimum_price ?? null, s.maximum_price ?? null)}
                        disabled={setPrice.isPending}
                        className="rounded-lg bg-brand px-3 py-1.5 text-[11px] font-bold text-brand-foreground disabled:opacity-50"
                      >
                        {t("common.save")}
                      </button>
                      {(s.minimum_price != null || s.maximum_price != null) && (
                        <span className="text-[10px] text-muted-foreground">
                          {t("pro.profile.priceRange", { min: s.minimum_price ?? "—", max: s.maximum_price ?? "—" })}
                        </span>
                      )}
                    </div>
                  )}
                  {priceError && <p className="mt-1 text-[11px] font-semibold text-coral">{priceError}</p>}
                  {on && (
                    <button
                      onClick={() => setExpandedReqService(expandedReqService === s.id ? null : s.id)}
                      className="mt-2 text-[11px] font-bold text-brand"
                    >
                      {expandedReqService === s.id ? t("pro.profile.hideRequirements", "Hide requirements") : t("pro.profile.showRequirements", "Requirements")}
                    </button>
                  )}
                  {on && expandedReqService === s.id && <RequirementsChecklist providerId={provider.id} serviceId={s.id} />}
                </div>
              );
            })}
          </Card>
          )}
        </div>

        {provider?.id ? (
          <div>
            <TeachingCapabilitiesEditor
              providerId={provider.id}
              services={(services.data ?? [])
                .filter((s: any) => isTutoringCategorySlug(s.category?.slug) && myIds.has(s.id))
                .map((s: any) => ({
                  id: s.id,
                  name_en: s.name_en,
                  name_ar: s.name_ar,
                  allowed_session_durations: s.allowed_session_durations,
                  minimum_price: s.minimum_price,
                  maximum_price: s.maximum_price,
                }))}
            />
          </div>
        ) : null}

        {/* Links */}
        <div>
          <h2 className="mb-2 px-1 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">{t("pro.profile.more")}</h2>
          <Card className="divide-y divide-border">
            <ProRow to={proPath("/pro/documents")} icon={<FileText className="h-5 w-5" />} label={t("pro.profile.documentsRow")} />
            <ProRow to={proPath("/pro/notification-preferences")} icon={<Bell className="h-5 w-5" />} label={t("notifPrefs.title")} />
          </Card>
        </div>

        <button onClick={logout} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-surface py-4 text-sm font-bold text-destructive shadow-soft">
          <LogOut className="h-4 w-4" /> {t("pro.profile.signOut")}
        </button>
      </div>
    </ProviderShell>
  );
}


const REQ_STATUS_TONE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  passed: "bg-mint/20 text-success",
  failed: "bg-coral/10 text-coral",
  waived: "bg-muted text-muted-foreground",
};

function RequirementsChecklist({ providerId, serviceId }: { providerId: string; serviceId: string }) {
  const { t } = useTranslation();
  const reqQ = useRequirementsForService(serviceId);
  const mineQ = useMyRequirementFulfillments(providerId);
  const declare = useDeclareRequirement();
  const upload = useUploadRequirementEvidence();
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});

  const requirements = reqQ.data ?? [];
  const mineByReq = new Map((mineQ.data ?? []).map((f: any) => [f.requirement_id, f]));

  if (requirements.length === 0) return <p className="mt-2 text-[11px] text-muted-foreground">{t("pro.profile.noRequirements", "No requirements for this service.")}</p>;

  return (
    <ul className="mt-2 space-y-2">
      {requirements.map((r: any) => {
        const mine = mineByReq.get(r.id);
        const status = mine?.status ?? "pending";
        return (
          <li key={r.id} className="rounded-xl border border-border/60 p-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 text-xs">
                <span className="font-semibold">{r.name_en}</span>
                {r.required_for_provider_approval && <span className="ms-1 text-[10px] text-coral">*</span>}
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${REQ_STATUS_TONE[status]}`}>{status}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <input
                value={notesDraft[r.id] ?? mine?.notes ?? ""}
                onChange={(e) => setNotesDraft((d) => ({ ...d, [r.id]: e.target.value }))}
                placeholder={t("pro.profile.reqNotesPlaceholder", "Notes (optional)")}
                className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 text-[11px]"
              />
              <button
                onClick={() => declare.mutate({ providerId, requirementId: r.id, notes: notesDraft[r.id] })}
                disabled={declare.isPending}
                className="rounded-lg bg-brand px-2 py-1.5 text-[11px] font-bold text-brand-foreground disabled:opacity-50"
              >{t("common.save")}</button>
              {r.evidence_required && (
                <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-[11px] font-semibold">
                  <Upload className="h-3 w-3" /> {mine?.evidence_storage_path ? t("pro.profile.reevidence", "Re-upload") : t("pro.profile.uploadEvidence", "Upload evidence")}
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) upload.mutate({ providerId, requirementId: r.id, file: f }, { onError: (e2: any) => toast.error(e2?.message ?? "Upload failed") });
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function EligibilityReasonItem({
  mapped,
  t,
  onServiceFocus,
}: {
  mapped: MappedEligibilityReason;
  t: (key: string, options?: Record<string, unknown>) => string;
  onServiceFocus: (serviceId: string) => void;
}) {
  const label = t(mapped.i18nKey);
  if (mapped.action.kind === "link") {
    return (
      <Link
        to={proPath(mapped.action.path) as any}
        className="font-semibold text-brand underline-offset-2 hover:underline"
      >
        {label}
      </Link>
    );
  }
  if (mapped.action.kind === "service") {
    const serviceId = mapped.action.serviceId;
    return (
      <button
        type="button"
        className="font-semibold text-brand underline-offset-2 hover:underline"
        onClick={() => onServiceFocus(serviceId)}
      >
        {label}
      </button>
    );
  }
  return <span className="font-semibold">{label}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>{children}</label>;
}

function ProRow({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link to={to as any} className="flex items-center gap-3 px-4 py-3.5 active:bg-surface-2">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand/10 text-brand">{icon}</div>
      <div className="flex-1 text-sm font-bold">{label}</div>
    </Link>
  );
}
