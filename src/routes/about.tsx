import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Check, MapPin } from "lucide-react";
import { SiteLayout, SiteSection } from "@/components/site/SiteLayout";
import { useServiceAreas } from "@/components/site/useServiceAreas";

export const Route = createFileRoute("/about")({
  head: () => ({ meta: [{ title: "About Famy | عن فامي" }] }),
  component: About,
});

function About() {
  const { t } = useTranslation();
  const areas = useServiceAreas();
  return (
    <SiteLayout>
      <div className="bg-gradient-to-b from-brand/[0.08] to-white">
        <SiteSection className="py-16 md:py-20">
          <h1 className="text-[2.25rem] font-extrabold md:text-[3rem]">{t("site.about.title")}</h1>
          <p className="mt-5 max-w-3xl text-pro-18 leading-relaxed text-muted-foreground">
            {t("site.about.lead")}
          </p>
        </SiteSection>
      </div>
      <SiteSection className="grid gap-6 pb-16 md:grid-cols-2 md:pb-20">
        <Block title={t("site.about.missionTitle")}>{t("site.about.missionBody")}</Block>
        <Block title={t("site.about.howTitle")}>{t("site.about.howBody")}</Block>
        <Block title={t("site.about.valuesTitle")}>
          <ul className="space-y-3">
            {["site.about.value1", "site.about.value2", "site.about.value3"].map((key) => (
              <li key={key} className="flex items-center gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand/10 text-brand">
                  <Check className="h-4 w-4" aria-hidden="true" />
                </span>
                {t(key)}
              </li>
            ))}
          </ul>
        </Block>
        {areas.length ? (
          <Block title={t("site.about.areasTitle")}>
            <p>{t("site.about.areasBody")}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {areas.map((a) => (
                <span
                  key={a}
                  className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3.5 py-1.5 text-pro-14 font-bold text-foreground"
                >
                  <MapPin className="h-4 w-4 text-brand" aria-hidden="true" />
                  {a}
                </span>
              ))}
            </div>
          </Block>
        ) : null}
      </SiteSection>
    </SiteLayout>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-border/70 p-7">
      <h2 className="text-pro-22 font-extrabold">{title}</h2>
      <div className="mt-3 text-pro-16 leading-relaxed text-muted-foreground">{children}</div>
    </div>
  );
}
