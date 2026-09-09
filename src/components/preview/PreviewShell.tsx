import { QueryClientProvider } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, LayoutGrid } from "lucide-react";
import { createPreviewQueryClient, installPreviewFetchGuard } from "@/lib/preview/createPreviewQueryClient";
import { PREVIEW_FULL_BLEED_PREFIXES } from "@/lib/preview/previewScreens";
import { ICON_STROKE_BOLD } from "@/lib/icons/constants";

function isHubIndex(pathname: string) {
  return pathname === "/preview" || pathname === "/preview/";
}

export function PreviewShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const fullBleed = PREVIEW_FULL_BLEED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  const showBanner = !fullBleed;
  const showFloatingHub = !isHubIndex(pathname);

  const qc = useMemo(() => {
    installPreviewFetchGuard();
    return createPreviewQueryClient();
  }, []);

  return (
    <QueryClientProvider client={qc}>
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
        {showBanner ? (
          <div className="brand-hero shrink-0 px-4 py-2 text-center text-[11px] font-bold text-white">
            {t("preview.banner", "Design preview — sample data only, no sign-in required")}
            {" · "}
            <Link to="/preview" className="underline underline-offset-2">
              {t("preview.allScreens", "All screens")}
            </Link>
          </div>
        ) : null}

        {showFloatingHub ? (
          <Link
            to="/preview"
            className="safe-bottom fixed end-4 bottom-4 z-[120] inline-flex items-center gap-2 rounded-full border border-brand/20 bg-surface-elevated px-4 py-3 text-xs font-extrabold text-foreground shadow-[0_12px_28px_-12px_rgba(0,0,0,0.35)]"
            aria-label={t("preview.hubTitle", "Famy design preview")}
          >
            <LayoutGrid className="h-4 w-4 text-brand" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />
            {t("preview.hubShort", "Hub")}
          </Link>
        ) : null}

        {showFloatingHub && fullBleed ? (
          <Link
            to="/preview"
            className="safe-top fixed start-4 top-2 z-[120] inline-flex items-center gap-1 rounded-full border border-white/30 bg-black/25 px-3 py-2 text-[11px] font-extrabold text-white backdrop-blur-sm"
          >
            <ChevronLeft className="h-3.5 w-3.5 rtl-flip" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />
            {t("preview.allScreens", "All screens")}
          </Link>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </QueryClientProvider>
  );
}
