import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PhoneFrame } from "@/components/famio/ui";
import { ArrowRight } from "lucide-react";
import { ICON_STROKE_BOLD } from "@/lib/icons/constants";
import { PREVIEW_SCREEN_GROUPS } from "@/lib/preview/previewScreens";

export const Route = createFileRoute("/preview/")({
  component: PreviewHub,
});

function PreviewHub() {
  const { t } = useTranslation();

  return (
    <PhoneFrame bg="bg-background">
      <header className="brand-hero safe-top px-5 pb-8 pt-4">
        <h1 className="text-[1.75rem] font-extrabold leading-tight text-white">
          {t("preview.hubTitle", "Famy design preview")}
        </h1>
        <p className="mt-2 text-sm font-medium text-white/75">
          {t("preview.hubBody", "Tap any screen below. No sign-in or OTP needed.")}
        </p>
      </header>

      <div className="flex-1 overflow-y-auto px-5 pb-10 pt-2">
        {PREVIEW_SCREEN_GROUPS.map((group) => (
          <section key={group.titleKey} className="mb-8">
            <h2 className="mb-3 text-xs font-extrabold uppercase tracking-wider text-muted-foreground">
              {t(group.titleKey, group.titleFallback)}
            </h2>
            <ul className="space-y-2">
              {group.screens.map((screen) => (
                <li key={screen.to}>
                  <Link
                    to={screen.to as "/preview/home"}
                    className="focus-ring tap-scale flex items-center justify-between rounded-[1.5rem] border border-border/50 bg-surface-elevated px-4 py-4 shadow-sm"
                  >
                    <span className="text-sm font-extrabold text-foreground">
                      {t(screen.labelKey, screen.fallback ?? screen.labelKey)}
                    </span>
                    <ArrowRight
                      className="h-4 w-4 shrink-0 text-brand rtl-flip"
                      strokeWidth={ICON_STROKE_BOLD}
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </PhoneFrame>
  );
}
