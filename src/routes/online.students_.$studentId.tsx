/**
 * «تقدم {name}» on the website: lesson reports, Quran memorization and music level for
 * one learner. `$studentId` is a child (family member) id, `me`, or a linked student's id.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { LearnerProgressView } from "@/components/lessonReports/LearnerProgressView";
import { requireOnlineWebSession } from "@/lib/web/onlineWebSession";
import { ONLINE_WEB_ROUTE_IDS } from "@/lib/web/onlineWebSurface";
import { siteHeadPrivate, siteLanguage } from "@/lib/site/seo";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/online/students_/$studentId")({
  beforeLoad: async ({ location }) => {
    await requireOnlineWebSession(location.href);
  },
  head: ({ matches }) =>
    siteHeadPrivate(
      "/online/students",
      {
        ar: { title: "التقدم | فامي", description: "تقارير الحصص وحفظ القرآن ومستوى الموسيقى." },
        en: {
          title: "Progress | Famy",
          description: "Lesson reports, Quran memorization and music level.",
        },
      },
      siteLanguage(matches),
    ),
  component: OnlineStudentProgress,
});

function OnlineStudentProgress() {
  const { t } = useTranslation();
  const { studentId } = Route.useParams();
  const learnerId = studentId === "me" ? null : UUID_RE.test(studentId) ? studentId : undefined;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link to={ONLINE_WEB_ROUTE_IDS.students} className="text-pro-14 font-bold text-brand">
        {t("common.back")}
      </Link>
      {learnerId === undefined ? (
        <p className="text-pro-14 text-muted-foreground">{t("common.pageNotFound")}</p>
      ) : (
        <LearnerProgressView learnerId={learnerId} />
      )}
    </div>
  );
}
