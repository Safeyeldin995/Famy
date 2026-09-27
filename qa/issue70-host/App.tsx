import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import { Toaster } from "@/components/ui/sonner";
import { Route as SetupFileRoute } from "@/routes/setup";

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
    return <div data-testid="issue70-host">Issue 70 harness</div>;
  },
});

function SetupHarness() {
  const Component = SetupFileRoute.options.component;
  if (!Component) throw new Error("setup route component missing");
  return (
    <div data-testid="issue70-setup-host">
      <Component />
    </div>
  );
}

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup",
  component: SetupHarness,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: function LoginHarness() {
    return (
      <div data-testid="issue70-login">
        <h1>Sign in</h1>
        <p>Welcome to Famy</p>
      </div>
    );
  },
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/home",
  component: function HomeHarness() {
    return <div data-testid="issue70-home">Home</div>;
  },
});

const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/profile",
  component: function ProfileHarness() {
    return <div data-testid="issue70-profile">Profile</div>;
  },
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  setupRoute,
  loginRoute,
  homeRoute,
  profileRoute,
]);
const router = createRouter({ routeTree });

export function App() {
  return <RouterProvider router={router} />;
}
