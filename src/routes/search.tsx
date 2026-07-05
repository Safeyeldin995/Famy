import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PhoneFrame, TopBar, Chip, EmptyState } from "@/components/famio/ui";
import { ProviderCard } from "@/components/famio/ProviderCard";
import { useProviders } from "@/lib/db/queries";
import { toUIProvider } from "@/lib/db/adapters";
import { useTranslation } from "react-i18next";
import { Search as SearchIcon, X } from "lucide-react";

export const Route = createFileRoute("/search")({ component: SearchPage });

function SearchPage() {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "home-cleaning" | "babysitting" | "top">("all");
  const provsQ = useProviders({ limit: 60 });

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = (provsQ.data ?? []).map(toUIProvider);
    return list.filter((p) => {
      if (filter === "home-cleaning" && p.categorySlug !== "home-cleaning") return false;
      if (filter === "babysitting" && p.categorySlug !== "babysitting") return false;
      if (filter === "top" && p.rating < 4.85) return false;
      if (!term) return true;
      return (
        p.name.toLowerCase().includes(term) ||
        (p.bio ?? "").toLowerCase().includes(term) ||
        p.areas.some((a) => a.toLowerCase().includes(term))
      );
    });
  }, [q, filter, provsQ.data]);

  return (
    <PhoneFrame>
      <TopBar back={{ to: "/home" }} title={t("search.title")} />
      <div className="px-5">
        <div className="flex h-14 items-center gap-3 rounded-2xl bg-surface px-4 shadow-soft">
          <SearchIcon className="h-5 w-5 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("search2.placeholder")}
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
          />
          {q && (
            <button onClick={() => setQ("")} aria-label={t("common.cancel")} className="focus-ring grid h-11 w-11 place-items-center rounded-full bg-muted active:scale-95 transition-transform">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="mt-4 flex gap-2 overflow-x-auto no-scrollbar">
          <Chip active={filter === "all"} onClick={() => setFilter("all")}>{t("common.seeAll")}</Chip>
          <Chip active={filter === "home-cleaning"} onClick={() => setFilter("home-cleaning")}>{t("categories.homeTitle")}</Chip>
          <Chip active={filter === "babysitting"} onClick={() => setFilter("babysitting")}>{t("categories.kidsTitle")}</Chip>
          <Chip active={filter === "top"} onClick={() => setFilter("top")}>{t("category.sortTop")}</Chip>
        </div>

        <div className="mt-5 space-y-3 pb-10">
          {provsQ.isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 rounded-3xl bg-surface animate-pulse" />)
          ) : provsQ.isError ? (
            <EmptyState emoji="⚠️" title={t("common.errorTitle", "Something went wrong")} body={t("common.tryAgain", "Please try again.")} />
          ) : results.length === 0 ? (
            <EmptyState emoji="🔍" title={t("search2.noResults")} body={t("search2.noResultsBody")} />
          ) : (
            results.map((p) => <ProviderCard key={p.id} p={p} />)
          )}
        </div>
      </div>
    </PhoneFrame>
  );
}
