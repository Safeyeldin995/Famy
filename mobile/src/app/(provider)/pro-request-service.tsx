import { useLocalSearchParams, router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useMemo, useState } from "react";
import { useAllServices, useMyProviderServicesDetailed, useProviderRequestService } from "@/lib/provider/profileQueries";
import { useMyProvider } from "@/lib/provider/queries";
import { isPriceInRange } from "@shared/provider/priceOptions";
import { isTutoringCategorySlug } from "@/lib/tutoring/teachingCapabilities";
import { localized } from "@/lib/presentation";
import { Page, QueryState, ActionError } from "@/ui/Page";
import { ProviderHeader } from "@/ui/provider/ProviderHeader";
import { ProviderPriceStepper } from "@/ui/provider/ProviderPriceStepper";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";

export default function ProRequestServiceScreen() {
  const { serviceId } = useLocalSearchParams<{ serviceId: string }>();
  const { t, i18n } = useTranslation();
  const providerQ = useMyProvider();
  const servicesQ = useAllServices();
  const mineQ = useMyProviderServicesDetailed(providerQ.data?.id as string | undefined);
  const submit = useProviderRequestService();
  const [price, setPrice] = useState<number | null>(null);
  const [error, setError] = useState(false);

  const service = useMemo(
    () => (servicesQ.data ?? []).find((row) => String(row.id) === serviceId),
    [servicesQ.data, serviceId],
  );
  const tutoring = isTutoringCategorySlug((service?.category as { slug?: string })?.slug);

  return (
    <Page
      title={t("pro.serviceRequest.pageTitle")}
      header={<ProviderHeader title={t("pro.serviceRequest.pageTitle")} />}
      queries={[providerQ, servicesQ]}
    >
      <QueryState query={providerQ}>
        {providerQ.data?.onboarding_status !== "APPROVED" ? (
          <Text>{t("pro.serviceRequest.notApproved")}</Text>
        ) : tutoring ? (
          <Text tone="muted">{t("pro.serviceRequest.teachingIncomplete")}</Text>
        ) : service ? (
          <>
            <Text weight="bold">{localized(service, i18n.language)}</Text>
            <Text tone="muted">
              {t("pro.serviceRequest.intro", { service: localized(service, i18n.language) })}
            </Text>
            {service.provider_pricing_allowed ? (
              <ProviderPriceStepper
                min={service.minimum_price as number | null}
                max={service.maximum_price as number | null}
                value={price ?? (service.minimum_price as number | null) ?? 0}
                onChange={setPrice}
              />
            ) : null}
            <Button
              label={t("pro.serviceRequest.submit")}
              loading={submit.isPending}
              onPress={() => {
                const min = service.minimum_price as number | null;
                const max = service.maximum_price as number | null;
                const value = price ?? min ?? 0;
                if (service.provider_pricing_allowed && !isPriceInRange(value, min, max)) {
                  setError(true);
                  return;
                }
                setError(false);
                submit.mutate(
                  {
                    serviceId: String(service.id),
                    payload: service.provider_pricing_allowed ? { price_override: value } : {},
                    idempotencyKey: crypto.randomUUID(),
                  },
                  { onSuccess: () => router.back() },
                );
              }}
            />
          </>
        ) : (
          <Text>{t("pro.serviceRequest.serviceUnavailable")}</Text>
        )}
      </QueryState>
      <ActionError error={error || submit.isError} />
      <QueryState query={mineQ} />
    </Page>
  );
}
