import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AppShell, TopBar, Card, Avatar } from "@/components/famio/ui";
import { LanguageToggle } from "@/components/famio/LanguageToggle";
import { useApp } from "@/lib/store";
import { useMyProfile, useDefaultAddress, useAvatarUrl } from "@/lib/db/queries";
import { setLanguage, currentLang } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { MapPin, CreditCard, Users, Bell, Globe, HelpCircle, FileText, Shield, LogOut, ChevronRight, Heart } from "lucide-react";

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

  return (
    <AppShell>
      <TopBar title={t("profile.title")} right={<LanguageToggle />} />
      <div className="px-5">
        <Card className="p-5">
          <div className="flex items-center gap-4">
            {avatarQ.data ? (
              <Avatar src={avatarQ.data} className="h-16 w-16 shrink-0 rounded-2xl" />
            ) : (
              <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-navy text-2xl font-extrabold text-navy-foreground">
                {profileQ.data?.full_name ? profileQ.data.full_name.charAt(0).toUpperCase() : "F"}
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate text-lg font-extrabold">{profileQ.data?.full_name || t("profile.famioUser")}</div>
              <div className="truncate text-xs text-muted-foreground" dir="ltr">{profileQ.data?.phone || "—"}</div>
              <Link to="/setup" className="mt-1.5 inline-block text-xs font-bold text-navy">{t("profile.editProfile")}</Link>
            </div>
          </div>
        </Card>

        <Section title={t("profile.myFamio")}>
          <Row to="/favorites" icon={<Heart className="h-5 w-5" />} label={t("profile.favorites")} />
          <Row to="/setup" icon={<MapPin className="h-5 w-5" />} label={t("profile.addresses")} sub={addressQ.data?.area || t("profile.addAddress")} />
          <Row icon={<CreditCard className="h-5 w-5" />} label={t("profile.payment")} sub={t("profile.paymentSub")} />
          <Row icon={<Users className="h-5 w-5" />} label={t("profile.family")} sub={t("profile.familySub")} />
        </Section>

        <Section title={t("profile.preferences")}>
          <Row icon={<Bell className="h-5 w-5" />} label={t("common.notifications")} />
          <button
            onClick={() => setLanguage(lang === "ar" ? "en" : "ar")}
            className="w-full text-start"
          >
            <div className="flex items-center gap-3 px-4 py-3.5 active:bg-surface-2">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-navy/10 text-navy">
                <Globe className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{t("profile.language")}</div>
                <div className="truncate text-[11px] text-muted-foreground">{lang === "ar" ? "العربية" : "English"}</div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground rtl-flip" />
            </div>
          </button>
        </Section>

        <Section title={t("profile.support")}>
          <Row to="/help" icon={<HelpCircle className="h-5 w-5" />} label={t("profile.help")} />
          <Row to="/content/terms" icon={<FileText className="h-5 w-5" />} label={t("profile.terms")} />
          <Row to="/content/privacy" icon={<Shield className="h-5 w-5" />} label={t("profile.privacy")} />
        </Section>

        <div className="mt-6 space-y-2">
          <button
            onClick={handleLogout}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-surface py-4 text-sm font-bold text-destructive shadow-soft"
          >
            <LogOut className="h-4 w-4" /> {t("profile.logout")}
          </button>
          <button className="w-full py-3 text-xs font-semibold text-muted-foreground">{t("profile.deleteAccount")}</button>
        </div>

        <div className="pt-6 pb-2 text-center text-[11px] text-muted-foreground">{t("profile.version")}</div>
      </div>
    </AppShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <h2 className="mb-2 px-1 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">{title}</h2>
      <div className="divide-y divide-border rounded-3xl bg-surface shadow-soft">{children}</div>
    </div>
  );
}

function Row({ icon, label, sub, to }: { icon: React.ReactNode; label: string; sub?: string; to?: string }) {
  const inner = (
    <div className="flex items-center gap-3 px-4 py-3.5 active:bg-surface-2">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-navy/10 text-navy">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold">{label}</div>
        {sub && <div className="truncate text-[11px] text-muted-foreground">{sub}</div>}
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground rtl-flip" />
    </div>
  );
  if (to) return <Link to={to as any} className="block w-full">{inner}</Link>;
  return <button className="w-full text-start">{inner}</button>;
}
