import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PhoneFrame, TopBar, Card, PrimaryButton } from "@/components/famio/ui";
import { useCreateProvider, useMyProvider } from "@/lib/db/provider-queries";

export const Route = createFileRoute("/pro/onboarding")({ component: Onboarding });

const LANG_KEYS = ["arabic", "english", "french"] as const;
// Matches the customer-side setup.tsx area selector (Sprint 1 Phase 2,
// adjustment #2) — Wave 1 launch geography only (BIZ-004). Stored directly in
// providers.city (a single free-text column, unlike addresses.city/area) since
// splitting it into two columns would be a schema change outside this fix's
// scope (PROV-01).
const CITY_OPTIONS = ["Sheikh Zayed", "6th of October"] as const;

function Onboarding() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const create = useCreateProvider();
  const existing = useMyProvider();

  const [bioEn, setBioEn] = useState("");
  const [bioAr, setBioAr] = useState("");
  const [years, setYears] = useState(1);
  const [rate, setRate] = useState(150);
  const [city, setCity] = useState("");
  const [langs, setLangs] = useState<string[]>(["arabic"]);
  const [err, setErr] = useState("");

  if (existing.data) {
    nav({ to: "/pro", replace: true });
    return null;
  }

  const submit = async () => {
    setErr("");
    if (!bioEn && !bioAr) { setErr(t("pro.onboarding.addBio")); return; }
    if (!city) { setErr(t("pro.onboarding.selectCity")); return; }
    try {
      await create.mutateAsync({ bio_en: bioEn, bio_ar: bioAr, years_experience: years, hourly_rate: rate, city, languages: langs });
      nav({ to: "/pro/documents", replace: true });
    } catch (e: any) { setErr(e?.message ?? t("pro.onboarding.createError")); }
  };

  return (
    <PhoneFrame>
      <TopBar back={{ to: "/pro" }} title={t("pro.onboarding.title")} />
      <div className="space-y-4 px-5 pb-10">
        <Card className="p-4">
          <div className="text-sm font-extrabold">{t("pro.onboarding.tellAbout")}</div>
          <div className="mt-1 text-xs text-muted-foreground">{t("pro.onboarding.appearsPublic")}</div>
        </Card>

        <Card className="space-y-3 p-4">
          <Field label={t("pro.onboarding.bioEn")}><textarea value={bioEn} onChange={(e) => setBioEn(e.target.value)} rows={3} className="w-full rounded-xl border border-border bg-surface p-2 text-sm" placeholder={t("pro.onboarding.bioPlaceholder")} /></Field>
          <Field label={t("pro.onboarding.bioAr")}><textarea value={bioAr} onChange={(e) => setBioAr(e.target.value)} rows={3} dir="rtl" className="w-full rounded-xl border border-border bg-surface p-2 text-sm" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("pro.onboarding.years")}><input type="number" min={0} value={years} onChange={(e) => setYears(Number(e.target.value))} className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm" /></Field>
            <Field label={t("pro.onboarding.rate")}><input type="number" min={0} value={rate} onChange={(e) => setRate(Number(e.target.value))} className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm" /></Field>
          </div>
          <Field label={t("pro.onboarding.city")}>
            <div className="grid grid-cols-2 gap-2">
              {CITY_OPTIONS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCity(c)}
                  className={`h-10 rounded-xl border text-sm font-semibold transition-all ${
                    city === c ? "border-navy bg-navy/[0.04] text-navy" : "border-border bg-surface text-muted-foreground"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </Field>
          <Field label={t("pro.onboarding.languages")}>
            <div className="flex flex-wrap gap-2">
              {LANG_KEYS.map((k) => {
                const on = langs.includes(k);
                return (
                  <button key={k} onClick={() => setLangs((s) => on ? s.filter((x) => x !== k) : [...s, k])}
                    className={`rounded-full px-3 py-1.5 text-xs font-bold ${on ? "bg-navy text-navy-foreground" : "bg-surface border border-border"}`}>
                    {t(`pro.onboarding.langs.${k}`)}
                  </button>
                );
              })}
            </div>
          </Field>
        </Card>

        {err && <div className="rounded-xl bg-coral/10 px-3 py-2 text-xs font-semibold text-coral">{err}</div>}

        <PrimaryButton onClick={submit} disabled={create.isPending}>{create.isPending ? t("pro.onboarding.creating") : t("pro.onboarding.continue")}</PrimaryButton>
        <div className="text-center text-[11px] text-muted-foreground">{t("pro.onboarding.nextDocs")}</div>
      </div>
    </PhoneFrame>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>{children}</label>;
}
