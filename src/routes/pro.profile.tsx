import { ProfileWorkZones } from "@/components/provider/ProfileWorkZones";
import { AutoGrowingBio } from "@/components/provider/AutoGrowingBio";
import { profilePriceDirty } from "@/lib/provider/profilePriceDirty";
import { ProfileAvatar } from "@/components/provider/ProfileAvatar";
import { workingHoursSummary } from "@/lib/provider/workingHoursSummary";
import { isFixedPackage, packageLabel, servicePriceUnit } from "@/lib/pricing/servicePackages";
import {
  ServicePricePicker,
  isPriceInRange,
  isSavedPriceOutOfRange,
} from "@/components/provider/ServicePricePicker";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ProviderShell } from "@/components/famio/ProviderShell";
import { CheckChip } from "@/components/famio/CheckChip";
import { ServiceCard } from "@/components/famio/ServiceCard";
import { TeachingGroupsSummary } from "@/components/provider/TeachingGroupsSummary";
import { useMyTeachingCapabilities } from "@/lib/db/teaching-queries";
import { saveProfileChanges, type ProfileFields } from "@/lib/provider/saveProfileChanges";
import "@/components/famio/providerApply.css";
import { Card, PrimaryButton } from "@/components/famio/ui";
import { QueryError } from "@/components/famio/QueryError";
import { supabase } from "@/integrations/supabase/client";

import {
  useMyProvider,
  useAllServices,
  useMyProviderServices,
  useToggleProviderService,
  useCancelProviderServiceRequest,
  useSetProviderPrice,
  useRequirementsForService,
  useMyRequirementFulfillments,
  useDeclareRequirement,
  useUploadRequirementEvidence,
  useMyMarketplaceEligibility,
  useMyProviderZones,
  useProviderAvailability,
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
  LockKeyhole,
  Clock,
  BriefcaseBusiness,
} from "lucide-react";
import { LanguageToggle, useLang } from "@/components/famio/LanguageToggle";
import { customerPath } from "@/lib/preview/previewPath";
import { useProPath } from "@/lib/provider/useProPath";

import { isTutoringCategorySlug } from "@/lib/tutoring/teachingCapabilities";
import {
  dedupeEligibilityReasons,
  mapMarketplaceEligibilityFailureReason,
  marketplaceEligibilityStatus,
  type MappedEligibilityReason,
} from "@/lib/provider/marketplaceEligibilityReasons";
import { providerProfileSaveErrorKey } from "@/lib/provider/providerProfileSaveErrors";

export const Route = createFileRoute("/pro/profile")({ component: ProProfile });

// Real city/area options now come from the shared useServiceAreasSettings()
// source (also used by setup.tsx and pro.onboarding.tsx).

