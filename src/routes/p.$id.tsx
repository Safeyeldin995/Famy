import { createFileRoute } from "@tanstack/react-router";
import { ProviderWebShare } from "@/components/site/ProviderWebShare";
import { siteHead, siteLanguage } from "@/lib/site/seo";

/** Short share URL for universal / app links: /p/{providerId} */
export const Route = createFileRoute("/p/$id")({
  head: ({ matches, params }) =>
    siteHead(
      `/p/${params.id}`,
      {
        ar: {
          title: "مقدم خدمة على فامي | Famy",
          description: "حد شارك معاك مقدم خدمة على فامي. حمل التطبيق علشان تشوف البروفايل وتحجز.",
        },
        en: {
          title: "Famy provider profile",
          description: "Someone shared a Famy provider with you. Get the app to view their profile and book.",
        },
      },
      siteLanguage(matches),
    ),
  component: ProviderShareShortLink,
});

function ProviderShareShortLink() {
  const { id } = Route.useParams();
  return <ProviderWebShare providerId={id} />;
}