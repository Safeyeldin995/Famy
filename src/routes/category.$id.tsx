import { isFixedPackage, packageLabel, type PackageService } from "@/lib/pricing/servicePackages";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PhoneFrame, Chip, EmptyState } from "@/components/famio/ui";
import { CustomerPageHero } from "@/components/famio/CustomerPageHero";
import { CustomerFloatingPanel } from "@/components/famio/CustomerFloatingPanel";
import { QueryError } from "@/components/famio/QueryError";
import { ProviderListRow, ProviderRatingMeta } from "@/components/famio/ProviderListRow";
import { useLang } from "@/components/famio/LanguageToggle";
import { useActiveFamilyMembers, type FamilyMemberRow } from "@/lib/db/family-members-queries";
import {
  useCategories,
  useMarketplaceServices,
  useMyProfile,
  useProviders,
} from "@/lib/db/queries";
import { useCustomerEducationProfile } from "@/lib/db/student-education-queries";
import { useApprovedTeachingCapabilitiesForProviders } from "@/lib/db/teaching-queries";
import { resolveStudentEducationProfile } from "@/lib/tutoring/studentEducationProfile";
import {
  providerMatchesStudentEducation,
  sortProvidersForStudentEducation,
  tutoringMatchBadgeLabel,
} from "@/lib/tutoring/tutoringProviderMatch";
import { toUICategory, toUIProvider, providerPriceLabel } from "@/lib/db/adapters";
import { formatEGP } from "@/lib/utils";
import { SlidersHorizontal } from "lucide-react";
import { ICON_STROKE_BOLD } from "@/lib/icons/constants";

export const Route = createFileRoute("/category/$id")({ component: CategoryPage });

