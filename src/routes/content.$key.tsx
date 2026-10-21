import { createFileRoute } from "@tanstack/react-router";
import { PhoneFrame, Card } from "@/components/famio/ui";
import { CustomerPageHero } from "@/components/famio/CustomerPageHero";
import { QueryError } from "@/components/famio/QueryError";
import { usePlatformContent, type PlatformContentKey } from "@/lib/db/settings-queries";
import { useLang } from "@/components/famio/LanguageToggle";
import { useTranslation } from "react-i18next";
import { siteHead, siteLanguage } from "@/lib/site/seo";

export const Route = createFileRoute("/content/$key")({
  head: ({ matches, params }) => {
    const language = siteLanguage(matches);
    if (params.key === "terms") {
      return siteHead(
        "/content/terms",
        {
          ar: {
            title: "شروط استخدام فامي | Famy",
            description: "اقرأ شروط استخدام منصة فامي لخدمات رعاية الأطفال والتدريس.",
          },
          en: {
            title: "Famy Terms of Use",
            description: "Read the terms for using Famy's babysitting and tutoring platform.",
          },
        },
        language,
      );
    }
    if (params.key === "privacy") {
      return siteHead(
        "/content/privacy",
        {
          ar: {
            title: "سياسة خصوصية فامي | Famy",
            description: "اقرأ سياسة خصوصية فامي وكيفية التعامل مع بيانات المستخدمين.",
          },
          en: {
            title: "Famy Privacy Policy",
            description: "Read Famy's privacy policy and how user data is handled.",
          },
        },
        language,
      );
    }
    return { meta: [{ name: "robots", content: "noindex, nofollow" }] };
  },
  component: ContentPage,
});

const TITLE_KEYS: Record<PlatformContentKey, string> = {
  terms: "profile.terms",
  privacy: "profile.privacy",
  about: "profile.about",
  contact: "profile.contact",
};

function isContentKey(v: string): v is PlatformContentKey {
  return v === "terms" || v === "privacy" || v === "about" || v === "contact";
}

function ContentPage() {
  const { key } = Route.useParams();
  const { t } = useTranslation();
  const lang = useLang();
  const contentKey: PlatformContentKey = isContentKey(key) ? key : "terms";
  const q = usePlatformContent(contentKey);
  const title = t(TITLE_KEYS[contentKey]);
  const body = lang === "ar" ? q.data?.body_ar : q.data?.body_en;

  return (
    <PhoneFrame bg="bg-background">
      <CustomerPageHero title={title} backTo="/profile" />
      <div className="px-5 pb-10 pt-2">
        <Card className="p-5">
          {q.isLoading ? (
            <div className="h-40 animate-pulse rounded-xl bg-muted" />
          ) : q.isError ? (
            <QueryError compact onRetry={() => q.refetch()} />
          ) : body ? (
            <p className="whitespace-pre-wrap text-[15px] font-medium leading-relaxed text-foreground">
              {body}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("content.empty", "This content hasn't been added yet.")}
            </p>
          )}
        </Card>
      </div>
    </PhoneFrame>
  );
}
