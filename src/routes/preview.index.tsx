import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PhoneFrame } from "@/components/famio/ui";
import { ArrowRight } from "lucide-react";
import { ICON_STROKE_BOLD } from "@/lib/icons/constants";

export const Route = createFileRoute("/preview/")({
  component: PreviewHub,
});

const SCREENS = [
  { to: "/preview/home", labelKey: "nav.home" },
  { to: "/preview/search", labelKey: "search.title" },
  { to: "/preview/category/home-cleaning", labelKey: "categories.homeTitle" },
  { to: "/preview/bookings", labelKey: "bookings.title" },
  { to: "/preview/messages", labelKey: "messages.title" },
  { to: "/preview/chat/conv-1", labelKey: "messages.title" },
  { to: "/preview/profile", labelKey: "profile.title" },
  { to: "/preview/favorites", labelKey: "profile.favorites" },
  { to: "/preview/addresses", labelKey: "addresses.title" },
  { to: "/preview/notifications", labelKey: "common.notifications" },
  { to: "/preview/help", labelKey: "helpC.title" },
  { to: "/preview/promo-codes", labelKey: "promoCodes.title" },
  { to: "/preview/provider/p1", labelKey: "providerProfile.about" },
] as const;

function PreviewHub() {
  const { t } = useTranslation();

  return (
    <PhoneFrame bg="bg-background">
      <header className="brand-hero safe-top px-5 pb-10 pt-4">
        <h1 className="text-[1.75rem] font-extrabold leading-tight text-white">
          {t("preview.hubTitle", "Famy design preview")}
        </h1>
        <p className="mt-2 text-sm font-medium text-white/75">
          {t("preview.hubBody", "Tap any screen below. No sign-in or OTP needed.")}
        </p>
      </header>

      <ul className="space-y-2 px-5 pb-10 pt-4">
        {SCREENS.map((screen) => (
          <li key={screen.to}>
            <Link
              to={screen.to as "/preview/home"}
              className="focus-ring tap-scale flex items-center justify-between rounded-[1.5rem] border border-border/50 bg-surface-elevated px-4 py-4 shadow-sm"
            >
              <span className="text-sm font-extrabold text-foreground">{t(screen.labelKey)}</span>
              <ArrowRight className="h-4 w-4 text-brand rtl-flip" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </PhoneFrame>
  );
}
