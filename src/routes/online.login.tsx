import { createFileRoute } from "@tanstack/react-router";
import { OnlineWebSignIn } from "@/components/online/OnlineWebSignIn";

export const Route = createFileRoute("/online/login")({
  validateSearch: (search: Record<string, unknown> = {}) => ({
    returnTo: typeof search.returnTo === "string" ? search.returnTo : undefined,
  }),
  component: OnlineWebSignInRoute,
});

function OnlineWebSignInRoute() {
  const { returnTo } = Route.useSearch();
  return <OnlineWebSignIn returnTo={returnTo ?? "/online"} />;
}