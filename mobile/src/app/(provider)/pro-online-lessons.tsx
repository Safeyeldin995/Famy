import { useTranslation } from "react-i18next";
import { useMyProvider } from "@/lib/provider/queries";
import { useMyProviderServicesDetailed } from "@/lib/provider/profileQueries";
import { useMyTeachingCapabilities } from "@/lib/provider/teachingQueries";
import { OnlineLessonsSettings } from "@/ui/provider/OnlineLessonsSettings";
import { ProviderHeader } from "@/ui/provider/ProviderHeader";
import { Page, QueryState } from "@/ui/Page";

export default function ProOnlineLessonsScreen() {
  const { t } = useTranslation();
  const providerQ = useMyProvider();
  const provider = providerQ.data as Record<string, unknown> | null | undefined;
  const providerId = provider?.id as string | undefined;
  const servicesQ = useMyProviderServicesDetailed(providerId);
  const capsQ = useMyTeachingCapabilities(providerId);

  return (
    <Page
      title={t("pro.onlineLessons.title")}
      header={<ProviderHeader title={t("pro.onlineLessons.title")} />}
      queries={[providerQ, servicesQ, capsQ]}
    >
      <QueryState query={providerQ}>
        {providerId ? (
          // Wait for the services and teaching subjects: rendering with empty lists showed
          // "no service ready for online yet" until the teacher reloaded the screen.
          <QueryState query={servicesQ}>
            <QueryState query={capsQ}>
              <OnlineLessonsSettings
                providerId={providerId}
                isVerified={!!provider?.is_verified}
                isApproved={provider?.onboarding_status === "APPROVED"}
                offeringMode={provider?.offering_mode as string | undefined}
                services={(servicesQ.data ?? []) as never[]}
                capabilities={(capsQ.data ?? []) as never[]}
              />
            </QueryState>
          </QueryState>
        ) : null}
      </QueryState>
    </Page>
  );
}
