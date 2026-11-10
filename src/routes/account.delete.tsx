import { createFileRoute } from "@tanstack/react-router";
import { AccountDeletionScreen } from "@/components/famio/AccountDeletionScreen";
import { AccountDeletionPublic } from "@/components/site/AccountDeletionPublic";
import { SiteLayout, SiteSection } from "@/components/site/SiteLayout";
import { useAuth } from "@/lib/auth/useAuth";
import { siteHead, siteLanguage } from "@/lib/site/seo";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/account/delete")({
  head: ({ matches }) =>
    siteHead(
      "/account/delete",
      {
        ar: {
          title: "حذف حساب فامي | Famy",
          description:
            "اعرف إيه اللي بيتحذف من حسابك على فامي، وسجل دخولك لإكمال طلب الحذف.",
        },
        en: {
          title: "Delete your Famy account",
          description:
            "See what Famy removes when you delete your account, and sign in to complete deletion.",
        },
      },
      siteLanguage(matches),
    ),
  component: AccountDeleteRoute,
});

function AccountDeleteRoute() {
  const { loading, isAuthenticated } = useAuth();
  const { t } = useTranslation();

  if (loading) {
    return (
      <SiteLayout>
        <SiteSection className="py-20">
          <p className="text-pro-16 text-muted-foreground">{t("accountDeletion.checking")}</p>
        </SiteSection>
      </SiteLayout>
    );
  }

  if (!isAuthenticated) {
    return <AccountDeletionPublic />;
  }

  return <AccountDeletionScreen backTo="/" />;
}
