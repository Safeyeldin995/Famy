import { useTranslation } from "react-i18next";
import { SiteLayout, SiteSection } from "@/components/site/SiteLayout";
import { StoreBadges } from "@/components/site/StoreBadges";
import { FamyWordmark } from "@/components/famio/FamyWordmark";
import { PrimaryButton } from "@/components/famio/ui";

/**
 * Public landing for provider share links. Provider details are only readable
 * by signed-in app users, so the web page shows no profile data: it hands the
 * visitor to the app (or the stores) instead.
 */
export function ProviderWebShare({ providerId }: { providerId: string }) {
  const { t } = useTranslation();
  const deepLink = `famy://provider/${encodeURIComponent(providerId)}`;

  return (
    <SiteLayout>
      <SiteSection className="py-14 md:py-20">
        <div className="mx-auto flex max-w-lg flex-col items-center gap-5 rounded-[2rem] border border-border/70 bg-white p-8 text-center shadow-sm">
          <FamyWordmark size="compact" className="!h-10 max-w-[8rem]" />
          <h1 className="text-pro-24 font-extrabold text-balance">
            {t("site.providerShare.title")}
          </h1>
          <p className="text-pro-16 leading-relaxed text-muted-foreground">
            {t("site.providerShare.body")}
          </p>
          <PrimaryButton
            className="min-h-13 w-full"
            onClick={() => {
              window.location.href = deepLink;
            }}
          >
            {t("site.providerShare.cta")}
          </PrimaryButton>
          <StoreBadges className="justify-center" />
        </div>
      </SiteSection>
    </SiteLayout>
  );
}
