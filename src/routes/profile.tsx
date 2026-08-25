import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AppShell, TopBar, Card, Avatar, SecondaryButton } from "@/components/famio/ui";
import { LanguageToggle } from "@/components/famio/LanguageToggle";
import { useApp } from "@/lib/store";
import { useMyProfile, useDefaultAddress, useAvatarUrl } from "@/lib/db/queries";
import { setLanguage, currentLang } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { MapPin, CreditCard, Users, Bell, Globe, HelpCircle, FileText, Shield, LogOut, ChevronRight, Heart } from "lucide-react";
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
      <TopBar title={t("profile.title")} right={<LanguageToggle />} />
      <div className="px-5">
        <Card className="overflow-hidden p-0">
          <div className="home-ink-panel px-5 py-5 text-ink-foreground">
            <div className="flex items-center gap-4">
              {avatarQ.data ? (
                <Avatar src={avatarQ.data} className="h-16 w-16 shrink-0 rounded-2xl ring-2 ring-white/20" />
              ) : (
                <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-white/15 text-2xl font-extrabold ring-2 ring-white/20">
                  {initial}
                </div>
              )}
              <div className="min-w-0">
                <div className="truncate text-lg font-extrabold">{profileQ.data?.full_name || t("profile.famioUser")}</div>
                <div className="truncate text-xs text-white/70" dir="ltr">{profileQ.data?.phone || "—"}</div>
                <Link to="/setup" className="mt-2 inline-block text-xs font-bold text-brand">
                  {t("profile.editProfile")}
                </Link>
              </div>
            </div>
          </div>
        </Card>

        <Section title={t("profile.myFamio")}>
          <Row to="/favorites" icon={<Heart className="h-5 w-5" />} label={t("profile.favorites")} />
          <Row to="/addresses" icon={<MapPin className="h-5 w-5" />} label={t("profile.addresses")} sub={addressQ.data?.area || t("profile.addAddress")} />
          <Row icon={<CreditCard className="h-5 w-5" />} label={t("profile.payment")} sub={t("profile.paymentSub")} />
          <Row to="/family-members" icon={<Users className="h-5 w-5" />} label={t("profile.family")} sub={t("profile.familySub")} />
        </Section>

        <Section title={t("profile.preferences")}>
          <Row to="/notifications" icon={<Bell className="h-5 w-5" />} label={t("common.notifications")} />
          <Row to="/notification-preferences" icon={<Bell className="h-5 w-5" />} label={t("notifPrefs.title")} />
          <button type="button" onClick={() => setLanguage(lang === "ar" ? "en" : "ar")} className="w-full text-start">
            <div className="flex items-center gap-3 px-4 py-3.5 active:bg-surface-2">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink/10 text-ink">
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
    <div className="mt-6">
      <h2 className="text-overline mb-2 px-1">{title}</h2>
      <div className="surface-card divide-y divide-border overflow-hidden">{children}</div>
    </div>
  );
}

function Row({ icon, label, sub, to }: { icon: React.ReactNode; label: string; sub?: string; to?: string }) {
  const inner = (
    <div className="flex items-center gap-3 px-4 py-3.5 active:bg-surface-2">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink/10 text-ink">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold">{label}</div>
        {sub ? <div className="truncate text-[11px] text-muted-foreground">{sub}</div> : null}
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground rtl-flip" strokeWidth={ICON_STROKE} />
    </div>
  );
  if (to) return <Link to={to as any} className="block w-full">{inner}</Link>;
  return <button type="button" className="w-full text-start">{inner}</button>;
}
