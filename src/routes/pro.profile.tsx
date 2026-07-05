import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { ProviderShell } from "@/components/famio/ProviderShell";
import { TopBar, Card, PrimaryButton } from "@/components/famio/ui";
import { supabase } from "@/integrations/supabase/client";
import {
  useMyProvider,
  useUpdateProvider,
  useAllServices,
  useMyProviderServices,
  useToggleProviderService,
} from "@/lib/db/provider-queries";
import { FileText, ShieldCheck, LogOut, Globe, Camera, Loader2 } from "lucide-react";
import { LanguageToggle, useLang } from "@/components/famio/LanguageToggle";



export const Route = createFileRoute("/pro/profile")({ component: ProProfile });

// Matches pro.onboarding.tsx and setup.tsx's area selector (PROV-01 / Sprint 1
// Phase 2 adjustment #2) — Wave 1 launch geography only (BIZ-004).
const CITY_OPTIONS = ["Sheikh Zayed", "6th of October"] as const;

function ProProfile() {
  const { t } = useTranslation();
  const lang = useLang();
  const p = useMyProvider();
  const provider = p.data as any;
  const update = useUpdateProvider();
  const services = useAllServices();
  const mine = useMyProviderServices(provider?.id);
  const toggle = useToggleProviderService();
  const nav = useNavigate();
  const qc = useQueryClient();


  const [bioEn, setBioEn] = useState(""); const [bioAr, setBioAr] = useState("");
  const [years, setYears] = useState<number>(0); const [rate, setRate] = useState<number>(0);
  const [city, setCity] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (provider) {
      setBioEn(provider.bio_en ?? ""); setBioAr(provider.bio_ar ?? "");
      setYears(provider.years_experience ?? 0); setRate(Number(provider.hourly_rate ?? 0));
      setCity(provider.city ?? "");
    }
  }, [provider]);

  // Resolve avatar — stored value is a storage path (private bucket); sign it for display.
  useEffect(() => {
    const v = provider?.profile?.avatar_url as string | undefined;
    if (!v) { setAvatarUrl(null); return; }
    if (v.startsWith("http")) { setAvatarUrl(v); return; }
    let cancelled = false;
    supabase.storage.from("avatars").createSignedUrl(v, 60 * 60).then(({ data }) => {
      if (!cancelled) setAvatarUrl(data?.signedUrl ?? null);
    });
    return () => { cancelled = true; };
  }, [provider?.profile?.avatar_url]);

  const onPickAvatar = async (file: File) => {
    try {
      setUploading(true);
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
    } catch (e: any) {
      toast.error(e?.message ?? t("pro.profile.uploadFailed"));
    } finally {
      setUploading(false);
    }
  };



  if (!provider) return <ProviderShell><div className="p-8 text-center text-sm">{t("pro.common.loading")}</div></ProviderShell>;

  const handleSave = () => update.mutate({ bio_en: bioEn, bio_ar: bioAr, years_experience: years, hourly_rate: rate, city });

  const myIds = new Set((mine.data ?? []).map((s: any) => s.service_id));

  const logout = async () => {
    await qc.cancelQueries(); qc.clear();
    await supabase.auth.signOut();
    nav({ to: "/login", replace: true });
  };


  return (
    <ProviderShell>
      <TopBar title={t("pro.profile.title")} right={<LanguageToggle variant="inline" />} />
      <div className="space-y-5 px-5 pb-6">
        <Card className="flex items-center gap-3 p-4">
          <div className="relative h-16 w-16 shrink-0">
            <img
              src={avatarUrl || `https://i.pravatar.cc/200?u=${provider.id}`}
              alt=""
              className="h-16 w-16 rounded-2xl object-cover"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              aria-label={t("pro.profile.changePhoto")}
              className="absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-full bg-navy text-white shadow-soft ring-2 ring-white active:scale-95 disabled:opacity-60"
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
            <div className="truncate text-base font-extrabold">{provider.profile?.full_name || t("pro.profile.famioUser")}</div>
            <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
              {provider.is_verified ? <><ShieldCheck className="h-3 w-3 text-success" /> {t("pro.profile.verified")}</> : t("pro.profile.verificationPending")}
            </div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="mt-1 text-[11px] font-bold text-navy disabled:opacity-60"
            >
              {uploading ? t("pro.profile.uploading") : t("pro.profile.changePhoto")}
            </button>
          </div>
        </Card>


        {/* About */}
        <div>
          <h2 className="mb-2 px-1 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">{t("pro.profile.about")}</h2>
          <Card className="space-y-3 p-4">
            <Field label={t("pro.onboarding.bioEn")}><textarea value={bioEn} onChange={(e) => setBioEn(e.target.value)} rows={3} className="w-full rounded-xl border border-border bg-surface p-2 text-sm" /></Field>
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
            <PrimaryButton onClick={handleSave} disabled={update.isPending}>{update.isPending ? t("pro.common.saving") : t("pro.common.save")}</PrimaryButton>
            {update.isSuccess && <div className="text-center text-xs font-semibold text-success">{t("pro.common.saved")}</div>}
          </Card>
        </div>

        {/* Services */}
        <div>
          <h2 className="mb-2 px-1 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">{t("pro.profile.servicesOffer")}</h2>
          <Card className="divide-y divide-border">
            {(services.data ?? []).map((s: any) => {
              const on = myIds.has(s.id);
              const sname = lang === "ar" ? (s.name_ar ?? s.name_en) : (s.name_en ?? s.name_ar);
              const cname = lang === "ar" ? (s.category?.name_ar ?? s.category?.name_en) : (s.category?.name_en ?? s.category?.name_ar);
              return (
                <div key={s.id} className="flex items-center justify-between px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{sname}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{cname}</div>
                  </div>
                  <button
                    onClick={() => toggle.mutate({ providerId: provider.id, serviceId: s.id, on: !on })}
                    className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${on ? "bg-navy" : "bg-muted"}`}
                    aria-pressed={on}
                  >
                    <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-soft transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
                  </button>

                </div>
              );
            })}
          </Card>
        </div>

        {/* Links */}
        <div>
          <h2 className="mb-2 px-1 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">{t("pro.profile.more")}</h2>
          <Card className="divide-y divide-border">
            <ProRow to="/pro/documents" icon={<FileText className="h-5 w-5" />} label={t("pro.profile.documentsRow")} />
            <ProRow to="/home" icon={<Globe className="h-5 w-5" />} label={t("pro.profile.switchCustomer")} />
          </Card>
        </div>

        <button onClick={logout} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-surface py-4 text-sm font-bold text-destructive shadow-soft">
          <LogOut className="h-4 w-4" /> {t("pro.profile.signOut")}
        </button>
      </div>
    </ProviderShell>
  );
}


function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>{children}</label>;
}

function ProRow({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link to={to as any} className="flex items-center gap-3 px-4 py-3.5 active:bg-surface-2">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-navy/10 text-navy">{icon}</div>
      <div className="flex-1 text-sm font-bold">{label}</div>
    </Link>
  );
}
