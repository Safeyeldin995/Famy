import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { ProviderCard } from "@/components/famio/ProviderCard";
import { EmptyState, PhoneFrame, ProviderCardSkeleton, PrimaryButton } from "@/components/famio/ui";
import { QueryError } from "@/components/famio/QueryError";
import { customerProviders } from "@/components/famio/customerProviders";
import { useProviders } from "@/lib/db/queries";
import { ICON_STROKE_BOLD } from "@/lib/icons/constants";

export const Route = createFileRoute("/online/tutors/")({
  component: OnlineTutorsIndex,
});

function OnlineTutorsIndex() {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const tutorsQ = useProviders({
    categorySlug: "tutoring",
    serviceMode: "online",
    limit: 80,
  });

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = customerProviders(tutorsQ.data ?? []).filter((p) =>
      p.categorySlugs.includes("tutoring"),
    );
    if (!term) return list;
    return list.filter(
      (p) =>
        p.name.toLowerCase().includes(term) ||
        (p.bio ?? "").toLowerCase().includes(term),
    );
  }, [q, tutorsQ.data]);

  return (
    <PhoneFrame bg="bg-transparent" className="!shadow-none">
      <div className="space-y-6">
        <header>
          <h1 className="text-pro-24 font-extrabold">{t("onlineWeb.tutors.title")}</h1>
          <p className="mt-2 text-pro-14 text-muted-foreground">{t("onlineWeb.tutors.lead")}</p>
        </header>
        <label className="flex items-center gap-2 rounded-2xl border border-border/70 bg-white px-4 py-3">
          <Search className="h-5 w-5 text-muted-foreground" strokeWidth={ICON_STROKE_BOLD} />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("onlineWeb.tutors.search")}
            className="min-h-10 flex-1 bg-transparent text-pro-15 outline-none"
            aria-label={t("onlineWeb.tutors.search")}
          />
        </label>
        {tutorsQ.isError ? (
          <QueryError onRetry={() => void tutorsQ.refetch()} />
        ) : tutorsQ.isLoading ? (
          <ul className="grid gap-4 sm:grid-cols-2" aria-busy="true" aria-label={t("common.loading")}>
            {Array.from({ length: 4 }).map((_, i) => (
              <li key={i}>
                <ProviderCardSkeleton />
              </li>
            ))}
          </ul>
        ) : results.length === 0 ? (
          <EmptyState
            title={t("onlineWeb.tutors.empty")}
            body={t("onlineWeb.tutors.emptyBody")}
            action={
              <PrimaryButton
                type="button"
                className="h-12 px-6"
                onClick={() => void tutorsQ.refetch()}
              >
                {t("onlineWeb.tutors.emptyAction")}
              </PrimaryButton>
            }
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {results.map((p) => (
              <li key={p.id}>
                <ProviderCard
                  p={p}
                  categoryLabel={t("roles.tutor")}
                  linkTo={{ to: "/online/tutors/$providerId", params: { providerId: p.id } }}
                />
              </li>
            ))}
          </ul>
        )}
        <p className="text-pro-13 text-muted-foreground">
          {t("onlineWeb.tutors.inPersonCta")}{" "}
          <a href="/" className="font-bold text-brand underline-offset-2 hover:underline">
            {t("site.nav.home")}
          </a>
        </p>
      </div>
    </PhoneFrame>
  );
}