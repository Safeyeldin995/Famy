import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { Upload } from "lucide-react";
import { PhoneFrame, TopBar, Card, PrimaryButton, Badge } from "@/components/famio/ui";
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

const STEPS: OnboardingSection[] = ["personal", "services", "experience", "coverage", "references", "review"];

export function OnboardingWizard() {
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
  const status = (provider?.onboarding_status ?? snapshot?.provider?.onboarding_status) as string | undefined;
  const editable = onboardingEditable(status as any);
  const profile = snapshot?.profile ?? provider?.profile ?? {};
  const details = snapshot?.details ?? {};
  const completion = snapshot?.completion ?? {};
  const errors = (completion?.errors ?? {}) as Record<string, string>;

  const refsQ = useMyReferences(provider?.id);
  const docsQ = useProviderDocuments(provider?.id);

  const [step, setStep] = useState(0);
  const [err, setErr] = useState("");
  const [legalName, setLegalName] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState("");
  const [governorate, setGovernorate] = useState("");
  const [area, setArea] = useState("");
  const [address, setAddress] = useState("");
  const [years, setYears] = useState(1);
  const [bioEn, setBioEn] = useState("");
  const [bioAr, setBioAr] = useState("");
  const [previousWork, setPreviousWork] = useState("");
  const [langs, setLangs] = useState<string[]>(["arabic"]);
  const [childGroups, setChildGroups] = useState<string[]>([]);
  const [newborn, setNewborn] = useState(false);
  const [firstAid, setFirstAid] = useState(false);
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [selectedZones, setSelectedZones] = useState<string[]>([]);
  const [ref1, setRef1] = useState({ full_name: "", relationship: "", phone: "", notes: "" });
  const [ref2, setRef2] = useState({ full_name: "", relationship: "", phone: "", notes: "" });
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!snapshot?.exists) return;
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
  }, [snapshot?.exists, profile, details, provider]);

  const current = STEPS[step];
  const progress = Math.round(((step + 1) / STEPS.length) * 100);

  const babysittingSelected = useMemo(() => {
    const services = servicesQ.data ?? [];
    return selectedServices.some((id) => services.find((s: any) => s.id === id)?.category?.slug === "babysitting");
  }, [selectedServices, servicesQ.data]);

  const saveCurrent = async () => {
    setErr("");
    try {
      if (current === "personal") {
        await saveSection.mutateAsync({
          section: "personal",
          payload: {
            legal_name: legalName,
            date_of_birth: dob,
            gender,
            governorate,
            area,
            full_address: address,
          },
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
        await saveSection.mutateAsync({
          section: "references",
          payload: { references: [ref1, ref2] },
        });
      } else if (current === "review") {
        await saveSection.mutateAsync({ section: "review", payload: { confirmed } });
        const res = await submit.mutateAsync();
        if (!res.ok) throw new Error("submission_incomplete");
        nav({ to: "/pro", replace: true });
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
    setErr("");
    try {
      const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase();
      if (!["jpg", "jpeg", "png"].includes(ext)) {
        setErr(t("pro.onboardingWizard.uploadError"));
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
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
      try {
        await uploadDoc.mutateAsync({ type: "profile_photo", file });
      } catch {
        setErr(t("pro.onboardingWizard.uploadDocumentError"));
        return;
      }
      providerQ.refetch();
      snapshotQ.refetch();
    } catch {
      setErr(t("pro.onboardingWizard.uploadError"));
    }
  };

  if (!editable && status && status !== "DRAFT") {
    const submittedRefs = refsQ.data ?? [];
    return (
      <PhoneFrame>
        <TopBar back={{ to: "/pro" }} title={t("pro.onboardingWizard.title")} />
        <div className="space-y-4 px-5 pb-10" dir={lang === "ar" ? "rtl" : "ltr"}>
          <Card className="p-4">
            <Badge tone="muted">{t(`pro.onboardingWizard.status.${status}`, status)}</Badge>
            <p className="mt-3 text-sm text-muted-foreground">
              {status === "NEEDS_CHANGES"
                ? (provider?.review_reason_public ?? t("pro.onboardingWizard.changesRequired"))
                : t(`pro.onboardingWizard.statusBody.${status}`, t("pro.onboardingWizard.readOnly"))}
            </p>
          </Card>
          {(details.full_address || details.governorate || details.area) && (
            <Card className="space-y-2 p-4">
              <div className="text-sm font-bold">{t("pro.onboardingWizard.steps.personal")}</div>
              {details.full_address && <p className="text-sm text-foreground">{details.full_address}</p>}
              {(details.governorate || details.area) && (
                <p className="text-sm text-muted-foreground">
                  {[details.governorate, details.area].filter(Boolean).join(", ")}
                </p>
              )}
            </Card>
          )}
          {submittedRefs.length > 0 && (
            <Card className="space-y-2 p-4">
              <div className="text-sm font-bold">{t("pro.onboardingWizard.steps.references")}</div>
              {submittedRefs.map((ref: { id?: string; full_name: string; relationship: string; phone: string }) => (
                <div key={ref.id ?? ref.full_name} className="rounded-xl border border-border p-3 text-sm">
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

  return (
    <PhoneFrame>
      <TopBar back={{ to: "/pro" }} title={t("pro.onboardingWizard.title")} />
      <div className="space-y-4 px-5 pb-10" dir={lang === "ar" ? "rtl" : "ltr"}>
        <div>
          <div className="mb-1 flex justify-between text-xs font-semibold text-muted-foreground">
            <span>{t(`pro.onboardingWizard.steps.${current}`)}</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-navy transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {current === "personal" && (
          <Card className="space-y-3 p-4">
            <Field label={t("pro.onboardingWizard.legalName")}>
              <input value={legalName} onChange={(e) => setLegalName(e.target.value)} className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm" />
            </Field>
            <Field label={t("pro.onboardingWizard.phone")}>
              <input value={profile.phone ?? ""} readOnly disabled className="field opacity-70" />
            </Field>
            <Field label={t("pro.onboardingWizard.dob")}>
              <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm" />
            </Field>
            <Field label={t("pro.onboardingWizard.gender")}>
              <select value={gender} onChange={(e) => setGender(e.target.value)} className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm">
                <option value="">{t("pro.onboardingWizard.select")}</option>
                <option value="female">{t("pro.onboardingWizard.female")}</option>
                <option value="male">{t("pro.onboardingWizard.male")}</option>
              </select>
            </Field>
            <Field label={t("pro.onboardingWizard.governorate")}>
              <input value={governorate} onChange={(e) => setGovernorate(e.target.value)} className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm" />
            </Field>
            <Field label={t("pro.onboardingWizard.area")}>
              <input value={area} onChange={(e) => setArea(e.target.value)} className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm" />
            </Field>
            <Field label={t("pro.onboardingWizard.address")}>
              <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm" />
            </Field>
            <label className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-navy/30 text-sm font-bold text-navy">
              <Upload className="h-4 w-4" />
              {t("pro.onboardingWizard.uploadPhoto")}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadAvatar(e.target.files[0])} />
            </label>
          </Card>
        )}

        {current === "services" && (
          <Card className="space-y-2 p-4">
            {(servicesQ.data ?? []).map((s: any) => {
              const on = selectedServices.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedServices((prev) => (on ? prev.filter((x) => x !== s.id) : [...prev, s.id]))}
                  className={`w-full rounded-xl border px-3 py-3 text-start text-sm font-semibold ${on ? "border-navy bg-navy/5" : "border-border"}`}
                >
                  {lang === "ar" ? s.name_ar : s.name_en}
                  <div className="text-xs text-muted-foreground">{lang === "ar" ? s.category?.name_ar : s.category?.name_en}</div>
                </button>
              );
            })}
          </Card>
        )}

        {current === "experience" && (
          <Card className="space-y-3 p-4">
            <Field label={t("pro.onboarding.years")}>
              <input type="number" min={0} value={years} onChange={(e) => setYears(Number(e.target.value))} className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm" />
            </Field>
            <Field label={t("pro.onboarding.bioEn")}>
              <textarea value={bioEn} onChange={(e) => setBioEn(e.target.value)} rows={3} className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm" />
            </Field>
            <Field label={t("pro.onboarding.bioAr")}>
              <textarea value={bioAr} onChange={(e) => setBioAr(e.target.value)} rows={3} dir="rtl" className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm" />
            </Field>
            <Field label={t("pro.onboardingWizard.previousWork")}>
              <textarea value={previousWork} onChange={(e) => setPreviousWork(e.target.value)} rows={2} className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm" />
            </Field>
            {babysittingSelected && (
              <>
                <Field label={t("pro.onboardingWizard.childAgeGroups")}>
                  <div className="flex flex-wrap gap-2">
                    {["newborn", "toddler", "school"].map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setChildGroups((s) => (s.includes(g) ? s.filter((x) => x !== g) : [...s, g]))}
                        className={`rounded-full px-3 py-1 text-xs font-bold ${childGroups.includes(g) ? "bg-navy text-navy-foreground" : "border border-border"}`}
                      >
                        {t(`pro.onboardingWizard.ageGroups.${g}`)}
                      </button>
                    ))}
                  </div>
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={newborn} onChange={(e) => setNewborn(e.target.checked)} />
                  {t("pro.onboardingWizard.newbornExperience")}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={firstAid} onChange={(e) => setFirstAid(e.target.checked)} />
                  {t("pro.onboardingWizard.firstAid")}
                </label>
              </>
            )}
          </Card>
        )}

        {current === "coverage" && (
          <Card className="space-y-2 p-4">
            {(zonesQ.data ?? []).map((z: any) => {
              const on = selectedZones.includes(z.id);
              return (
                <button
                  key={z.id}
                  type="button"
                  onClick={() => setSelectedZones((prev) => (on ? prev.filter((x) => x !== z.id) : [...prev, z.id]))}
                  className={`w-full rounded-xl border px-3 py-3 text-start text-sm font-semibold ${on ? "border-navy bg-navy/5" : "border-border"}`}
                >
                  {lang === "ar" ? z.name_ar : z.name_en}
                </button>
              );
            })}
          </Card>
        )}

        {current === "references" && (
          <Card className="space-y-4 p-4">
            {[ref1, ref2].map((ref, idx) => (
              <div key={idx} className="space-y-2 rounded-xl border border-border p-3">
                <div className="text-xs font-bold uppercase text-muted-foreground">{t("pro.onboardingWizard.reference", { n: idx + 1 })}</div>
                <input
                  placeholder={t("pro.onboardingWizard.refName")}
                  value={ref.full_name}
                  onChange={(e) => (idx === 0 ? setRef1 : setRef2)({ ...ref, full_name: e.target.value })}
                  className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm"
                />
                <input
                  placeholder={t("pro.onboardingWizard.refRelationship")}
                  value={ref.relationship}
                  onChange={(e) => (idx === 0 ? setRef1 : setRef2)({ ...ref, relationship: e.target.value })}
                  className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm"
                />
                <input
                  placeholder={t("pro.onboardingWizard.refPhone")}
                  value={ref.phone}
                  onChange={(e) => (idx === 0 ? setRef1 : setRef2)({ ...ref, phone: e.target.value })}
                  className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm"
                  inputMode="tel"
                />
              </div>
            ))}
          </Card>
        )}

        {current === "review" && (
          <Card className="space-y-3 p-4">
            <div className="text-sm font-bold">{t("pro.onboardingWizard.reviewTitle")}</div>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {Object.entries(errors).map(([k, v]) => (
                <li key={k} className="text-coral">{t(`pro.onboardingWizard.errors.${v}`, v)}</li>
              ))}
              {Object.keys(errors).length === 0 && <li>{t("pro.onboardingWizard.allComplete")}</li>}
            </ul>
            <div className="grid grid-cols-2 gap-2">
              <DocButton label={t("pro.onboardingWizard.idFront")} onUpload={(f) => uploadDoc.mutateAsync({ type: "id_card_front", file: f })} />
              <DocButton label={t("pro.onboardingWizard.idBack")} onUpload={(f) => uploadDoc.mutateAsync({ type: "id_card_back", file: f })} />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              {t("pro.onboardingWizard.accuracyConfirm")}
            </label>
          </Card>
        )}

        {err && <div className="rounded-xl bg-coral/10 px-3 py-2 text-xs font-semibold text-coral">{err}</div>}

        <div className="flex gap-2">
          {step > 0 && (
            <button type="button" onClick={() => setStep(step - 1)} className="h-12 flex-1 rounded-2xl border border-border text-sm font-bold">
              {t("common.back")}
            </button>
          )}
          <PrimaryButton className="flex-[2]" onClick={saveCurrent} disabled={saveSection.isPending || submit.isPending || uploadDoc.isPending}>
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
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      {children}
    </label>
  );
}

function DocButton({ label, onUpload }: { label: string; onUpload: (f: File) => Promise<unknown> }) {
  return (
    <label className="flex h-14 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border text-xs font-bold">
      {label}
      <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
    </label>
  );
}
