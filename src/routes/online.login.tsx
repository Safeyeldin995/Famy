import { createFileRoute } from "@tanstack/react-router";
import { OnlineWebSignIn } from "@/components/online/OnlineWebSignIn";

export const Route = createFileRoute("/online/login")({
  validateSearch: (
    search: Record<string, unknown> = {},
  ): { returnTo?: string; as?: "tutor" } => ({
    returnTo: typeof search.returnTo === "string" ? search.returnTo : undefined,
    as: search.as === "tutor" ? "tutor" : undefined,
  }),
  component: OnlineWebSignInRoute,
});

function OnlineWebSignInRoute() {
  const { returnTo, as } = Route.useSearch();
  return (
    <OnlineWebSignIn
      key={as ?? "student"}
      returnTo={returnTo ?? "/online"}
      audience={as === "tutor" ? "tutor" : "student"}
    />
  );
}
