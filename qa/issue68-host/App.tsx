import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { ProviderOnboardingFlow } from "@/components/provider/ProviderOnboardingFlow";
import { OnboardingRoute } from "@/routes/pro.onboarding";
import { BookContent } from "@/routes/book.$providerId";
import { RequestUpdatedDetailsAction } from "@/components/admin/RequestUpdatedDetailsAction";
import { AdminProvider } from "@/routes/admin.provider.$id";
import { AdminServices } from "@/routes/admin.services";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import { useProviders } from "@/lib/db/queries";
import { Toaster } from "@/components/ui/sonner";
import { ProviderOnboardingFlowPre68 } from "../tests/issue68/fixtures/ProviderOnboardingFlow.pre68";
import { MOCK_PROVIDER_ID } from "./constants.mjs";
import { useAdminOnboardingReview, type OnboardingStatus } from "@/lib/provider/onboarding-queries";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
    mutations: { retry: false },
  },
});

function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <Outlet />
        <Toaster />
      </LanguageProvider>
    </QueryClientProvider>
  );
}

const rootRoute = createRootRoute({
  component: RootLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: function Index() {
    return <div data-testid="issue68-host">Issue 68 harness</div>;
  },
});

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/onboarding",
  validateSearch: (search: Record<string, unknown>) => ({
    impl: search.impl === "legacy" ? "legacy" : "current",
  }),
  component: function OnboardingHarness() {
    const { impl } = onboardingRoute.useSearch();
    return (
      <div data-testid="issue68-onboarding" data-impl={impl}>
        {impl === "legacy" ? <ProviderOnboardingFlowPre68 /> : <ProviderOnboardingFlow />}
      </div>
    );
  },
});

const marketplaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/marketplace",
  component: function MarketplaceHarness() {
    const provsQ = useProviders({ limit: 50 });
    const rows = provsQ.data ?? [];
    return (
      <div data-testid="issue68-marketplace-probe">
        <div data-testid="provider-count">{rows.length}</div>
        <ul>
          {rows.map((row) => (
            <li
              key={row.id}
              data-testid="provider-row"
              data-service-slug={row.services?.[0]?.service?.slug ?? ""}
            >
              {row.profile.full_name}
            </li>
          ))}
        </ul>
      </div>
    );
  },
});

const proRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pro",
  component: function ProPlaceholder() {
    return <div data-testid="issue68-pro-placeholder" />;
  },
});

const proOnboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pro/onboarding",
  component: function ProOnboardingHarness() {
    return (
      <div data-testid="issue68-pro-onboarding">
        <OnboardingRoute />
      </div>
    );
  },
});

const adminProviderReviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin-provider-review",
  component: function AdminProviderReviewHarness() {
    return (
      <div data-testid="issue68-admin-provider-review">
        <AdminProvider id={MOCK_PROVIDER_ID} />
      </div>
    );
  },
});

const adminServicesCatalogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin-services-catalog",
  component: function AdminServicesCatalogHarness() {
    return (
      <div data-testid="issue68-admin-services-catalog">
        <AdminServices />
      </div>
    );
  },
});

const adminUpdatedDetailsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin-updated-details",
  component: function AdminUpdatedDetailsHarness() {
    const review = useAdminOnboardingReview(MOCK_PROVIDER_ID);
    const status = (
      review.data as { provider?: { onboarding_status?: OnboardingStatus } } | undefined
    )?.provider?.onboarding_status;
    return (
      <div data-testid="issue68-admin-updated-details">
        <div data-testid="onboarding-status">{status ?? "loading"}</div>
        <RequestUpdatedDetailsAction providerId={MOCK_PROVIDER_ID} onboardingStatus={status} />
      </div>
    );
  },
});

const bookRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/book/$providerId",
  validateSearch: (search: Record<string, unknown>) => ({
    serviceId: typeof search.serviceId === "string" ? search.serviceId : undefined,
  }),
  component: function BookHarness() {
    const { providerId } = bookRoute.useParams();
    const { serviceId } = bookRoute.useSearch();
    return (
      <div data-testid="issue68-book">
        <BookContent providerId={providerId} searchServiceId={serviceId} />
      </div>
    );
  },
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  onboardingRoute,
  marketplaceRoute,
  proRoute,
  proOnboardingRoute,
  adminUpdatedDetailsRoute,
  adminServicesCatalogRoute,
  adminProviderReviewRoute,
  bookRoute,
]);
const router = createRouter({ routeTree });

export function App() {
  return <RouterProvider router={router} />;
}
