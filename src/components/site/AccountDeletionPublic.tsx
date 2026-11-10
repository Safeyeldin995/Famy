import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { SiteLayout, SiteSection } from "@/components/site/SiteLayout";
import { ACCOUNT_DELETE_INTENT } from "@/lib/web/webSurface";

/** Signed-out view for `/account/delete` (Google Play web deletion URL). */
export function AccountDeletionPublic() {
  const { t } = useTranslation();
  const deletedItems = t("accountDeletion.deletedItems", { returnObjects: true }) as string[];

  return (
    <SiteLayout>
      <SiteSection className="py-14 md:py-20">
        <h1 className="text-[2rem] font-extrabold md:text-[2.75rem]">{t("accountDeletion.title")}</h1>
        <p className="mt-5 max-w-3xl text-pro-16 leading-relaxed text-muted-foreground">
          {t("accountDeletion.intro")}
        </p>
        <p className="mt-3 max-w-3xl text-pro-16 leading-relaxed text-muted-foreground">
          {t("accountDeletion.webPublicLead")}
        </p>

        <section className="mt-8 max-w-3xl rounded-3xl border border-border/70 p-6">
          <h2 className="text-pro-18 font-extrabold">{t("accountDeletion.deletedTitle")}</h2>
          <ul className="mt-3 list-disc space-y-1 ps-5 text-pro-14 leading-relaxed text-muted-foreground">
            {deletedItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="mt-5 max-w-3xl rounded-3xl border border-border/70 p-6">
          <h2 className="text-pro-18 font-extrabold">{t("accountDeletion.keptTitle")}</h2>
          <p className="mt-3 text-pro-14 leading-relaxed text-muted-foreground">
            {t("accountDeletion.keptBody")}
          </p>
        </section>

        <Link
          to="/login"
          search={{ intent: ACCOUNT_DELETE_INTENT }}
          className="focus-ring mt-8 inline-flex min-h-12 items-center justify-center rounded-full bg-brand px-8 text-pro-16 font-extrabold text-brand-foreground"
        >
          {t("accountDeletion.webSignIn")}
        </Link>
      </SiteSection>
    </SiteLayout>
  );
}
