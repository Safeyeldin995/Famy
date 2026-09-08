import { QueryClientProvider } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { createPreviewQueryClient, installPreviewFetchGuard } from "@/lib/preview/createPreviewQueryClient";

export function PreviewShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const hideBanner = pathname === "/preview/splash";
  const qc = useMemo(() => {
    installPreviewFetchGuard();
    return createPreviewQueryClient();
  }, []);

  return (
    <QueryClientProvider client={qc}>
      {!hideBanner ? (
        <div className="brand-hero px-4 py-2 text-center text-[11px] font-bold text-white">
          {t("preview.banner", "Design preview — sample data only, no sign-in required")}
          {" · "}
          <Link to="/preview" className="underline underline-offset-2">
            {t("preview.allScreens", "All screens")}
          </Link>
        </div>
      ) : null}
      {children}
    </QueryClientProvider>
  );
}
