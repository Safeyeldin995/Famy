import { resolveStudentEducationProfile } from "@shared/tutoring/studentEducationProfile";
import { memberAgeTranslation } from "@shared/familyMemberAge";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import {
  useAddresses,
  useCategories,
  useMarketplaceServices,
  useProviders,
  useActiveFamilyMembers,
  useCustomerEducationProfile,
  useMyProfile,
  useApprovedTeachingCapabilitiesForProviders,
} from "@/lib/queries";
import { localized, uniqueProviders, sortProvidersForStudentEducation } from "@/lib/presentation";
import { joinUiParts } from "@shared/format/uiJoin";
import { Page, QueryState, Choices, Field, Row, ui } from "./Page";
import { ProviderCard } from "./ProviderCard";
import { Text } from "./Text";
import { radius, space } from "./theme";
import { CustomerSearchView } from "./customer/CustomerSearchView";
import { CustomerPageHeader } from "./CustomerPageHeader";
import { BottomSheetSelect } from "./provider/BottomSheetSelect";
import { CustomerChips, CustomerEmpty, customerStyle } from "./customer/Primitives";
import { Button } from "./Button";
import { Search, SlidersHorizontal } from "lucide-react-native";
import { router } from "expo-router";
import {
  homeCategoryDbSlug,
  homeCategoryLessonSlug,
  isHomeCategoryId,
  servicesForHomeCategory,
} from "@shared/catalog/homeCategories";
import { colors } from "./theme";
import { isFixedPackage, packageLabel } from "@shared/pricing/servicePackages";
import {
  providerMatchesStudentEducation,
  tutoringMatchBadgeLabel,
} from "@shared/tutoring/tutoringProviderMatch";

