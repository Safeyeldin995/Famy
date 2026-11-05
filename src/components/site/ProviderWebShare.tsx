import { useProvider, useProviderServices } from "@/lib/db/queries";
import { ProfileAvatar } from "@/components/provider/ProfileAvatar";
import { toUIProvider } from "@/lib/db/adapters";
import { currentLang } from "@/lib/i18n";
import { SiteLayout, SiteSection } from "@/components/site/SiteLayout";
import { StoreBadges } from "@/components/site/StoreBadges";
import { QueryError } from "@/components/famio/QueryError";
import { EmptyState, PrimaryButton } from "@/components/famio/ui";

/** Public provider card for app share links — no web booking. */
export function ProviderWebShare({ providerId }: { providerId: string }) {
  const lang = currentLang();
  const ar = lang === "ar";
  const providerQ = useProvider(providerId);
  const servicesQ = useProviderServices(providerId);
  const deepLink = `famy://provider/${providerId}`;

  if (providerQ.isError) {
    return (
      <SiteLayout>
        <SiteSection className="py-16">
          <QueryError error={providerQ.error} onRetry={() => void providerQ.refetch()} />
        </SiteSection>
      </SiteLayout>
    );
  }

  if (providerQ.isLoading) {
    return (
      <SiteLayout>
        <SiteSection className="grid min-h-[40vh] place-items-center py-16">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand/20 border-t-brand" />
        </SiteSection>
      </SiteLayout>
    );
  }

  const provider = providerQ.data ? toUIProvider(providerQ.data) : null;
  if (!provider) {
    return (
      <SiteLayout>
        <SiteSection className="py-16">
          <EmptyState title={ar ? "مقدم الخدمة مش موجود" : "Provider not found"} />
        </SiteSection>
      </SiteLayout>
    );
  }

  const services = (servicesQ.data ?? []).slice(0, 8);

  return (
    <SiteLayout>
      <SiteSection className="py-14 md:py-20">
        <div className="mx-auto max-w-lg rounded-[2rem] border border-border/70 bg-white p-8 shadow-sm">
          <div className="flex flex-col items-center gap-4 text-center">
            <ProfileAvatar src={provider.avatar} name={provider.name} className="h-24 w-24 text-pro-24" />
            <h1 className="text-pro-24 font-extrabold">{provider.name}</h1>
            {provider.bio ? (
              <p className="text-pro-14 leading-relaxed text-muted-foreground">{provider.bio}</p>
            ) : null}
          </div>

          {services.length ? (
            <ul className="mt-8 space-y-2 border-t border-border/60 pt-6">
              {services.map((row) => {
                const svc = row.service;
                const label = ar ? svc.name_ar : svc.name_en;
                return (
                  <li key={svc.id} className="text-pro-14 font-semibold text-foreground/85">
                    {label}
                  </li>
                );
              })}
            </ul>
          ) : null}

          <div className="mt-8 flex flex-col gap-4">
            <PrimaryButton
              className="min-h-13 w-full"
              onClick={() => {
                window.location.href = deepLink;
              }}
            >
              افتح في التطبيق
            </PrimaryButton>
            <StoreBadges className="justify-center" />
          </div>
        </div>
      </SiteSection>
    </SiteLayout>
  );
}
