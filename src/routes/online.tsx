import { createFileRoute } from "@tanstack/react-router";
import { OnlineWebLayout } from "@/components/online/OnlineWebLayout";
import { siteHead, siteLanguage } from "@/lib/site/seo";

export const Route = createFileRoute("/online")({
  head: ({ matches }) =>
    siteHead(
      "/online",
      {
        ar: {
          title: "دروس أونلاين | فامي",
          description: "احجز درس خصوصي أونلاين مع مدربين فامي الموثوقين من الكمبيوتر.",
        },
        en: {
          title: "Online lessons | Famy",
          description: "Book live online tutoring with verified Famy tutors from your computer.",
        },
      },
      siteLanguage(matches),
    ),
  component: OnlineWebLayout,
});