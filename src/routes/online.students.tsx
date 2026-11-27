/**
 * «أبنائي» on the website. The app-style /account/students and /family-members pages are
 * not part of the public web surface, so the site keeps this page under /online. The
 * 1 September «صح؟» notification opens it with `?confirm=self` or `?confirm=<child id>`.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { StudentsManager } from "@/components/student/StudentsManager";
import { requireOnlineWebSession } from "@/lib/web/onlineWebSession";
import { ONLINE_WEB_ROUTE_IDS } from "@/lib/web/onlineWebSurface";
import { siteHeadPrivate, siteLanguage } from "@/lib/site/seo";

type StudentsSearch = { confirm?: string };

export const Route = createFileRoute("/online/students")({
  validateSearch: (search: Record<string, unknown>): StudentsSearch => ({
    confirm: typeof search.confirm === "string" && search.confirm ? search.confirm : undefined,
  }),
  beforeLoad: async ({ location }) => {
    await requireOnlineWebSession(location.href);
  },
  head: ({ matches }) =>
    siteHeadPrivate(
      "/online/students",
      {
        ar: { title: "أبنائي | فامي", description: "نظام التعليم والسنة الدراسية لك ولأبنائك." },
        en: {
          title: "My children | Famy",
          description: "School system and grade for you and your children.",
        },
      },
      siteLanguage(matches),
    ),
  component: OnlineStudents,
});

function OnlineStudents() {
  const { t } = useTranslation();
  const nav = useNavigate({ from: "/online/students" });
  const search = Route.useSearch();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-pro-24 font-extrabold">{t("studentMatch.page.title")}</h1>
        <p className="mt-2 text-pro-14 text-muted-foreground">{t("studentMatch.page.lead")}</p>
      </header>
      <StudentsManager
        confirm={search.confirm}
        onClearConfirm={() => void nav({ search: {}, replace: true })}
        signInTo={ONLINE_WEB_ROUTE_IDS.login}
      />
    </div>
  );
}
