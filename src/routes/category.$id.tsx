import { isFixedPackage, packageLabel, type PackageService } from "@/lib/pricing/servicePackages";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PhoneFrame, Chip, EmptyState } from "@/components/famio/ui";
import { CustomerPageHeader } from "@/components/famio/CustomerPageHeader";
import { QueryError } from "@/components/famio/QueryError";
import { ProviderCard } from "@/components/famio/ProviderCard";
import { previewPath } from "@/lib/preview/previewPath";
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
import { formatNumber } from "@/lib/format";
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
      <CustomerPageHeader
        title={cat?.title ?? "—"}
        subtitle={cat?.description ?? cat?.subtitle ?? ""}
        backTo="/home"
        right={
          <Link
            to={previewPath("/search")}
            className="focus-ring tap-scale inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-white px-3.5 min-h-11 text-pro-12 font-bold text-brand"
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
        <div className="mt-4 rounded-2xl border border-border/60 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-pro-14 font-extrabold tracking-tight text-foreground">
              {t("customerRound2.results", { countLabel: formatNumber(sorted.length) })}
            </p>
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
              className="focus-ring mt-3 h-12 w-full rounded-full bg-surface-2 px-4 text-pro-14 font-bold text-foreground focus:outline-none"
            >
              {(servicesQ.data ?? []).map(
                (service: { id: string; name_en: string; name_ar?: string } & PackageService) => (
                  <option key={service.id} value={service.id}>
                    {lang === "ar"
                      ? service.name_ar || service.name_en
                      : service.name_en || service.name_ar}
                    {isFixedPackage(service)
                      ? ` · ${t(packageLabel(service).key, packageLabel(service).values)}`
                      : ""}
                  </option>
                ),
              )}
            </select>
          )}
        </div>

        {isTutoring ? (
          <div className="mt-3 space-y-2">
            <label className="block text-pro-12 font-bold uppercase tracking-wide text-muted-foreground">
              {t("studentEducation.studentPicker", "Student")}
            </label>
            <select
              value={forWhom}
              onChange={(e) => setForWhom(e.target.value)}
              className="focus-ring h-12 w-full rounded-full bg-surface-2 px-4 text-pro-14 font-bold text-foreground"
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
          <EmptyState
            icon="search"
            title={t("customerRound2.noProviders")}
            body={t("customerRound2.noProvidersBody")}
            action={
              <Link
                to={previewPath("/search")}
                className="focus-ring inline-flex min-h-11 items-center rounded-full bg-brand px-5 text-pro-14 font-bold text-white"
              >
                {t("category.filters")}
              </Link>
            }
          />
        ) : (
          <div className="space-y-2.5">
            {sorted.map((p) => (
              <div key={p.id}>
                <ProviderCard p={p} subtitle={providerPriceLabel(p, t)} />
                {matchBadge &&
                  providerMatchesStudentEducation(p.id, capsQ.data ?? [], {
                    serviceId: serviceId || null,
                    curriculumId: studentEducation.educationCurriculumId,
                    levelId: studentEducation.educationLevelId,
                  }) && <p className="mt-1 px-4 text-pro-12 font-bold text-brand">{matchBadge}</p>}
              </div>
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
