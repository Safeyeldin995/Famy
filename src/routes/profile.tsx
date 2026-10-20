import { customerAreaLabel } from "@/components/famio/customerAreaLabel";
import { CustomerProfilePhoto } from "@/components/famio/CustomerProfilePhoto";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AppShell, SecondaryButton } from "@/components/famio/ui";
import { CustomerPageHeader } from "@/components/famio/CustomerPageHeader";
import { LanguageToggle } from "@/components/famio/LanguageToggle";
import { useApp } from "@/lib/store";
import { useMyProfile, useDefaultAddress } from "@/lib/db/queries";
import { setLanguage, currentLang } from "@/lib/i18n";
import { previewPath } from "@/lib/preview/previewPath";
import { supabase } from "@/integrations/supabase/client";
import { AuthGate } from "@/components/famio/AuthGate";
import { useQueryClient } from "@tanstack/react-query";
import {
  MapPin,
  Users,
  Bell,
  Globe,
  HelpCircle,
  FileText,
  Shield,
  LogOut,
  ChevronRight,
  Heart,
  Tag,
} from "lucide-react";
import { ICON_STROKE } from "@/lib/icons/constants";

export const Route = createFileRoute("/profile")({ component: ProfileRoute });

function ProfileRoute() {
  return (
    <AuthGate>
      <Profile />
    </AuthGate>
  );
}

function Profile() {
  const { reset } = useApp();
  const profileQ = useMyProfile();
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
      <CustomerPageHeader
        title={t("profile.title")}
        subtitle={t("profile.subtitle")}
        right={<LanguageToggle variant="pill" />}
      />
      <div className="px-5">
        <div className="mt-4 rounded-2xl border border-border/60 bg-white p-4">
          <div className="flex items-center gap-5">
            <CustomerProfilePhoto
              src={profileQ.data?.avatar_url}
              name={profileQ.data?.full_name || t("profile.famioUser")}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-pro-18 font-extrabold text-foreground">
                {profileQ.data?.full_name || t("profile.famioUser")}
              </div>
              <div
                className="mt-0.5 truncate text-pro-14 font-bold text-muted-foreground"
                dir="ltr"
              >
                {profileQ.data?.phone || "—"}
              </div>
              <Link
                to={previewPath("/setup")}
                className="focus-ring inline-flex min-h-11 items-center text-pro-13 font-bold text-brand"
              >
                {t("customerHome.profileEdit")}
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="px-5 pb-6 pt-4">
        <Section title={t("profile.myFamio")}>
          <Row
            to={previewPath("/favorites")}
            icon={<Heart className="h-5 w-5" />}
            label={t("profile.favorites")}
          />
          <Row
            to={previewPath("/promo-codes")}
            icon={<Tag className="h-5 w-5" />}
            label={t("profile.promoCodes")}
            sub={t("profile.promoCodesSub")}
          />
          <Row
            to={previewPath("/addresses")}
            icon={<MapPin className="h-5 w-5" />}
            label={t("profile.addresses")}
            sub={
              addressQ.data?.area
                ? customerAreaLabel(addressQ.data.area, t)
                : t("profile.addAddress")
            }
          />
          <Row
            to={previewPath("/family-members")}
            icon={<Users className="h-5 w-5" />}
            label={t("profile.family")}
            sub={t("profile.familySub")}
          />
        </Section>

        <Section title={t("profile.preferences")}>
          <Row
            to={previewPath("/notification-preferences")}
            icon={<Bell className="h-5 w-5" />}
            label={t("common.notifications")}
            sub={t("notifPrefs.title")}
          />
          <button
            type="button"
            onClick={() => setLanguage(lang === "ar" ? "en" : "ar")}
            className="w-full text-start"
          >
            <div className="flex items-center gap-4 px-5 py-4 active:bg-surface-2">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand/8 text-brand">
                <Globe className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-pro-16 font-extrabold text-foreground">
                  {t("profile.language")}
                </div>
                <div className="mt-0.5 truncate text-pro-12 font-bold text-muted-foreground">
                  {lang === "ar" ? t("common.arabic") : t("common.english")}
                </div>
              </div>
              <ChevronRight
                className="h-4 w-4 text-muted-foreground rtl-flip"
                strokeWidth={ICON_STROKE}
                aria-hidden="true"
              />
            </div>
          </button>
        </Section>

        <Section title={t("profile.support")}>
          <Row
            to={previewPath("/help")}
            icon={<HelpCircle className="h-5 w-5" />}
            label={t("profile.help")}
          />
          <Row
            to="/content/terms"
            icon={<FileText className="h-5 w-5" />}
            label={t("profile.terms")}
          />
          <Row
            to="/content/privacy"
            icon={<Shield className="h-5 w-5" />}
            label={t("profile.privacy")}
          />
        </Section>

        <div className="mt-6 space-y-2">
          <SecondaryButton
            className="w-full !h-12 !rounded-full !text-destructive"
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            {t("profile.logout")}
          </SecondaryButton>
          <Link
            to={previewPath("/help")}
            className="focus-ring flex min-h-11 w-full items-center justify-center py-3 text-pro-12 font-semibold text-muted-foreground"
          >
            {t("customerRound2.deleteHelp")}
          </Link>
        </div>
      </div>
    </AppShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-8">
      <h2 className="mb-3 px-1 text-pro-12 font-black uppercase tracking-widest text-muted-foreground">
        {title}
      </h2>
      <div className="overflow-hidden rounded-[1.75rem] border border-border/50 bg-surface-elevated shadow-sm divide-y divide-border/50">
        {children}
      </div>
    </div>
  );
}

function Row({
  icon,
  label,
  sub,
  to,
}: {
  icon: React.ReactNode;
  label: string;
  sub?: string;
  to?: string;
}) {
  const inner = (
    <div className="focus-ring tap-scale flex items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-2">
      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand/8 text-brand">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-pro-16 font-extrabold text-foreground">{label}</div>
        {sub ? (
          <div className="mt-0.5 truncate text-pro-12 font-bold text-muted-foreground">{sub}</div>
        ) : null}
      </div>
      {to && (
        <ChevronRight
          className="h-5 w-5 text-muted-foreground rtl-flip"
          strokeWidth={ICON_STROKE}
        />
      )}
    </div>
  );
  if (to)
    return (
      <Link to={to as any} className="block w-full">
        {inner}
      </Link>
    );
  return <div className="w-full text-start">{inner}</div>;
}
