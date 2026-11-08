import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { SiteLayout, SiteSection } from "@/components/site/SiteLayout";
import { PrimaryButton } from "@/components/famio/ui";

/** Paymob card redirect — deep-link back into the mobile app; no booking fetch. */
export function PaymobAppReturn({ bookingId }: { bookingId: string }) {
  const { t } = useTranslation();
  const deepLink = `famy://booking/${bookingId}`;

  useEffect(() => {
    window.location.href = deepLink;
  }, [deepLink]);

  return (
    <SiteLayout>
      <SiteSection className="flex min-h-[60vh] flex-col items-center justify-center gap-6 py-20 text-center">
        <h1 className="text-pro-28 font-extrabold text-balance">{t("site.paymobReturn.title")}</h1>
        <p className="max-w-md text-pro-16 leading-relaxed text-muted-foreground">
          {t("site.paymobReturn.body")}
        </p>
        <PrimaryButton
          className="min-h-13 px-8"
          onClick={() => {
            window.location.href = deepLink;
          }}
        >
          {t("site.paymobReturn.cta")}
        </PrimaryButton>
      </SiteSection>
    </SiteLayout>
  );
}
