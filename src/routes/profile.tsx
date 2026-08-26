import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AppShell, Avatar, SecondaryButton } from "@/components/famio/ui";
import { LanguageToggle } from "@/components/famio/LanguageToggle";
import { useApp } from "@/lib/store";
import { useMyProfile, useDefaultAddress, useAvatarUrl } from "@/lib/db/queries";
import { setLanguage, currentLang } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { MapPin, CreditCard, Users, Bell, Globe, HelpCircle, FileText, Shield, LogOut, ChevronRight, Heart, Tag } from "lucide-react";
import { ICON_STROKE } from "@/lib/icons/constants";

export const Route = createFileRoute("/profile")({ component: Profile });

function Profile() {
  const { reset } = useApp();
  const profileQ = useMyProfile();
  const avatarQ = useAvatarUrl(profileQ.data?.avatar_url as string | undefined);
  const addressQ = useDefaultAddress();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const lang = currentLang();

  const handleLogout = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    reset();
    nav({ to: "/", replace: true });
  };

  const initial = profileQ.data?.full_name?.charAt(0).toUpperCase() || t("common.appInitial");

  return (
    <AppShell>
      <div className="safe-top px-5 pb-6 pt-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">{t("profile.title")}</h1>
          <LanguageToggle variant="inline" />
        </div>
        <div className="mt-8 flex items-center gap-5">
          <div className="relative grid h-24 w-24 place-items-center">
            {avatarQ.data ? (
              <Avatar src={avatarQ.data} className="h-24 w-24 rounded-full ring-4 ring-background shadow-md object-cover" />
            ) : (
              <div className="grid h-24 w-24 place-items-center rounded-full bg-surface-2 text-3xl font-extrabold ring-4 ring-background shadow-md text-muted-foreground">
                {initial}
              </div>
            )}
            <div className="absolute -bottom-2 -right-2">
              <Link to="/setup" className="focus-ring tap-scale grid h-10 w-10 place-items-center rounded-full bg-brand text-brand-foreground shadow-md border-2 border-background">
                <FileText className="h-4 w-4" strokeWidth={2.5} />
              </Link>
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xl font-extrabold text-foreground">{profileQ.data?.full_name || t("profile.famioUser")}</div>
            <div className="truncate text-sm font-bold text-muted-foreground mt-0.5" dir="ltr">{profileQ.data?.phone || "—"}</div>
          </div>
        </div>
      </div>

      <div className="px-5 pb-6">
        <Section title={t("profile.myFamio")}>
          <Row to="/favorites" icon={<Heart className="h-5 w-5" />} label={t("profile.favorites")} />
          <Row to="/promo-codes" icon={<Tag className="h-5 w-5" />} label={t("profile.promoCodes")} sub={t("profile.promoCodesSub")} />
          <Row to="/addresses" icon={<MapPin className="h-5 w-5" />} label={t("profile.addresses")} sub={addressQ.data?.area || t("profile.addAddress")} />
          <Row icon={<CreditCard className="h-5 w-5" />} label={t("profile.payment")} sub={t("profile.paymentSub")} />
          <Row to="/family-members" icon={<Users className="h-5 w-5" />} label={t("profile.family")} sub={t("profile.familySub")} />
        </Section>

        <Section title={t("profile.preferences")}>
          <Row to="/notifications" icon={<Bell className="h-5 w-5" />} label={t("common.notifications")} />
          <Row to="/notification-preferences" icon={<Bell className="h-5 w-5" />} label={t("notifPrefs.title")} />
          <button type="button" onClick={() => setLanguage(lang === "ar" ? "en" : "ar")} className="w-full text-start">
            <div className="flex items-center gap-3 px-4 py-3.5 active:bg-surface-2">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand">
                <Globe className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{t("profile.language")}</div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {lang === "ar" ? t("common.arabic") : t("common.english")}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground rtl-flip" strokeWidth={ICON_STROKE} />
            </div>
          </button>
        </Section>

        <Section title={t("profile.support")}>
          <Row to="/help" icon={<HelpCircle className="h-5 w-5" />} label={t("profile.help")} />
          <Row to="/content/terms" icon={<FileText className="h-5 w-5" />} label={t("profile.terms")} />
          <Row to="/content/privacy" icon={<Shield className="h-5 w-5" />} label={t("profile.privacy")} />
        </Section>

        <div className="mt-6 space-y-2">
          <SecondaryButton className="w-full !h-12 !text-destructive" onClick={handleLogout}>
            <LogOut className="h-4 w-4" /> {t("profile.logout")}
          </SecondaryButton>
          <button type="button" className="w-full py-3 text-xs font-semibold text-muted-foreground">{t("profile.deleteAccount")}</button>
        </div>

        <div className="pt-6 pb-2 text-center text-[11px] text-muted-foreground">{t("profile.version")}</div>
      </div>
    </AppShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-8">
      <h2 className="mb-3 px-1 text-xs font-black uppercase tracking-widest text-muted-foreground">{title}</h2>
      <div className="rounded-[2rem] bg-surface-elevated shadow-sm border border-border/40 overflow-hidden divide-y divide-border/50">{children}</div>
    </div>
  );
}

function Row({ icon, label, sub, to }: { icon: React.ReactNode; label: string; sub?: string; to?: string }) {
  const inner = (
    <div className="focus-ring tap-scale flex items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-2">
      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-surface text-foreground shadow-sm border border-border/40">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-extrabold text-foreground">{label}</div>
        {sub ? <div className="truncate text-[11px] font-bold text-muted-foreground mt-0.5">{sub}</div> : null}
      </div>
      <ChevronRight className="h-5 w-5 text-muted-foreground rtl-flip" strokeWidth={ICON_STROKE} />
    </div>
  );
  if (to) return <Link to={to as any} className="block w-full">{inner}</Link>;
  return <button type="button" className="w-full text-start">{inner}</button>;
}
