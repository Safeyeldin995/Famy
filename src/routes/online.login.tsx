import { createFileRoute } from "@tanstack/react-router";
import { OnlineWebSignIn } from "@/components/online/OnlineWebSignIn";
import { siteHeadPrivate, siteLanguage } from "@/lib/site/seo";

export const Route = createFileRoute("/online/login")({
  head: ({ matches }) =>
    siteHeadPrivate(
      "/online/login",
      {
        ar: { title: "تسجيل الدخول | دروس أونلاين", description: "سجل دخولك لحجز دروس أونلاين على فامي." },
        en: { title: "Sign in | Online lessons", description: "Sign in to book online lessons on Famy." },
      },
      siteLanguage(matches),
    ),
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
