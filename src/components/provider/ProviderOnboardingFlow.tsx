import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import {
  Briefcase,
  Camera,
  CheckCircle2,
  FileText,
  MapPin,
  Upload,
  UserRound,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { PhoneFrame, Card, PrimaryButton, Badge } from "@/components/famio/ui";
import { ProviderPageHero } from "@/components/famio/ProviderPageHero";
import { ProviderFloatingPanel } from "@/components/famio/ProviderFloatingPanel";
import { useLang } from "@/components/famio/LanguageToggle";
import { useMyProvider, useProviderDocuments } from "@/lib/db/provider-queries";
import {
  onboardingEditable,
  useActiveZones,
  useMyReferences,
  useOnboardingSnapshot,
  usePhase1Services,
  useSaveOnboardingSection,
  useSecureUploadDocument,
  useSubmitOnboarding,
  type OnboardingSection,
} from "@/lib/provider/onboarding-queries";
import { supabase } from "@/integrations/supabase/client";
import { proPath } from "@/lib/preview/previewPath";
import { ICON_STROKE_BOLD } from "@/lib/icons/constants";

const STEPS: OnboardingSection[] = ["personal", "services", "experience", "coverage", "references", "review"];

const STEP_META: Record<OnboardingSection, { icon: typeof UserRound; shortKey: string }> = {
  personal: { icon: UserRound, shortKey: "pro.onboardingWizard.steps.personal" },
  services: { icon: Briefcase, shortKey: "pro.onboardingWizard.steps.services" },
  experience: { icon: FileText, shortKey: "pro.onboardingWizard.steps.experience" },
  coverage: { icon: MapPin, shortKey: "pro.onboardingWizard.steps.coverage" },
  references: { icon: Users, shortKey: "pro.onboardingWizard.steps.references" },
  review: { icon: CheckCircle2, shortKey: "pro.onboardingWizard.steps.review" },
};

const PREVIEW_DEFAULTS = {
  legalName: "Mona Adel",
  dob: "1990-04-18",
  gender: "female",
  governorate: "Cairo",
  area: "Maadi",
  address: "Road 9, Degla, Giza",
  years: 5,
  bioEn: "Experienced home cleaning professional serving Cairo families with care and attention to detail.",
  bioAr: "محترفة تنظيف منازل بخبرة تخدم العائلات في القاهرة بعناية واهتمام بالتفاصيل.",
  previousWork: "Private homes in Maadi and Zamalek for 4 years.",
  selectedServices: ["svc-clean"],
  selectedZones: ["zone-maadi", "zone-zayed"],
  ref1: { full_name: "Nadia Kamal", relationship: "former_client", phone: "+201011122233", notes: "Weekly clean for 6 months" },
  ref2: { full_name: "Layla Hassan", relationship: "neighbor", phone: "+201022233344", notes: "" },
};

export function ProviderOnboardingFlow({ previewMode = false }: { previewMode?: boolean }) {
  const { t } = useTranslation();
  const lang = useLang();
  const nav = useNavigate();
  const snapshotQ = useOnboardingSnapshot();
  const providerQ = useMyProvider();
  const saveSection = useSaveOnboardingSection();
  const submit = useSubmitOnboarding();
  const uploadDoc = useSecureUploadDocument();
  const servicesQ = usePhase1Services();
  const zonesQ = useActiveZones();

  const provider = providerQ.data as any;
  const snapshot = snapshotQ.data as any;
  const status = previewMode
    ? "DRAFT"
    : ((provider?.onboarding_status ?? snapshot?.provider?.onboarding_status) as string | undefined);
  const editable = previewMode || onboardingEditable(status as any);
  const profile = snapshot?.profile ?? provider?.profile ?? {};
  const details = snapshot?.details ?? {};
  const completion = snapshot?.completion ?? {};
  const errors = (completion?.errors ?? {}) as Record<string, string>;

  const refsQ = useMyReferences(provider?.id);
  const docsQ = useProviderDocuments(provider?.id);

  const [step, setStep] = useState(0);
  const [err, setErr] = useState("");
  const [legalName, setLegalName] = useState(previewMode ? PREVIEW_DEFAULTS.legalName : "");
  const [dob, setDob] = useState(previewMode ? PREVIEW_DEFAULTS.dob : "");
  const [gender, setGender] = useState(previewMode ? PREVIEW_DEFAULTS.gender : "");
  const [governorate, setGovernorate] = useState(previewMode ? PREVIEW_DEFAULTS.governorate : "");
  const [area, setArea] = useState(previewMode ? PREVIEW_DEFAULTS.area : "");
  const [address, setAddress] = useState(previewMode ? PREVIEW_DEFAULTS.address : "");
  const [years, setYears] = useState(previewMode ? PREVIEW_DEFAULTS.years : 1);
  const [bioEn, setBioEn] = useState(previewMode ? PREVIEW_DEFAULTS.bioEn : "");
  const [bioAr, setBioAr] = useState(previewMode ? PREVIEW_DEFAULTS.bioAr : "");
  const [previousWork, setPreviousWork] = useState(previewMode ? PREVIEW_DEFAULTS.previousWork : "");
  const [langs, setLangs] = useState<string[]>(["arabic"]);
  const [childGroups, setChildGroups] = useState<string[]>([]);
  const [newborn, setNewborn] = useState(false);
  const [firstAid, setFirstAid] = useState(false);
  const [selectedServices, setSelectedServices] = useState<string[]>(
    previewMode ? PREVIEW_DEFAULTS.selectedServices : [],
  );
  const [selectedZones, setSelectedZones] = useState<string[]>(previewMode ? PREVIEW_DEFAULTS.selectedZones : []);
  const [ref1, setRef1] = useState(previewMode ? PREVIEW_DEFAULTS.ref1 : { full_name: "", relationship: "", phone: "", notes: "" });
  const [ref2, setRef2] = useState(previewMode ? PREVIEW_DEFAULTS.ref2 : { full_name: "", relationship: "", phone: "", notes: "" });
  const [confirmed, setConfirmed] = useState(false);
  const [uploadedDocs, setUploadedDocs] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (previewMode || !snapshot?.exists) return;
    setLegalName(profile.full_name ?? "");
    setDob(details.date_of_birth ?? "");
    setGender(details.gender ?? "");
    setGovernorate(details.governorate ?? "");
    setArea(details.area ?? provider?.city ?? "");
    setAddress(details.full_address ?? "");
    setYears(provider?.years_experience ?? 1);
    setBioEn(provider?.bio_en ?? "");
    setBioAr(provider?.bio_ar ?? "");
    setPreviousWork(details.previous_work ?? "");
    setLangs(provider?.languages ?? ["arabic"]);
    setChildGroups(details.child_age_groups ?? []);
    setNewborn(!!details.newborn_experience);
    setFirstAid(!!details.first_aid_training);
    setConfirmed(!!details.accuracy_confirmed_at);
  }, [previewMode, snapshot?.exists, profile, details, provider]);

  const current = STEPS[step];
  const progress = Math.round(((step + 1) / STEPS.length) * 100);

  const babysittingSelected = useMemo(() => {
    const services = servicesQ.data ?? [];
    return selectedServices.some((id) => services.find((s: any) => s.id === id)?.category?.slug === "babysitting");
  }, [selectedServices, servicesQ.data]);

  const saveCurrent = async () => {
    setErr("");
    try {
      if (previewMode) {
        if (current === "review") {
          toast.success(t("pro.onboardingWizard.submitSuccess", "Application submitted for review"));
          nav({ to: proPath("/pro") as "/pro", replace: true });
          return;
        }
        if (step < STEPS.length - 1) setStep(step + 1);
        return;
      }

      if (current === "personal") {
        await saveSection.mutateAsync({
          section: "personal",
          payload: { legal_name: legalName, date_of_birth: dob, gender, governorate, area, full_address: address },
        });
      } else if (current === "experience") {
        await saveSection.mutateAsync({
          section: "experience",
          payload: {
            years_experience: years,
            bio_en: bioEn,
            bio_ar: bioAr,
            previous_work: previousWork,
            languages: langs,
            child_age_groups: childGroups,
            newborn_experience: newborn,
            first_aid_training: firstAid,
          },
        });
      } else if (current === "services") {
        await saveSection.mutateAsync({ section: "services", payload: { service_ids: selectedServices } });
      } else if (current === "coverage") {
        await saveSection.mutateAsync({ section: "coverage", payload: { zone_ids: selectedZones } });
      } else if (current === "references") {
        await saveSection.mutateAsync({ section: "references", payload: { references: [ref1, ref2] } });
      } else if (current === "review") {
        await saveSection.mutateAsync({ section: "review", payload: { confirmed } });
        const res = await submit.mutateAsync();
        if (!res.ok) throw new Error("submission_incomplete");
        nav({ to: proPath("/pro") as "/pro", replace: true });
        return;
      }
      if (step < STEPS.length - 1) setStep(step + 1);
    } catch (e: any) {
      if (e?.message === "submission_incomplete") {
        setErr(t("pro.onboardingWizard.submitIncomplete"));
      } else {
        setErr(t("pro.onboardingWizard.saveError"));
      }
    }
  };

  const uploadAvatar = async (file: File) => {
    if (previewMode) {
      toast.message(t("preview.banner", "Design preview — sample data only, no sign-in required"));
      return;
    }
    setErr("");
    try {
      const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase();
      if (!["jpg", "jpeg", "png"].includes(ext) || file.size > 10 * 1024 * 1024) {
        setErr(t("pro.onboardingWizard.uploadError"));
        return;
      }
      const storagePath = `${provider.profile_id}/avatar-${crypto.randomUUID()}.${ext === "jpeg" ? "jpg" : ext}`;
      const { error: upErr } = await supabase.storage.from("avatars").upload(storagePath, file, {
        contentType: file.type,
        upsert: false,
      });
      if (upErr) {
        setErr(t("pro.onboardingWizard.uploadStorageError"));
        return;
      }
      const { error: profileErr } = await supabase
        .from("profiles")
        .update({ avatar_url: storagePath })
        .eq("id", provider.profile_id);
      if (profileErr) {
        setErr(t("pro.onboardingWizard.uploadProfileError"));
        return;
      }
      await uploadDoc.mutateAsync({ type: "profile_photo", file });
      providerQ.refetch();
      snapshotQ.refetch();
    } catch {
      setErr(t("pro.onboardingWizard.uploadError"));
    }
  };

  const handleDocUpload = async (type: string, file: File) => {
    if (previewMode) {
      setUploadedDocs((d) => ({ ...d, [type]: true }));
      toast.success(t("pro.onboardingWizard.uploaded", "Document uploaded"));
      return;
    }
    await uploadDoc.mutateAsync({ type: type as any, file });
    docsQ.refetch();
  };

  if (!previewMode && !editable && status && status !== "DRAFT") {
    const submittedRefs = refsQ.data ?? [];
    return (
      <PhoneFrame bg="bg-[#FEFAFC]">
        <ProviderPageHero title={t("pro.onboardingWizard.title")} backTo="/pro" compact />
        <div className="space-y-4 px-5 pb-10" dir={lang === "ar" ? "rtl" : "ltr"}>
          <ProviderFloatingPanel>
            <Badge tone="muted">{t(`pro.onboardingWizard.status.${status}`, status)}</Badge>
            <p className="mt-3 text-sm font-medium text-muted-foreground">
              {status === "NEEDS_CHANGES"
                ? (provider?.review_reason_public ?? t("pro.onboardingWizard.changesRequired"))
                : t(`pro.onboardingWizard.statusBody.${status}`, t("pro.onboardingWizard.readOnly"))}
            </p>
          </ProviderFloatingPanel>
          {(details.full_address || details.governorate || details.area) && (
            <Card className="space-y-2 rounded-[1.25rem] p-4">
              <div className="text-sm font-extrabold">{t("pro.onboardingWizard.steps.personal")}</div>
              {details.full_address && <p className="text-sm text-foreground">{details.full_address}</p>}
              {(details.governorate || details.area) && (
                <p className="text-sm text-muted-foreground">
                  {[details.governorate, details.area].filter(Boolean).join(", ")}
                </p>
              )}
            </Card>
          )}
          {submittedRefs.length > 0 && (
            <Card className="space-y-2 rounded-[1.25rem] p-4">
              <div className="text-sm font-extrabold">{t("pro.onboardingWizard.steps.references")}</div>
              {submittedRefs.map((ref: { id?: string; full_name: string; relationship: string; phone: string }) => (
                <div key={ref.id ?? ref.full_name} className="rounded-xl border border-border/60 p-3 text-sm">
                  <div className="font-semibold">{ref.full_name}</div>
                  <div className="text-muted-foreground">{ref.relationship}</div>
                  <div className="text-muted-foreground">{ref.phone}</div>
                </div>
              ))}
            </Card>
          )}
        </div>
      </PhoneFrame>
    );
  }

  const inputClass =
    "h-12 w-full rounded-2xl border border-border/60 bg-surface px-4 text-sm font-medium text-foreground placeholder:text-muted-foreground/70";

  return (
    <PhoneFrame bg="bg-[#FEFAFC]">
      <ProviderPageHero
        title={t("pro.onboardingWizard.title")}
        subtitle={t(`pro.onboardingWizard.steps.${current}`)}
        backTo="/pro"
        compact
      />

      <div className="px-5" dir={lang === "ar" ? "rtl" : "ltr"}>
        <ProviderFloatingPanel className="!p-3">
          <div className="mb-2 flex items-center justify-between text-[11px] font-bold text-muted-foreground">
            <span>{t("pro.onboardingWizard.progress", "Step {{current}} of {{total}}", { current: step + 1, total: STEPS.length })}</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
            {STEPS.map((s, idx) => {
              const Icon = STEP_META[s].icon;
              const active = idx === step;
              const done = idx < step;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStep(idx)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-extrabold transition-colors ${
                    active
                      ? "bg-brand text-brand-foreground"
                      : done
                        ? "bg-brand/10 text-brand"
                        : "bg-surface-2 text-muted-foreground"
                  }`}
                >
                  <Icon className="h-3 w-3" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />
                  {t(STEP_META[s].shortKey)}
                </button>
              );
            })}
          </div>
        </ProviderFloatingPanel>
      </div>

      <div className="space-y-4 px-5 pb-10 pt-4" dir={lang === "ar" ? "rtl" : "ltr"}>
        {current === "personal" && (
          <Card className="space-y-4 rounded-[1.25rem] p-4">
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed border-brand/30 bg-brand/[0.04] px-4 py-6">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-brand/10 text-brand">
                <Camera className="h-6 w-6" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />
              </div>
              <span className="text-sm font-extrabold text-brand">{t("pro.onboardingWizard.uploadPhoto")}</span>
              <span className="text-[11px] font-medium text-muted-foreground">{t("pro.onboardingWizard.photoHint", "Clear face photo — JPG or PNG")}</span>
              <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadAvatar(e.target.files[0])} />
            </label>
            <Field label={t("pro.onboardingWizard.legalName")}>
              <input value={legalName} onChange={(e) => setLegalName(e.target.value)} className={inputClass} />
            </Field>
            <Field label={t("pro.onboardingWizard.phone")}>
              <input value={profile.phone ?? "+201098765432"} readOnly disabled className={`${inputClass} opacity-70`} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("pro.onboardingWizard.dob")}>
                <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} className={inputClass} />
              </Field>
              <Field label={t("pro.onboardingWizard.gender")}>
                <select value={gender} onChange={(e) => setGender(e.target.value)} className={inputClass}>
                  <option value="">{t("pro.onboardingWizard.select")}</option>
                  <option value="female">{t("pro.onboardingWizard.female")}</option>
                  <option value="male">{t("pro.onboardingWizard.male")}</option>
                </select>
              </Field>
            </div>
            <Field label={t("pro.onboardingWizard.governorate")}>
              <input value={governorate} onChange={(e) => setGovernorate(e.target.value)} className={inputClass} />
            </Field>
            <Field label={t("pro.onboardingWizard.area")}>
              <input value={area} onChange={(e) => setArea(e.target.value)} className={inputClass} />
            </Field>
            <Field label={t("pro.onboardingWizard.address")}>
              <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={3} className={`${inputClass} min-h-[5rem] py-3`} />
            </Field>
          </Card>
        )}

        {current === "services" && (
          <Card className="space-y-2 rounded-[1.25rem] p-4">
            <p className="mb-2 text-xs font-semibold text-muted-foreground">{t("pro.onboardingWizard.servicesHint", "Choose the services you want to offer on Famy.")}</p>
            {(servicesQ.data ?? []).map((s: any) => {
              const on = selectedServices.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedServices((prev) => (on ? prev.filter((x) => x !== s.id) : [...prev, s.id]))}
                  className={`w-full rounded-2xl border px-4 py-4 text-start transition-colors ${
                    on ? "border-brand bg-brand/[0.06] shadow-sm" : "border-border/60 bg-surface"
                  }`}
                >
                  <div className="text-sm font-extrabold text-foreground">{lang === "ar" ? s.name_ar : s.name_en}</div>
                  <div className="mt-0.5 text-xs font-medium text-muted-foreground">
                    {lang === "ar" ? s.category?.name_ar : s.category?.name_en}
                  </div>
                </button>
              );
            })}
          </Card>
        )}

        {current === "experience" && (
          <Card className="space-y-4 rounded-[1.25rem] p-4">
            <Field label={t("pro.onboarding.years")}>
              <input type="number" min={0} value={years} onChange={(e) => setYears(Number(e.target.value))} className={inputClass} />
            </Field>
            <Field label={t("pro.onboarding.bioEn")}>
              <textarea value={bioEn} onChange={(e) => setBioEn(e.target.value)} rows={4} className={`${inputClass} min-h-[6rem] py-3`} />
            </Field>
            <Field label={t("pro.onboarding.bioAr")}>
              <textarea value={bioAr} onChange={(e) => setBioAr(e.target.value)} rows={4} dir="rtl" className={`${inputClass} min-h-[6rem] py-3`} />
            </Field>
            <Field label={t("pro.onboardingWizard.previousWork")}>
              <textarea value={previousWork} onChange={(e) => setPreviousWork(e.target.value)} rows={3} className={`${inputClass} min-h-[5rem] py-3`} />
            </Field>
            {babysittingSelected && (
              <div className="space-y-3 rounded-2xl border border-border/50 bg-surface-2/50 p-4">
                <Field label={t("pro.onboardingWizard.childAgeGroups")}>
                  <div className="flex flex-wrap gap-2">
                    {["newborn", "toddler", "school"].map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setChildGroups((s) => (s.includes(g) ? s.filter((x) => x !== g) : [...s, g]))}
                        className={`rounded-full px-3 py-1.5 text-xs font-extrabold ${
                          childGroups.includes(g) ? "bg-brand text-brand-foreground" : "border border-border bg-surface"
                        }`}
                      >
                        {t(`pro.onboardingWizard.ageGroups.${g}`)}
                      </button>
                    ))}
                  </div>
                </Field>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={newborn} onChange={(e) => setNewborn(e.target.checked)} className="accent-brand" />
                  {t("pro.onboardingWizard.newbornExperience")}
                </label>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={firstAid} onChange={(e) => setFirstAid(e.target.checked)} className="accent-brand" />
                  {t("pro.onboardingWizard.firstAid")}
                </label>
              </div>
            )}
          </Card>
        )}

        {current === "coverage" && (
          <Card className="space-y-2 rounded-[1.25rem] p-4">
            <p className="mb-2 text-xs font-semibold text-muted-foreground">{t("pro.onboardingWizard.coverageHint", "Select the areas where you can accept jobs.")}</p>
            {(zonesQ.data ?? []).map((z: any) => {
              const on = selectedZones.includes(z.id);
              return (
                <button
                  key={z.id}
                  type="button"
                  onClick={() => setSelectedZones((prev) => (on ? prev.filter((x) => x !== z.id) : [...prev, z.id]))}
                  className={`w-full rounded-2xl border px-4 py-4 text-start text-sm font-extrabold ${
                    on ? "border-brand bg-brand/[0.06]" : "border-border/60"
                  }`}
                >
                  {lang === "ar" ? z.name_ar : z.name_en}
                </button>
              );
            })}
          </Card>
        )}

        {current === "references" && (
          <div className="space-y-3">
            {[ref1, ref2].map((ref, idx) => (
              <Card key={idx} className="space-y-3 rounded-[1.25rem] p-4">
                <div className="text-xs font-extrabold uppercase tracking-wider text-brand">
                  {t("pro.onboardingWizard.reference", { n: idx + 1 })}
                </div>
                <input
                  placeholder={t("pro.onboardingWizard.refName")}
                  value={ref.full_name}
                  onChange={(e) => (idx === 0 ? setRef1 : setRef2)({ ...ref, full_name: e.target.value })}
                  className={inputClass}
                />
                <input
                  placeholder={t("pro.onboardingWizard.refRelationship")}
                  value={ref.relationship}
                  onChange={(e) => (idx === 0 ? setRef1 : setRef2)({ ...ref, relationship: e.target.value })}
                  className={inputClass}
                />
                <input
                  placeholder={t("pro.onboardingWizard.refPhone")}
                  value={ref.phone}
                  onChange={(e) => (idx === 0 ? setRef1 : setRef2)({ ...ref, phone: e.target.value })}
                  className={inputClass}
                  inputMode="tel"
                />
              </Card>
            ))}
          </div>
        )}

        {current === "review" && (
          <Card className="space-y-4 rounded-[1.25rem] p-4">
            <div className="text-sm font-extrabold">{t("pro.onboardingWizard.reviewTitle")}</div>
            <ul className="space-y-1 text-xs font-medium text-muted-foreground">
              {Object.entries(errors).map(([k, v]) => (
                <li key={k} className="text-coral">{t(`pro.onboardingWizard.errors.${v}`, v)}</li>
              ))}
              {Object.keys(errors).length === 0 && (
                <li className="flex items-center gap-2 text-success">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  {t("pro.onboardingWizard.allComplete")}
                </li>
              )}
            </ul>
            <div className="grid grid-cols-2 gap-3">
              <DocButton
                label={t("pro.onboardingWizard.idFront")}
                done={uploadedDocs.id_card_front}
                onUpload={(f) => handleDocUpload("id_card_front", f)}
              />
              <DocButton
                label={t("pro.onboardingWizard.idBack")}
                done={uploadedDocs.id_card_back}
                onUpload={(f) => handleDocUpload("id_card_back", f)}
              />
            </div>
            <label className="flex items-start gap-3 rounded-2xl border border-border/60 bg-surface-2/40 p-4 text-sm font-medium">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 accent-brand" />
              {t("pro.onboardingWizard.accuracyConfirm")}
            </label>
          </Card>
        )}

        {err && <div className="rounded-2xl bg-coral/10 px-4 py-3 text-xs font-bold text-coral">{err}</div>}

        <div className="flex gap-2 pt-2">
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="focus-ring h-14 flex-1 rounded-2xl border border-border/60 bg-surface text-sm font-extrabold text-foreground"
            >
              {t("common.back")}
            </button>
          )}
          <PrimaryButton
            className="flex-[2] !h-14"
            onClick={saveCurrent}
            disabled={!previewMode && (saveSection.isPending || submit.isPending || uploadDoc.isPending)}
          >
            {current === "review" ? t("pro.onboardingWizard.submit") : t("common.continue")}
          </PrimaryButton>
        </div>
      </div>
    </PhoneFrame>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">{label}</div>
      {children}
    </label>
  );
}

function DocButton({
  label,
  done,
  onUpload,
}: {
  label: string;
  done?: boolean;
  onUpload: (f: File) => Promise<unknown>;
}) {
  return (
    <label
      className={`flex h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border border-dashed px-2 text-center text-xs font-extrabold ${
        done ? "border-success/40 bg-success/5 text-success" : "border-border/60 text-muted-foreground"
      }`}
    >
      {done ? <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> : <Upload className="h-5 w-5" aria-hidden="true" />}
      {label}
      <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
    </label>
  );
}