export function CategoryPageContent({ categoryId }: { categoryId: string }) {
  const id = categoryId;
  const { t } = useTranslation();
  const lang = useLang();
  const catsQ = useCategories();
  const servicesQ = useMarketplaceServices(id);
  const [serviceId, setServiceId] = useState("");
  useEffect(() => {
    if (!serviceId && servicesQ.data?.[0]?.id) setServiceId(servicesQ.data[0].id);
  }, [serviceId, servicesQ.data]);
  const provsQ = useProviders({ categorySlug: id, serviceId: serviceId || undefined, limit: 50 });
  const familyMembersQ = useActiveFamilyMembers();
  const customerEducationQ = useCustomerEducationProfile();
  const myProfileQ = useMyProfile();
  const [sort, setSort] = useState<"top" | "price" | "experience">("top");
  const [forWhom, setForWhom] = useState("myself");
  const isTutoring = id === "tutoring";

  const cat = useMemo(() => {
    const row = (catsQ.data ?? []).find((c: { slug: string }) => c.slug === id);
    return row ? toUICategory(row) : null;
  }, [catsQ.data, id]);

  const list = useMemo(() => (provsQ.data ?? []).map(toUIProvider), [provsQ.data]);
  const studentEducation = useMemo(
    () =>
      resolveStudentEducationProfile({
        forWhom,
        customerProfile: customerEducationQ.data,
        customerFullName: myProfileQ.data?.full_name,
        familyMembers: (familyMembersQ.data ?? []) as FamilyMemberRow[],
      }),
    [forWhom, customerEducationQ.data, myProfileQ.data?.full_name, familyMembersQ.data],
  );
  const providerIds = useMemo(() => list.map((row) => row.id), [list]);
  const capsQ = useApprovedTeachingCapabilitiesForProviders(isTutoring ? providerIds : []);
  const sorted = useMemo(() => {
    const compare = (a: (typeof list)[number], b: (typeof list)[number]) =>
      sort === "price"
        ? a.hourlyRate - b.hourlyRate
        : sort === "experience"
          ? b.yearsExp - a.yearsExp
          : b.rating - a.rating;
    const partitioned = sortProvidersForStudentEducation(list, capsQ.data ?? [], {
      serviceId: serviceId || null,
      curriculumId: studentEducation.educationCurriculumId,
      levelId: studentEducation.educationLevelId,
    });
    if (!studentEducation.educationCurriculumId || !studentEducation.educationLevelId) {
      return [...list].sort(compare);
    }
    const matched: typeof list = [];
    const rest: typeof list = [];
    for (const provider of partitioned) {
      if (
        providerMatchesStudentEducation(provider.id, capsQ.data ?? [], {
          serviceId: serviceId || null,
          curriculumId: studentEducation.educationCurriculumId,
          levelId: studentEducation.educationLevelId,
        })
      ) {
        matched.push(provider);
      } else {
        rest.push(provider);
      }
    }
    return [...matched.sort(compare), ...rest.sort(compare)];
  }, [
    list,
    capsQ.data,
    serviceId,
    sort,
    studentEducation.educationCurriculumId,
    studentEducation.educationLevelId,
  ]);
  const matchBadge = tutoringMatchBadgeLabel(studentEducation.studentFirstName, t);

  return (
    <PhoneFrame bg="bg-background">
      <CustomerPageHero
        title={cat?.title ?? "—"}
        subtitle={cat?.description ?? cat?.subtitle ?? ""}
        backTo="/home"
        right={
          <Link
            to="/search"
            className="focus-ring tap-scale inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-3.5 py-2 text-xs font-extrabold text-white backdrop-blur-sm"
          >
            <SlidersHorizontal
              className="h-3.5 w-3.5"
              strokeWidth={ICON_STROKE_BOLD}
              aria-hidden="true"
            />
            {t("category.filters")}
          </Link>
        }
      />

      <div className="px-5">
        <CustomerFloatingPanel>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-extrabold tracking-tight text-foreground">
              {t("category.available", { count: sorted.length })}
            </p>
            {cat ? (
              <p className="shrink-0 text-sm font-extrabold text-brand">
                {t("category.fromPriceHr", { price: formatEGP(cat.fromPrice) })}
              </p>
            ) : null}
          </div>

          {servicesQ.isLoading ? (
            <div className="mt-3 h-12 animate-pulse rounded-full bg-surface-2" />
          ) : servicesQ.isError ? (
            <div className="mt-3">
              <QueryError compact onRetry={() => servicesQ.refetch()} />
            </div>
          ) : (
            <select
              aria-label={t("search2.service")}
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              className="focus-ring mt-3 h-12 w-full rounded-full bg-surface-2 px-4 text-sm font-bold text-foreground focus:outline-none"
            >
              {(servicesQ.data ?? []).map(
                (service: { id: string; name_en: string; name_ar?: string } & PackageService) => (
                  <option key={service.id} value={service.id}>
                    {lang === "ar"
                      ? service.name_ar || service.name_en
                      : service.name_en || service.name_ar}{isFixedPackage(service) ? ` · ${t(packageLabel(service).key, packageLabel(service).values)}` : ""}
                  </option>
                ),
              )}
            </select>
          )}
        </CustomerFloatingPanel>

        {isTutoring ? (
          <div className="mt-3 space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {t("studentEducation.studentPicker", "Student")}
            </label>
            <select
              value={forWhom}
              onChange={(e) => setForWhom(e.target.value)}
              className="focus-ring h-12 w-full rounded-full bg-surface-2 px-4 text-sm font-bold text-foreground"
            >
              <option value="myself">{t("bookFlow.forWhomMyself", "Myself")}</option>
              {(familyMembersQ.data ?? []).map((member: FamilyMemberRow) => (
                <option key={member.id} value={member.id}>
                  {member.full_name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      <div className="flex-1 px-5 pb-24 pt-5">
        {catsQ.isError ? (
          <div className="mb-4">
            <QueryError compact onRetry={() => catsQ.refetch()} />
          </div>
        ) : null}

        <div className="mb-4 flex gap-2 overflow-x-auto no-scrollbar">
          <Chip active={sort === "top"} onClick={() => setSort("top")}>
            {t("category.sortTop")}
          </Chip>
          <Chip active={sort === "price"} onClick={() => setSort("price")}>
            {t("category.sortPrice")}
          </Chip>
          <Chip active={sort === "experience"} onClick={() => setSort("experience")}>
            {t("category.sortExperience")}
          </Chip>
        </div>

        {provsQ.isLoading ? (
          <div className="space-y-2.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-[2rem] bg-surface-2" />
            ))}
          </div>
        ) : provsQ.isError ? (
          <QueryError onRetry={() => provsQ.refetch()} />
        ) : sorted.length === 0 ? (
          <EmptyState icon="search" title={t("category.empty")} body={t("category.emptyBody")} />
        ) : (
          <div className="space-y-2.5">
            {sorted.map((p) => (
              <ProviderListRow
                key={p.id}
                to="/provider/$id"
                params={{ id: p.id }}
                avatar={p.avatar}
                name={p.name}
                subtitle={providerPriceLabel(p, t)}
                meta={<ProviderRatingMeta rating={p.rating} reviews={p.reviews} />}
                pill={
                  matchBadge &&
                  providerMatchesStudentEducation(p.id, capsQ.data ?? [], {
                    serviceId: serviceId || null,
                    curriculumId: studentEducation.educationCurriculumId,
                    levelId: studentEducation.educationLevelId,
                  })
                    ? { label: matchBadge, tone: "brand" }
                    : p.rating >= 4.9
                      ? { label: t("roles.topPro"), tone: "brand" }
                      : undefined
                }
                trailing={
                  <span className="shrink-0 rounded-full bg-brand px-3.5 py-2 text-[11px] font-extrabold text-brand-foreground">
                    {t("provider.bookNow")}
                  </span>
                }
              />
            ))}
          </div>
        )}
      </div>
    </PhoneFrame>
  );
}

function CategoryPage() {
  const { id } = Route.useParams();
  return <CategoryPageContent categoryId={id} />;
}