function ProProfile() {
  const proPath = useProPath();
  const { t } = useTranslation();
  const lang = useLang();
  const p = useMyProvider();
  const provider = p.data as any;
  const teachingQ = useMyTeachingCapabilities(provider?.id);
  const hoursQ = useProviderAvailability(provider?.id);
  const eligibilityQ = useMyMarketplaceEligibility(provider?.id);
  const providerZonesQ = useMyProviderZones(provider?.id);
  const services = useAllServices();
  const mine = useMyProviderServices(provider?.id);
  const toggle = useToggleProviderService();
  const cancelRequest = useCancelProviderServiceRequest();
  const setPrice = useSetProviderPrice();
  const [priceDrafts, setPriceDrafts] = useState<Record<string, number>>({});
  const [priceErrors, setPriceErrors] = useState<Record<string, string>>({});
  const [expandedReqService, setExpandedReqService] = useState<string | null>(null);
  const focusRequirements = (serviceId: string) => {
    setExpandedReqService(serviceId);
    window.history.replaceState(null, "", `#requirements-${serviceId}`);
    document.getElementById(`service-${serviceId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const focusPrice = (serviceId: string) => {
    const id = `price-${serviceId}`;
    window.history.replaceState(null, "", `#${id}`);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const [eligibilityExpanded, setEligibilityExpanded] = useState(false);
  const nav = useNavigate();
  const qc = useQueryClient();
  const update = useMutation({
    mutationFn: (edits: ProfileFields) => saveProfileChanges(provider, edits, {
      snapshot: async () => {
        const { data, error } = await supabase.rpc("provider_onboarding_snapshot");
        if (error) throw error;
        return data as { provider?: ProfileFields; details?: { previous_work?: string | null } };
      },
      section: async (section, payload) => {
        const { error } = await supabase.rpc("provider_save_onboarding_section", { p_section: section, p_payload: payload as any });
        if (error) throw error;
      },
      update: async (patch) => {
        const { error } = await supabase.from("providers").update(patch).eq("id", provider.id);
        if (error) throw error;
      },
    }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["my-provider"] });
      await qc.invalidateQueries({ queryKey: ["provider-onboarding-snapshot"] });
    },
  });

  const pendingTeachingServices = useMemo(() => new Set((teachingQ.data ?? []).filter((row) => {
    const service = services.data?.find((s) => s.id === row.service_id);
    return row.status === "pending" && service && isPriceInRange(row.session_price, service.minimum_price, service.maximum_price);
  }).map((row) => row.service_id)), [teachingQ.data, services.data]);

  const dedupedReasons = useMemo(
    () =>
      dedupeEligibilityReasons(
        (eligibilityQ.data ?? []) as Array<{
          service_id: string;
          failure_reasons?: string[] | null;
        }>,
        providerZonesQ.data?.length ?? 0,
        pendingTeachingServices,
      ),
    [eligibilityQ.data, providerZonesQ.data, pendingTeachingServices],
  );

  const [bioEn, setBioEn] = useState("");
  const [bioAr, setBioAr] = useState("");
  const [years, setYears] = useState<number>(0);
  const [city, setCity] = useState("");
  const [uploading, setUploading] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const profileHydrated = useRef(false);

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
      const {
        data: { user },
      } = await supabase.auth.getUser();
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
    return (
      <ProviderShell>
        <div className="p-8 text-center text-sm">{t("pro.common.loading")}</div>
      </ProviderShell>
    );
  }

  if (p.isError) {
    return (
      <ProviderShell>
        <QueryError onRetry={() => p.refetch()} />
      </ProviderShell>
    );
  }

  if (!provider)
    return (
      <ProviderShell>
        <div className="p-8 text-center text-sm">{t("pro.common.loading")}</div>
      </ProviderShell>
    );

  const handleSave = () =>
    update.mutate(
      { [lang === "ar" ? "bio_ar" : "bio_en"]: lang === "ar" ? bioAr : bioEn },
      {
        onError: (error: unknown) => {
          const message = error && typeof error === "object" && "message" in error ? String(error.message) : undefined;
          toast.error(t(providerProfileSaveErrorKey(message)));
        },
      },
    );

  const eligibilityRows = eligibilityQ.data ?? [];
  const eligibilityStatus = marketplaceEligibilityStatus(
    eligibilityRows,
    providerZonesQ.data?.length ?? 0,
    pendingTeachingServices,
  );

  const myIds = new Set((mine.data ?? []).map((s: any) => s.service_id));
  const myStatus = new Map((mine.data ?? []).map((s: any) => [s.service_id, s.status]));
  const myRejectionReason = new Map(
    (mine.data ?? []).map((s: any) => [s.service_id, s.rejection_reason as string | null]),
  );
  const myPriceOverride = new Map(
    (mine.data ?? []).map((s: any) => [s.service_id, s.price_override]),
  );
  const isApprovedProvider = provider.onboarding_status === "APPROVED";
  const allCatalogServices = services.data ?? [];
  const profileServices = isApprovedProvider
    ? allCatalogServices.filter((s: { id: string }) => myIds.has(s.id))
    : allCatalogServices;
  const addableServices = isApprovedProvider
    ? allCatalogServices.filter((s: { id: string }) => !myIds.has(s.id))
    : [];

  const handleServiceToggle = (serviceId: string, currentlyOn: boolean) => {
    if (isApprovedProvider) return;
    toggle.mutate(
      { providerId: provider.id, serviceId, on: !currentlyOn },
      {
        onError: () => toast.error(t("common.somethingWentWrong")),
      },
    );
  };
  const resubmitService = useMutation({
    mutationFn: async (serviceId: string) => {
      const { error } = await supabase.rpc("provider_resubmit_rejected_service", {
        p_service_id: serviceId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["my-provider-services", provider.id] });
      void qc.invalidateQueries({ queryKey: ["provider-marketplace-eligibility", provider.id] });
    },
  });
  const removeRejectedService = useMutation({
    mutationFn: async (serviceId: string) => {
      const { error } = await supabase.rpc("provider_remove_onboarding_service", {
        p_service_id: serviceId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["my-provider-services", provider.id] });
      void qc.invalidateQueries({ queryKey: ["provider-marketplace-eligibility", provider.id] });
    },
  });

  const submitPrice = (serviceId: string, min: number | null, max: number | null) => {
    const value = priceDrafts[serviceId];
    if (!isPriceInRange(value, min, max)) return;
    setPriceErrors((e) => ({ ...e, [serviceId]: "" }));
    setPrice.mutate(
      { providerId: provider.id, serviceId, price: value },
      {
        onError: (e: any) =>
          setPriceErrors((errs) => ({
            ...errs,
            [serviceId]: e?.message ?? t("common.somethingWentWrong"),
          })),
      },
    );
  };
  const logout = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    nav({ to: customerPath("/login") as "/login", replace: true });
  };

  return (
    <ProviderShell>
      <main className="apply-ui apply-screen !pb-28" dir={lang === "ar" ? "rtl" : "ltr"}>
        <header className="apply-header apply-profile-title"><h1 className="apply-title">{t("pro.profile.title")}</h1><LanguageToggle /></header>
        <div className="apply-content">
        <Card className="apply-list apply-profile-header p-4">
          <div className="apply-profile-avatar-wrap">
            <ProfileAvatar src={provider?.profile?.avatar_url} preview={photoPreview} name={provider.profile?.full_name || t("pro.profile.famioUser")} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              aria-label={t("pro.profile.changePhoto")}
              className="absolute bottom-0 start-0 grid h-11 w-11 place-items-center disabled:opacity-60"
            >
              <span className="apply-profile-camera pointer-events-none" aria-hidden="true">
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Camera className="h-3.5 w-3.5" />
              )}
              </span>
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
          <div className="apply-profile-info">
            <div className="apply-profile-name break-words leading-snug">
              {provider.profile?.full_name || t("pro.profile.famioUser")}
            </div>
            <div className={`apply-tag apply-profile-verified mt-2 ${provider.is_verified ? "apply-success" : "apply-wait"}`}>
              {provider.is_verified ? (
                <>
                  <ShieldCheck className="h-3 w-3 text-success" /> {t("pro.profile.verified")}
                </>
              ) : (
                t("pro.profile.verificationPending")
              )}
            </div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="mt-1 block text-pro-12 font-bold text-brand disabled:opacity-60"
            >
              {uploading ? t("pro.profile.uploading") : t("pro.profile.changePhoto")}
            </button>
          </div>
        </Card>

        <Card className="apply-list p-4">
          <div>
            <div className="text-sm font-extrabold">{t("providerProfileV3.visibility")}</div>
            {eligibilityQ.isSuccess && providerZonesQ.isSuccess && eligibilityRows.length > 0 ? (
              <p
                className={`mt-1 text-xs font-bold ${eligibilityStatus.visible ? "text-success" : "text-amber-700"}`}
              >
                {t(eligibilityStatus.visible ? "providerProfileV3.visible" : "providerProfileV3.hidden")}
                {!eligibilityStatus.visible && eligibilityStatus.stepsLeft > 0 && <span> · {t("providerProfileV3.steps", { count: eligibilityStatus.stepsLeft })}</span>}
              </p>
            ) : null}
          </div>
          {eligibilityQ.isSuccess && providerZonesQ.isSuccess && eligibilityRows.some((row) => !row.is_eligible) && (
            <div className="mt-2 space-y-1 text-xs">
              {eligibilityRows.some((row) => row.is_eligible) && <p>{t("providerProfileV3.visibleServices", { services: eligibilityRows.filter((row) => row.is_eligible).map((row) => lang === "ar" ? row.service_name_ar : row.service_name_en).join("، ") })}</p>}
              <p>{t("providerProfileV3.blockedServices", { services: eligibilityRows.filter((row) => !row.is_eligible).map((row) => lang === "ar" ? row.service_name_ar : row.service_name_en).join("، ") })}</p>
            </div>
          )}
          {eligibilityQ.isLoading || providerZonesQ.isLoading ? (
            <div className="mt-2 h-10 animate-pulse rounded-xl bg-muted" />
          ) : eligibilityQ.isError || providerZonesQ.isError ? (
            <div className="mt-2">
              <QueryError
                compact
                onRetry={() => {
                  eligibilityQ.refetch();
                  providerZonesQ.refetch();
                }}
              />
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              {(["provider", "famy"] as const).map((owner) => {
                const entries = dedupedReasons.filter((entry) => entry.mapped.owner === owner);
                if (!entries.length) return null;
                return <section key={owner} className="apply-list">
                  <h3 className="apply-label px-4 pt-4">{t(`providerProfileV3.${owner}Tasks`)}</h3>
                  {owner === "famy" && <p className="px-4 text-sm text-muted-foreground">{t("providerProfileV3.reviewHint")}</p>}
                  <ul>{entries.map((entry) => {
                    const services = eligibilityRows.filter((row) => entry.serviceIds.includes(row.service_id));
                    const action = entry.mapped.action;
                    // Service-specific actions each retain their own full-row target.
                    const targets = action.kind === "service" || action.kind === "requirements"
                      ? services.map((row) => ({ mapped: { ...entry.mapped, action: { ...action, serviceId: row.service_id } }, services: [row] }))
                      : [{ mapped: entry.mapped, services }];
                    return <li key={entry.mapped.i18nKey}>{targets.map((target) => (
                      <EligibilityReasonItem key={target.services[0]?.service_id ?? entry.mapped.i18nKey} mapped={target.mapped} t={t} onServiceFocus={focusPrice} onRequirementsFocus={focusRequirements}
                        serviceNames={target.services.map((row) => lang === "ar" ? row.service_name_ar : row.service_name_en)} />
                    ))}</li>;
                  })}</ul>
                </section>;
              })}
              {eligibilityRows.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setEligibilityExpanded((v) => !v)}
                  aria-expanded={eligibilityExpanded}
                  className="flex w-full items-center justify-between rounded-xl border border-border/60 px-2 py-2 text-pro-12 font-bold text-brand"
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
                    <div
                      key={row.service_id}
                      className="rounded-xl border border-border/60 p-2 text-xs"
                    >
                      <div className="break-words font-bold">
                        {lang === "ar" ? row.service_name_ar : row.service_name_en}
                      </div>
                      {row.is_eligible ? (
                        <div className="mt-1 text-success">
                          {t("pro.profile.eligibilityServiceReady")}
                        </div>
                      ) : (
                        <ul className="mt-1 space-y-1 text-coral">
                          {(row.failure_reasons ?? []).map((reason) => {
                            const mapped = mapMarketplaceEligibilityFailureReason(
                              reason,
                              row.service_id,
                              providerZonesQ.data?.length ?? 0,
                              pendingTeachingServices.has(row.service_id),
                            );
                            return (
                              <li key={reason}>
                                <EligibilityReasonItem
                                  mapped={mapped}
                                  t={t}
                                  onServiceFocus={focusPrice} onRequirementsFocus={focusRequirements}
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
                <div className="text-xs text-coral">
                  {t("pro.profile.eligibilityBlockedByData")}
                </div>
              ) : null}
            </div>
          )}
        </Card>

        {/* About */}
        <div>
          <h2 className="mb-2 px-1 text-pro-13 font-bold text-muted-foreground">
            {t("pro.profile.about")}
          </h2>
          <Card className="apply-list space-y-3 p-4">
            <label>
              <span className="apply-label">{t("providerApply.about")}</span>
              <AutoGrowingBio value={lang === "ar" ? bioAr : bioEn} onChange={lang === "ar" ? setBioAr : setBioEn} />
            </label>
            <p className="apply-label">{t("providerSetup.phrases")}</p>
            <div className="flex flex-wrap gap-2">{[0, 1, 2, 3, 4].map((index) => <CheckChip key={index} selected={false} onClick={() => (lang === "ar" ? setBioAr : setBioEn)((value) => [value.trim(), t(`providerSetup.bioPhrases.p${index}`)].filter(Boolean).join(" "))}>{t(`providerSetup.bioPhrases.p${index}`)}</CheckChip>)}</div>
            <dl className="apply-list">
              <div className="apply-li"><dt className="flex-1">{t("pro.profile.yearsExperience")}</dt><dd>{years}</dd><LockKeyhole size={16} aria-hidden="true" /></div>
              <div className="apply-li"><dt className="flex-1 font-bold">{t("providerLocations.livesIn")}</dt><dd>{city ? t(`providerSetup.governorates.${city.trim().toLowerCase().replace(/\s+/g, "_")}`, { defaultValue: city }) : t("pro.profile.cityUnset")}</dd><LockKeyhole size={16} aria-hidden="true" /></div>
              <ProfileWorkZones providerId={provider.id} applicationEditable={["DRAFT", "NEEDS_CHANGES"].includes(provider.onboarding_status)} />
            </dl>
            <PrimaryButton className="apply-cta" onClick={handleSave} disabled={update.isPending}>
              {update.isPending ? t("pro.common.saving") : t("pro.profile.saveChanges")}
            </PrimaryButton>
            {update.isSuccess && (
              <div className="text-center text-xs font-semibold text-success">
                {t("pro.common.saved")}
              </div>
            )}
          </Card>
        </div>

        {/* Services */}
        <div>
          <h2 className="mb-2 px-1 text-pro-13 font-bold text-muted-foreground">
            {t("providerProfileV3.services")}
          </h2>
          {services.isError || mine.isError ? (
            <QueryError
              compact
              onRetry={() => {
                void services.refetch();
                void mine.refetch();
              }}
            />
          ) : (
            <div id="requirements" className="grid gap-3 scroll-mt-4">
              {profileServices.map((s: any) => {
                const on = myIds.has(s.id);
                const sname = lang === "ar" ? (s.name_ar ?? s.name_en) : (s.name_en ?? s.name_ar);
                const cname =
                  lang === "ar"
                    ? (s.category?.name_ar ?? s.category?.name_en)
                    : (s.category?.name_en ?? s.category?.name_ar);
                const currentOverride = myPriceOverride.get(s.id);
                const priceError = priceErrors[s.id];
                return (
                  <div key={s.id} id={`service-${s.id}`}>
                    <ServiceCard selected={on} title={sname} subtitle={isFixedPackage(s) ? t(packageLabel(s).key, packageLabel(s).values) : cname ?? ""} icon={<BriefcaseBusiness size={20} />} onClick={isApprovedProvider ? () => {} : () => handleServiceToggle(s.id, on)} disabled={isApprovedProvider}>
                      <div className="px-4 pb-4">
                      {on && (
                        <span
                          className={`apply-tag ${myStatus.get(s.id) === "approved" ? "apply-success" : myStatus.get(s.id) === "pending" ? "apply-wait" : "apply-danger"}`}
                        >
                          {isApprovedProvider && !on && myStatus.get(s.id) == null
                            ? t("pro.serviceRequest.notAdded")
                            : t(
                                myStatus.get(s.id) === "approved"
                                  ? "pro.serviceRequest.statusActive"
                                  : myStatus.get(s.id) === "pending"
                                    ? "pro.serviceRequest.statusPending"
                                    : myStatus.get(s.id) === "rejected"
                                      ? "pro.serviceRequest.statusRejected"
                                      : `providerSetup.status.${myStatus.get(s.id) ?? "pending"}`,
                              )}
                        </span>
                      )}
                      {on && isApprovedProvider && myStatus.get(s.id) === "pending" && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          {t("pro.serviceRequest.pendingReadOnly")}
                        </p>
                      )}
                      {on && isApprovedProvider && myStatus.get(s.id) === "pending" && (
                        <button
                          type="button"
                          className="mt-2 min-h-11 rounded-lg border border-coral px-3 text-xs font-bold text-coral disabled:opacity-50"
                          disabled={cancelRequest.isPending}
                          onClick={() =>
                            cancelRequest.mutate(s.id, {
                              onSuccess: () => toast.success(t("pro.serviceRequest.cancelled")),
                              onError: () => toast.error(t("common.somethingWentWrong")),
                            })
                          }
                        >
                          {t("pro.serviceRequest.cancelRequest")}
                        </button>
                      )}
                    {on && myStatus.get(s.id) === "rejected" && myRejectionReason.get(s.id) && (
                      <p className="mt-2 text-xs font-semibold text-destructive">
                        {myRejectionReason.get(s.id)}
                      </p>
                    )}
                    {on && myStatus.get(s.id) === "rejected" && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {isApprovedProvider ? (
                          <Link
                            to={proPath("/pro/request-service/$serviceId")}
                            params={{ serviceId: s.id }}
                            className="min-h-11 rounded-lg border border-brand px-3 text-xs font-bold text-brand inline-flex items-center"
                          >
                            {t("pro.serviceRequest.editAndResubmit")}
                          </Link>
                        ) : (
                          <button
                            type="button"
                            className="min-h-11 rounded-lg border border-brand px-3 text-xs font-bold text-brand disabled:opacity-50"
                            disabled={resubmitService.isPending}
                            onClick={() =>
                              resubmitService.mutate(s.id, {
                                onSuccess: () => toast.success(t("pro.profile.serviceResubmitted")),
                                onError: () => toast.error(t("common.somethingWentWrong")),
                              })
                            }
                          >
                            {t("pro.profile.resubmitService")}
                          </button>
                        )}
                        <button
                          type="button"
                          className="min-h-11 rounded-lg border border-coral px-3 text-xs font-bold text-coral disabled:opacity-50"
                          disabled={removeRejectedService.isPending}
                          onClick={() =>
                            removeRejectedService.mutate(s.id, {
                              onSuccess: () => toast.success(t("pro.profile.serviceRemoved")),
                              onError: () => toast.error(t("common.somethingWentWrong")),
                            })
                          }
                        >
                          {t("pro.profile.removeService")}
                        </button>
                      </div>
                    )}
                    {on &&
                      s.provider_pricing_allowed &&
                      !isTutoringCategorySlug(s.category?.slug) && (
                        <div id={`price-${s.id}`} className="mt-2 min-w-0 scroll-mt-4 space-y-2">
                          {isSavedPriceOutOfRange(
                            currentOverride,
                            s.minimum_price ?? null,
                            s.maximum_price ?? null,
                          ) && (
                            <p className="rounded-xl bg-amber-100 p-2 text-xs font-semibold text-amber-800">
                              {t("pricePicker.outOfRange")}
                            </p>
                          )}
                          <ServicePricePicker
                            min={s.minimum_price ?? null}
                            max={s.maximum_price ?? null}
                            value={priceDrafts[s.id] ?? currentOverride ?? null}
                            onChange={(price) =>
                              setPriceDrafts((drafts) => ({ ...drafts, [s.id]: price }))
                            }
                            unitLabel={t(servicePriceUnit(s).key, servicePriceUnit(s).values)}
                          />
                          {profilePriceDirty(priceDrafts[s.id], currentOverride) && <button
                            onClick={() =>
                              submitPrice(s.id, s.minimum_price ?? null, s.maximum_price ?? null)
                            }
                            disabled={
                              setPrice.isPending ||
                              !isPriceInRange(
                                priceDrafts[s.id],
                                s.minimum_price ?? null,
                                s.maximum_price ?? null,
                              )
                            }
                            className="min-h-11 rounded-lg bg-brand px-3 py-2 text-xs font-bold text-brand-foreground disabled:opacity-50"
                          >
                            {t("common.save")}
                          </button>}
                        </div>
                      )}
                    {priceError && (
                      <p className="mt-1 text-pro-12 font-semibold text-coral">{priceError}</p>
                    )}
                    {on && (
                      <button
                        onClick={() =>
                          setExpandedReqService(expandedReqService === s.id ? null : s.id)
                        }
                        aria-expanded={expandedReqService === s.id}
                        aria-controls={`requirements-${s.id}`}
                        className="mt-2 flex min-h-11 w-full items-center justify-between gap-3 border-t border-border py-3 text-start text-pro-13 font-bold text-brand"
                      >
                        {t("providerProfilePolish.requirements")}
                        <ChevronDown size={18} aria-hidden="true" className={expandedReqService === s.id ? "rotate-180" : ""} />
                      </button>
                    )}
                    {on && expandedReqService === s.id && (
                      <div id={`requirements-${s.id}`}><RequirementsChecklist providerId={provider.id} serviceId={s.id} /></div>
                    )}
                    {on &&
                      isTutoringCategorySlug(s.category?.slug) &&
                      myStatus.get(s.id) === "approved" && (
                        <Link
                          to={proPath("/pro/setup/subjects")}
                          className="mt-2 inline-block text-xs font-bold text-brand underline-offset-2 hover:underline"
                        >
                          {t("pro.profile.addSubjectsForService")}
                        </Link>
                      )}
                      </div>
                    </ServiceCard>
                  </div>
                );
              })}
            </div>
          )}
          {isApprovedProvider && !services.isError && !mine.isError ? (
            <div className="mt-4">
              <h3 className="px-1 text-pro-13 font-bold text-foreground">
                {t("pro.profile.addNewService")}
              </h3>
              <p className="mt-1 px-1 text-xs text-muted-foreground">
                {t("pro.profile.addNewServiceHint")}
              </p>
              {addableServices.length === 0 ? (
                <p className="mt-2 px-1 text-xs text-muted-foreground">
                  {t("pro.profile.allServicesOnProfile")}
                </p>
              ) : (
                <div className="mt-3 grid gap-3">
                  {addableServices.map((s: any) => {
                    const sname =
                      lang === "ar" ? (s.name_ar ?? s.name_en) : (s.name_en ?? s.name_ar);
                    const cname =
                      lang === "ar"
                        ? (s.category?.name_ar ?? s.category?.name_en)
                        : (s.category?.name_en ?? s.category?.name_ar);
                    return (
                      <div key={s.id} className="rounded-2xl border border-border bg-surface p-4">
                        <ServiceCard
                          selected={false}
                          title={sname}
                          subtitle={
                            isFixedPackage(s)
                              ? t(packageLabel(s).key, packageLabel(s).values)
                              : (cname ?? "")
                          }
                          icon={<BriefcaseBusiness size={20} />}
                          onClick={() => {}}
                          disabled
                        />
                        <p className="mt-1 px-4 text-xs text-muted-foreground">
                          {t("pro.serviceRequest.notAdded")}
                        </p>
                        <div className="px-4 pb-2">
                          <Link
                            to={proPath("/pro/request-service/$serviceId")}
                            params={{ serviceId: s.id }}
                            className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-brand px-3 text-xs font-bold text-brand-foreground"
                          >
                            {t("pro.serviceRequest.requestCta")}
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}
        </div>

        {teachingQ.isError ? (
          <QueryError compact onRetry={() => teachingQ.refetch()} />
        ) : (
          <TeachingGroupsSummary
            rows={teachingQ.data ?? []}
            serviceStatuses={Object.fromEntries(
              (mine.data ?? []).map((row: { service_id: string; status: string }) => [
                row.service_id,
                row.status,
              ]),
            )}
          />
        )}
        <section className="apply-list">
          <ProRow to={proPath("/pro/setup/hours")} icon={<Clock size={20} />} label={t("providerProfileV3.hours")} />
          {hoursQ.isError ? <QueryError compact onRetry={() => hoursQ.refetch()} /> : <div className="px-4 pb-4 text-sm text-muted-foreground">{(hoursQ.data ?? []).length ? workingHoursSummary(hoursQ.data ?? [], t).map((line) => <p key={line}>{line}</p>) : t("providerProfileV3.noHours")}</div>}
        </section>

        {/* Links */}
        <div>
          <h2 className="mb-2 px-1 text-pro-13 font-bold text-muted-foreground">
            {t("pro.profile.more")}
          </h2>
          <Card className="apply-list">
            <ProRow
              to={proPath("/pro/documents")}
              icon={<FileText className="h-5 w-5" />}
              label={t("pro.profile.documentsRow")}
            />
            <ProRow
              to={proPath("/pro/notification-preferences")}
              icon={<Bell className="h-5 w-5" />}
              label={t("notifPrefs.title")}
            />
          </Card>
        </div>

        <button
          onClick={logout}
          className="apply-li w-full text-destructive"
        >
          <LogOut className="h-4 w-4" /> {t("pro.profile.signOut")}
        </button>
        <Link
          to={proPath("/pro/account/delete")}
          className="apply-li w-full text-destructive"
        >
          {t("accountDeletion.menuLabel")}
        </Link>
        </div>
      </main>
    </ProviderShell>
  );
}

const REQ_STATUS_TONE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  passed: "bg-mint/20 text-success",
  failed: "bg-coral/10 text-coral",
  waived: "bg-muted text-muted-foreground",
};

function RequirementsChecklist({
  providerId,
  serviceId,
}: {
  providerId: string;
  serviceId: string;
}) {
  const { t } = useTranslation();
  const reqQ = useRequirementsForService(serviceId);
  const mineQ = useMyRequirementFulfillments(providerId);
  const declare = useDeclareRequirement();
  const upload = useUploadRequirementEvidence();
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});

  const requirements = reqQ.data ?? [];
  const mineByReq = new Map((mineQ.data ?? []).map((f: any) => [f.requirement_id, f]));

  if (requirements.length === 0)
    return (
      <p className="mt-2 text-pro-12 text-muted-foreground">
        {t("pro.profile.noRequirements", "No requirements for this service.")}
      </p>
    );

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
                {r.required_for_provider_approval && (
                  <span className="ms-1 text-pro-12 text-coral">*</span>
                )}
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-pro-12 font-bold uppercase ${REQ_STATUS_TONE[status]}`}
              >
                {status}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <input
                value={notesDraft[r.id] ?? mine?.notes ?? ""}
                onChange={(e) => setNotesDraft((d) => ({ ...d, [r.id]: e.target.value }))}
                placeholder={t("pro.profile.reqNotesPlaceholder", "Notes (optional)")}
                className="min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 text-pro-12"
              />
              <button
                onClick={() =>
                  declare.mutate({ providerId, requirementId: r.id, notes: notesDraft[r.id] })
                }
                disabled={declare.isPending}
                className="min-h-11 rounded-lg bg-brand px-2 py-1.5 text-pro-12 font-bold text-brand-foreground disabled:opacity-50"
              >
                {t("common.save")}
              </button>
              {r.evidence_required && (
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-pro-12 font-semibold">
                  <Upload className="h-3 w-3" />{" "}
                  {mine?.evidence_storage_path
                    ? t("pro.profile.reevidence", "Re-upload")
                    : t("pro.profile.uploadEvidence", "Upload evidence")}
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f)
                        upload.mutate(
                          { providerId, requirementId: r.id, file: f },
                          { onError: (e2: any) => toast.error(e2?.message ?? "Upload failed") },
                        );
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
  onRequirementsFocus,
  serviceNames,
}: {
  mapped: MappedEligibilityReason;
  t: (key: string, options?: Record<string, unknown>) => string;
  onServiceFocus: (serviceId: string) => void;
  onRequirementsFocus: (serviceId: string) => void;
  serviceNames?: string[];
}) {
  const proPath = useProPath();
  const row = serviceNames !== undefined;
  const waiting = mapped.owner === "famy";
  const className = row
    ? `apply-li apply-profile-action ${waiting ? "apply-waiting" : "apply-next focus-ring"}`
    : "font-semibold text-brand underline-offset-2 hover:underline";
  const label = row ? <>
    <span className="apply-tile" aria-hidden="true">{waiting ? <Clock size={18} /> : <FileText size={18} />}</span>
    <span className="apply-task-text"><b>{t(mapped.i18nKey)}</b><small>{serviceNames.map((name, index) => <span key={name}>{index > 0 && " · "}<span>{name}</span></span>)}</small></span>
    <span className={`apply-tag ${waiting ? "apply-wait" : "apply-go"}`}>{t(`providerApply.pending.${waiting ? "waiting" : "start"}`)}</span>
  </> : t(mapped.i18nKey);
  if (row && waiting) return <div className={className}>{label}</div>;
  if (mapped.action.kind === "link") {
    return (
      <Link
        to={proPath(mapped.action.path) as any}
        hash={mapped.action.hash}
        onClick={() => {
          if (mapped.action.kind === "link" && mapped.action.hash)
            document
              .getElementById(mapped.action.hash)
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
        className={className}
      >
        {label}
      </Link>
    );
  }
  if (mapped.action.kind === "requirements") {
    const serviceId = mapped.action.serviceId;
    return <a href={`${proPath("/pro/profile")}#requirements-${serviceId}`} className={className} onClick={(event) => { event.preventDefault(); onRequirementsFocus(serviceId); }}>{label}</a>;
  }
  if (mapped.action.kind === "service") {
    const serviceId = mapped.action.serviceId;
    const hash =
      mapped.i18nKey === "pro.profile.eligibilityReasons.teachingPrice"
        ? "teaching-subjects"
        : `price-${serviceId}`;
    return (
      <a
        href={`${proPath("/pro/profile")}#${hash}`}
        className={className}
        onClick={(event) => {
          event.preventDefault();
          onServiceFocus(serviceId);
        }}
      >
        {label}
      </a>
    );
  }
  return <span className={row ? className : "font-semibold"}>{label}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-pro-13 font-bold text-muted-foreground">
        {label}
      </div>
      {children}
    </label>
  );
}

function ProRow({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link to={to as any} className="apply-li focus-ring">
      <div className="apply-tile">
        {icon}
      </div>
      <div className="apply-task-text"><b>{label}</b></div>
    </Link>
  );
}
