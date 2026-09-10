import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PhoneFrame } from "@/components/famio/ui";
import { ArrowRight, Sparkles } from "lucide-react";
import { ICON_STROKE_BOLD } from "@/lib/icons/constants";
import { PREVIEW_FEATURED, PREVIEW_SCREEN_GROUPS, type PreviewScreen } from "@/lib/preview/previewScreens";

export const Route = createFileRoute("/preview/")({
  component: PreviewHub,
});

function PreviewScreenLink({
  screen,
  featured = false,
}: {
  screen: PreviewScreen;
  featured?: boolean;
}) {
  const { t } = useTranslation();
  const title = t(screen.labelKey, screen.fallback);
  const description = screen.descriptionFallback
    ? t(screen.descriptionKey ?? screen.labelKey, {
        defaultValue: screen.descriptionFallback,
      })
    : undefined;
  const badgeLabel =
    screen.badge === "new"
      ? t("preview.badgeNew", "New")
      : screen.badge === "updated"
        ? t("preview.badgeUpdated", "Updated")
        : null;

  return (
    <Link
      to={screen.to as "/preview/home"}
      className={`focus-ring tap-scale flex items-center justify-between gap-3 rounded-[1.5rem] border px-4 py-4 shadow-sm ${
        featured
          ? "border-brand/30 bg-brand/[0.06]"
          : "border-border/50 bg-surface-elevated"
      }`}
    >
      <div className="min-w-0 text-start">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-extrabold text-foreground">{title}</span>
          {badgeLabel ? (
            <span className="rounded-full bg-brand px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-brand-foreground">
              {badgeLabel}
            </span>
          ) : null}
        </div>
        {description ? (
          <span className="mt-0.5 block text-xs font-semibold text-muted-foreground">{description}</span>
        ) : null}
      </div>
      <ArrowRight
        className="h-4 w-4 shrink-0 text-brand rtl-flip"
        strokeWidth={ICON_STROKE_BOLD}
        aria-hidden="true"
      />
    </Link>
  );
}

function PreviewHub() {
  const { t } = useTranslation();

  return (
    <PhoneFrame bg="bg-background">
      <header className="brand-hero safe-top shrink-0 px-5 pb-8 pt-4">
        <h1 className="text-[1.75rem] font-extrabold leading-tight text-white">
          {t("preview.hubTitle", "Famy design preview")}
        </h1>
        <p className="mt-2 text-sm font-medium text-white/75">
          {t("preview.hubBody", "Tap any screen below. No sign-in or OTP needed.")}
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-5 pb-10 pt-4">
        <section className="mb-8">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-brand" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />
            <h2 className="text-xs font-extrabold uppercase tracking-wider text-brand">
              {t("preview.featured", "Start here")}
            </h2>
          </div>
          <ul className="space-y-2">
            {PREVIEW_FEATURED.map((screen) => (
              <li key={screen.to}>
                <PreviewScreenLink screen={screen} featured />
              </li>
            ))}
          </ul>
        </section>

        {PREVIEW_SCREEN_GROUPS.map((group) => (
          <section key={group.titleKey} className="mb-8">
            <h2 className="mb-3 text-xs font-extrabold uppercase tracking-wider text-muted-foreground">
              {t(group.titleKey, group.titleFallback)}
            </h2>
            <ul className="space-y-2">
              {group.screens.map((screen) => (
                <li key={screen.to}>
                  <PreviewScreenLink screen={screen} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </PhoneFrame>
  );
}
