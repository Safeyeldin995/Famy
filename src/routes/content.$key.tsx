import { createFileRoute } from "@tanstack/react-router";
import { SiteLayout, SiteSection } from "@/components/site/SiteLayout";
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
    <SiteLayout>
      <SiteSection className="py-14 md:py-20">
        <h1 className="text-[2rem] font-extrabold md:text-[2.75rem]">{title}</h1>
        <div className="mt-8 max-w-3xl">
          {q.isLoading ? (
            <div className="h-40 animate-pulse rounded-3xl bg-surface-2" />
          ) : q.isError ? (
            <QueryError compact onRetry={() => q.refetch()} />
          ) : body ? (
            <p className="whitespace-pre-wrap text-pro-16 leading-relaxed text-foreground/90">
              {body}
            </p>
          ) : (
            <p className="text-pro-14 text-muted-foreground">
              {t("content.empty", "This content hasn't been added yet.")}
            </p>
          )}
        </div>
      </SiteSection>
    </SiteLayout>
  );
}
