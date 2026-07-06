import { createFileRoute } from "@tanstack/react-router";
import { PhoneFrame, TopBar, Card } from "@/components/famio/ui";
import { usePlatformContent, type PlatformContentKey } from "@/lib/db/settings-queries";
import { useLang } from "@/components/famio/LanguageToggle";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/content/$key")({ component: ContentPage });

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
    <PhoneFrame>
      <TopBar back={{ to: "/profile" }} title={title} />
      <div className="px-5 pb-10">
        <Card className="p-5">
          {q.isLoading ? (
            <div className="h-40 animate-pulse rounded-xl bg-muted" />
          ) : body ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{body}</p>
          ) : (
            <p className="text-sm text-muted-foreground">{t("content.empty", "This content hasn't been added yet.")}</p>
          )}
        </Card>
      </div>
    </PhoneFrame>
  );
}
