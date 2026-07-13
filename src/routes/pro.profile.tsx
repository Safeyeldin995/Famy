import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { ProviderShell } from "@/components/famio/ProviderShell";
import { TopBar, Card, PrimaryButton, Avatar } from "@/components/famio/ui";
import { supabase } from "@/integrations/supabase/client";
import { useAvatarUrl } from "@/lib/db/queries";
import { useServiceAreasSettings } from "@/lib/db/settings-queries";
import {
  useMyProvider,
  useUpdateProvider,
  useAllServices,
  useMyProviderServices,
  useToggleProviderService,
  useSetProviderPrice,
} from "@/lib/db/provider-queries";
import { FileText, ShieldCheck, LogOut, Globe, Camera, Loader2 } from "lucide-react";
import { LanguageToggle, useLang } from "@/components/famio/LanguageToggle";



export const Route = createFileRoute("/pro/profile")({ component: ProProfile });

// Real city/area options now come from the shared useServiceAreasSettings()
// source (also used by setup.tsx and pro.onboarding.tsx).

function ProProfile() {
  const { t } = useTranslation();
  const lang = useLang();
  const p = useMyProvider();
  const provider = p.data as any;
  const update = useUpdateProvider();
  const services = useAllServices();
  const mine = useMyProviderServices(provider?.id);
  const toggle = useToggleProviderService();
  const setPrice = useSetProviderPrice();
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [priceErrors, setPriceErrors] = useState<Record<string, string>>({});
  const nav = useNavigate();
  const qc = useQueryClient();


  const [bioEn, setBioEn] = useState(""); const [bioAr, setBioAr] = useState("");
  const [years, setYears] = useState<number>(0); const [rate, setRate] = useState<number>(0);
  const [city, setCity] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const avatarQ = useAvatarUrl(provider?.profile?.avatar_url as string | undefined);
  const areasQ = useServiceAreasSettings();
  const cityOptions = (areasQ.data ?? []).filter((a) => a.enabled).map((a) => a.name);

  useEffect(() => {
    if (provider) {
      setBioEn(provider.bio_en ?? ""); setBioAr(provider.bio_ar ?? "");
      setYears(provider.years_experience ?? 0); setRate(Number(provider.hourly_rate ?? 0));
      setCity(provider.city ?? "");
    }
  }, [provider]);

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
  // Already-assigned services that admin has since deactivated: excluded
  // from `services` (useAllServices only lists active ones, so the
  // provider can never newly select or reactivate one), but the
  // provider_services row itself is never deleted — surface it here,
  // read-only, so the provider can see why it's no longer bookable.
  const inactiveMine = (mine.data ?? []).filter((s: any) => s.service && s.service.is_active === false);

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
            <Avatar
              src={avatarQ.data || `https://i.pravatar.cc/200?u=${provider.id}`}
              alt=""
              className="h-16 w-16 rounded-2xl"
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
                {cityOptions.map((c) => (
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
              const currentOverride = myPriceOverride.get(s.id);
              const priceError = priceErrors[s.id];
              return (
                <div key={s.id} className="px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <div className="text-sm font-semibold truncate">{sname}</div>
                        {on && myStatus.get(s.id) === "pending" && (
                          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">{t("pro.profile.servicePending")}</span>
                        )}
                        {on && myStatus.get(s.id) === "rejected" && (
                          <span className="shrink-0 rounded-full bg-coral/15 px-2 py-0.5 text-[10px] font-bold text-coral">{t("pro.profile.serviceRejected")}</span>
                        )}
                      </div>
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

                  {on && s.provider_pricing_allowed && (
                    <div className="mt-2 flex items-center gap-2">
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
                        className="rounded-lg bg-navy px-3 py-1.5 text-[11px] font-bold text-navy-foreground disabled:opacity-50"
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
                </div>
              );
            })}
            {inactiveMine.map((s: any) => {
              const sname = lang === "ar" ? (s.service.name_ar ?? s.service.name_en) : (s.service.name_en ?? s.service.name_ar);
              const cname = lang === "ar" ? (s.service.category?.name_ar ?? s.service.category?.name_en) : (s.service.category?.name_en ?? s.service.category?.name_ar);
              return (
                <div key={s.service_id} className="flex items-center justify-between px-4 py-3 opacity-60">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{sname}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{cname}</div>
                  </div>
                  <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[10px] font-bold uppercase text-muted-foreground">
                    {t("pro.profile.serviceUnavailable")}
                  </span>
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
