import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AppShell, Avatar, SecondaryButton } from "@/components/famio/ui";
import { CustomerPageHero } from "@/components/famio/CustomerPageHero";
import { CustomerFloatingPanel } from "@/components/famio/CustomerFloatingPanel";
import { LanguageToggle } from "@/components/famio/LanguageToggle";
import { useApp } from "@/lib/store";
import { useMyProfile, useDefaultAddress, useAvatarUrl } from "@/lib/db/queries";
import { setLanguage, currentLang } from "@/lib/i18n";
import { previewPath } from "@/lib/preview/previewPath";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import {
  MapPin,
  CreditCard,
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
  Pencil,
} from "lucide-react";
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
      <CustomerPageHero
        title={t("profile.title")}
        subtitle={t("profile.subtitle")}
        right={<LanguageToggle variant="hero" />}
      />
      <div className="px-5">
        <CustomerFloatingPanel>
          <div className="flex items-center gap-5">
            <div className="relative grid h-20 w-20 place-items-center">
              {avatarQ.data ? (
                <Avatar
                  src={avatarQ.data}
                  className="h-20 w-20 rounded-full object-cover ring-2 ring-brand/15"
                />
              ) : (
                <div className="grid h-20 w-20 place-items-center rounded-full bg-surface-2 text-2xl font-extrabold text-muted-foreground ring-2 ring-border/50">
                  {initial}
                </div>
              )}
              <div className="absolute -bottom-1 -end-1">
                <Link
                  to={previewPath("/setup")}
                  className="focus-ring tap-scale grid h-9 w-9 place-items-center rounded-full border-2 border-surface bg-brand text-brand-foreground shadow-md"
                  aria-label={t("profile.editProfile")}
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
                </Link>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-lg font-extrabold text-foreground">
                {profileQ.data?.full_name || t("profile.famioUser")}
              </div>
              <div className="mt-0.5 truncate text-sm font-bold text-muted-foreground" dir="ltr">
                {profileQ.data?.phone || "—"}
              </div>
            </div>
          </div>
        </CustomerFloatingPanel>
      </div>

      <div className="px-5 pb-6 pt-2">
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
            sub={addressQ.data?.area || t("profile.addAddress")}
          />
          <Row
            icon={<CreditCard className="h-5 w-5" />}
            label={t("profile.payment")}
            sub={t("profile.paymentSub")}
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
            to={previewPath("/notifications")}
            icon={<Bell className="h-5 w-5" />}
            label={t("common.notifications")}
          />
          <Row
            to={previewPath("/notification-preferences")}
            icon={<Bell className="h-5 w-5" />}
            label={t("notifPrefs.title")}
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
                <div className="truncate text-base font-extrabold text-foreground">
                  {t("profile.language")}
                </div>
                <div className="mt-0.5 truncate text-[11px] font-bold text-muted-foreground">
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
          <SecondaryButton className="w-full !h-12 !rounded-full !text-destructive" onClick={handleLogout}>
            <LogOut className="h-4 w-4" aria-hidden="true" />
            {t("profile.logout")}
          </SecondaryButton>
          <button type="button" className="w-full py-3 text-xs font-semibold text-muted-foreground">
            {t("profile.deleteAccount")}
          </button>
        </div>

        <div className="pb-2 pt-6 text-center text-[11px] text-muted-foreground">
          {t("profile.version")}
        </div>
      </div>
    </AppShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-8">
      <h2 className="mb-3 px-1 text-xs font-black uppercase tracking-widest text-muted-foreground">
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
        <div className="truncate text-base font-extrabold text-foreground">{label}</div>
        {sub ? (
          <div className="mt-0.5 truncate text-[11px] font-bold text-muted-foreground">{sub}</div>
        ) : null}
      </div>
      <ChevronRight className="h-5 w-5 text-muted-foreground rtl-flip" strokeWidth={ICON_STROKE} />
    </div>
  );
  if (to)
    return (
      <Link to={to as any} className="block w-full">
        {inner}
      </Link>
    );
  return (
    <button type="button" className="w-full text-start">
      {inner}
    </button>
  );
}