export function Discovery({ category: group }: { category?: string }) {
  const { t, i18n } = useTranslation();
  // Quran/music are their own groups but live in the "tutoring" DB category.
  const homeGroup = isHomeCategoryId(group) ? group : null;
  const category = homeGroup ? homeCategoryDbSlug(homeGroup) : group;
  const lessonGroup = homeGroup ? homeCategoryLessonSlug(homeGroup) : null;
  const schoolTutoring = category === "tutoring" && !lessonGroup;
  const [term, setTerm] = useState("");
  const [filter, setFilter] = useState("all");
  const [addressId, setAddressId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [sort, setSort] = useState("top");
  const addresses = useAddresses();
  const categories = useCategories();
  const allServices = useMarketplaceServices(category);
  const services = {
    ...allServices,
    data: allServices.data
      ? homeGroup
        ? servicesForHomeCategory(allServices.data, homeGroup)
        : allServices.data
      : undefined,
  };
  const selectedAddress =
    addressId || addresses.data?.find((a) => a.is_default)?.id || addresses.data?.[0]?.id;
  useEffect(() => {
    if (category && !serviceId && services.data?.[0]) setServiceId(services.data[0].id);
  }, [category, services.data, serviceId]);
  const a = useProviders({
    categorySlug: category || "babysitting",
    serviceId: serviceId || undefined,
    addressId: selectedAddress,
    limit: category ? 50 : 60,
  });
  const b = useProviders({
    categorySlug: category || "tutoring",
    serviceId: serviceId || undefined,
    addressId: selectedAddress,
    limit: category ? 50 : 60,
  });
  const members = useActiveFamilyMembers();
  const education = useCustomerEducationProfile();
  const profile = useMyProfile();
  const [student, setStudent] = useState("myself");
  const all = uniqueProviders(
    filter === "tutoring"
      ? [...(b.data ?? []), ...(a.data ?? [])]
      : [...(a.data ?? []), ...(b.data ?? [])],
  );
  const caps = useApprovedTeachingCapabilitiesForProviders(
    category === "tutoring" || !category ? all.map((p) => p.id) : [],
  );
  const items = all
    .filter((p) => {
      const categoryMatches =
        filter === "all" ||
        (filter === "top" && Number(p.ratings.rating_avg) >= 4.85) ||
        [...(a.data ?? []), ...(b.data ?? [])].some(
          (r) => r.id === p.id && r.services[0]?.service.category.slug === filter,
        );
      return (
        categoryMatches &&
        (!term.trim() ||
          [p.profile.full_name, p.bio_ar, p.bio_en, p.city].some((v) =>
            String(v ?? "")
              .toLowerCase()
              .includes(term.trim().toLowerCase()),
          ))
      );
    })
    .sort((a, b) =>
      !category
        ? 0
        : sort === "price"
          ? Number(a.hourly_rate) - Number(b.hourly_rate)
          : sort === "experience"
            ? Number(b.years_experience) - Number(a.years_experience)
            : Number(b.ratings.rating_avg) - Number(a.ratings.rating_avg),
    );
  const studentProfile = resolveStudentEducationProfile({
    forWhom: student,
    customerProfile: education.data,
    customerFullName: profile.data?.full_name,
    familyMembers: (members.data ?? []).map((m) => ({
      id: m.id,
      full_name: m.full_name,
      education_curriculum_id: m.education_curriculum_id,
      education_level_id: m.education_level_id,
    })),
  });
  const ranked = schoolTutoring
    ? sortProvidersForStudentEducation(items, caps.data ?? [], {
        serviceId: serviceId || null,
        curriculumId: studentProfile.educationCurriculumId,
        levelId: studentProfile.educationLevelId,
      })
    : items;
  const title = lessonGroup
    ? t(lessonGroup === "quran-lessons" ? "home.quranTitle" : "home.musicTitle")
    : category
      ? localized(
          categories.data?.find((c) => c.slug === category),
          i18n.language,
        ) || t("home.chooseService")
      : t("search.title");
  if (!category)
    return (
      <CustomerSearchView
        term={term}
        setTerm={setTerm}
        filter={filter}
        setFilter={setFilter}
        serviceId={serviceId}
        setServiceId={setServiceId}
        addressId={selectedAddress ?? ""}
        setAddressId={setAddressId}
        addresses={addresses}
        services={allServices}
        results={items}
        capabilities={caps.data ?? []}
        providers={{
          isLoading: a.isLoading || b.isLoading,
          isError: a.isError || b.isError,
          refetch: () => Promise.all([a.refetch(), b.refetch()]),
        }}
      />
    );
  return (
    <Page
      title={title}
      queries={[addresses, categories, services, a, b, members, education, caps]}
      header={
        <CustomerPageHeader
          title={title}
          subtitle={(() => {
            if (lessonGroup)
              return t(lessonGroup === "quran-lessons" ? "home.quranTag" : "home.musicTag");
            const row = categories.data?.find((c) => c.slug === category);
            return (
              (i18n.language === "ar" ? row?.description_ar : row?.description_en) ||
              row?.description_en ||
              ""
            );
          })()}
          backTo="/home"
          right={
            <Button
              variant="secondary"
              label={t("category.filters")}
              icon={<SlidersHorizontal size={14} color={colors.brand} />}
              style={{ minHeight: 44, borderRadius: radius.pill, paddingHorizontal: space.md + 2 }}
              onPress={() => router.push("/search")}
            />
          }
        />
      }
    >
      <View style={customerStyle.card}>
        <Text weight="heavy">
          {t("customerRound2.results", { countLabel: String(ranked.length) })}
        </Text>
        <QueryState query={services} empty={!services.data?.length}>
          <BottomSheetSelect
            label={t("search2.service")}
            value={serviceId}
            onChange={setServiceId}
            options={(services.data ?? []).map((s) => ({
              value: s.id,
              label: isFixedPackage(s)
                ? joinUiParts(
                    [localized(s, i18n.language), t(packageLabel(s).key, packageLabel(s).values)],
                    i18n.language,
                  )
                : localized(s, i18n.language),
            }))}
          />
        </QueryState>
      </View>
      {schoolTutoring && (
        <QueryState
          query={{
            isLoading: members.isLoading || education.isLoading,
            isError: members.isError || education.isError,
            refetch: () => Promise.all([members.refetch(), education.refetch()]),
          }}
        >
          <BottomSheetSelect
            label={t("studentEducation.studentPicker")}
            value={student}
            onChange={setStudent}
            options={[
              { value: "myself", label: t("bookFlow.forWhomMyself") },
              ...(members.data ?? []).map((m) => ({
                value: m.id,
                label: joinUiParts(
                  [
                    m.full_name,
                    t(memberAgeTranslation(m.date_of_birth).key, {
                      count: memberAgeTranslation(m.date_of_birth).count,
                    }),
                  ],
                  i18n.language,
                ),
              })),
            ]}
          />
          <QueryState query={caps} />
        </QueryState>
      )}
      <CustomerChips
        value={sort}
        onChange={setSort}
        options={[
          { value: "top", label: t("category.sortTop") },
          { value: "price", label: t("category.sortPrice") },
          { value: "experience", label: t("category.sortExperience") },
        ]}
      />
      {categories.isError ? <QueryState query={categories} /> : null}
      {selectedAddress ? (
        <QueryState
          query={{
            isLoading: a.isLoading || b.isLoading,
            isError: a.isError || b.isError,
            refetch: () => Promise.all([a.refetch(), b.refetch()]),
          }}
        >
          {!ranked.length ? (
            <CustomerEmpty
              Icon={Search}
              title={t("customerRound2.noProviders")}
              body={t("customerRound2.noProvidersBody")}
            >
              <Button label={t("category.filters")} onPress={() => router.push("/search")} />
            </CustomerEmpty>
          ) : null}
          <View style={{ gap: space.md }}>
            {ranked.map((p) => (
              <View key={p.id} style={{ gap: space.xs }}>
                <ProviderCard provider={p} />
                {schoolTutoring &&
                studentProfile.studentFirstName &&
                providerMatchesStudentEducation(p.id, caps.data ?? [], {
                  serviceId: serviceId || null,
                  curriculumId: studentProfile.educationCurriculumId,
                  levelId: studentProfile.educationLevelId,
                }) ? (
                  <Text size="xs" weight="bold" tone="brand" style={{ paddingHorizontal: space.lg }}>
                    {tutoringMatchBadgeLabel(studentProfile.studentFirstName, t)}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        </QueryState>
      ) : (
        <CustomerEmpty
          Icon={Search}
          title={t("customerHome.chooseArea")}
          body={t("customerHome.addressHint")}
        >
          <Button label={t("addresses.addAddress")} onPress={() => router.push("/addresses/new")} />
        </CustomerEmpty>
      )}
    </Page>
  );
}
