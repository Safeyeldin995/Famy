import { resolveStudentEducationProfile } from "@shared/tutoring/studentEducationProfile";
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
import { Page, QueryState, Choices, Field, Row, ui } from "./Page";
import { ProviderCard } from "./ProviderCard";
import { Text } from "./Text";
import { space } from "./theme";

export function Discovery({ category }: { category?: string }) {
  const { t, i18n } = useTranslation();
  const [term, setTerm] = useState("");
  const [filter, setFilter] = useState("all");
  const [addressId, setAddressId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [sort, setSort] = useState("top");
  const addresses = useAddresses();
  const categories = useCategories();
  const services = useMarketplaceServices(category);
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
  const all = uniqueProviders([...(a.data ?? []), ...(b.data ?? [])]);
  const caps = useApprovedTeachingCapabilitiesForProviders(
    category === "tutoring" ? all.map((p) => p.id) : [],
  );
  const items = all
    .filter((p) => {
      const categoryMatches =
        filter === "all" ||
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
      sort === "price"
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
  const ranked =
    category === "tutoring"
      ? sortProvidersForStudentEducation(items, caps.data ?? [], {
          serviceId: serviceId || null,
          curriculumId: studentProfile.educationCurriculumId,
          levelId: studentProfile.educationLevelId,
        })
      : items;
  const title = category
    ? localized(
        categories.data?.find((c) => c.slug === category),
        i18n.language,
      ) || t("home.chooseService")
    : t("search.title");
  return (
    <Page title={title} queries={[addresses, categories, services, a, b, members, education, caps]}>
      <View style={ui.card}>
        {!category && (
          <Field
            label={t("search.title")}
            placeholder={t("customerSearch.placeholder")}
            value={term}
            onChangeText={setTerm}
          />
        )}
        {!category && (
          <Choices
            label={t("home.chooseService")}
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: t("common.seeAll") },
              { value: "babysitting", label: t("categories.kidsTitle") },
              { value: "tutoring", label: t("categories.tutorTitle") },
            ]}
          />
        )}
        <QueryState
          query={addresses}
          empty={!addresses.data?.length}
          emptyKey="customerHome.addressHint"
        >
          <Choices
            label={t("customerHome.chooseArea")}
            value={selectedAddress ?? ""}
            onChange={setAddressId}
            options={(addresses.data ?? []).map((a) => ({
              value: a.id,
              label: a.area || a.label || t("profile.addresses"),
            }))}
          />
        </QueryState>
        {category === "tutoring" && (
          <QueryState
            query={{
              isLoading: members.isLoading || education.isLoading,
              isError: members.isError || education.isError,
              refetch: () => Promise.all([members.refetch(), education.refetch()]),
            }}
          >
            <Choices
              label={t("studentEducation.studentPicker")}
              value={student}
              onChange={setStudent}
              options={[
                { value: "myself", label: t("mobile.myself") },
                ...(members.data ?? []).map((m) => ({ value: m.id, label: m.full_name })),
              ]}
            />
            <QueryState query={caps} />
          </QueryState>
        )}
        <Row label={t("profile.addresses")} href="/addresses" />
        <QueryState query={services} empty={!services.data?.length}>
          <Choices
            label={t("search2.service")}
            value={serviceId}
            onChange={setServiceId}
            options={[
              ...(!category ? [{ value: "", label: t("search2.allServices") }] : []),
              ...(services.data ?? []).map((s) => ({
                value: s.id,
                label: localized(s, i18n.language),
              })),
            ]}
          />
        </QueryState>
        <Choices
          label={t("mobile.sort")}
          value={sort}
          onChange={setSort}
          options={[
            { value: "top", label: t("category.sortTop") },
            { value: "price", label: t("mobile.lowestPrice") },
            { value: "experience", label: t("mobile.experience") },
          ]}
        />
      </View>
      <Text size="lg" weight="heavy">
        {t("customerSearch.results", { value: items.length })}
      </Text>
      {selectedAddress ? (
        <QueryState
          query={{
            isLoading: a.isLoading || b.isLoading,
            isError: a.isError || b.isError,
            refetch: () => Promise.all([a.refetch(), b.refetch()]),
          }}
          empty={!items.length}
          emptyKey="customerHome.empty"
        >
          <View style={{ gap: space.md }}>
            {ranked.map((p) => (
              <ProviderCard key={p.id} provider={p} />
            ))}
          </View>
        </QueryState>
      ) : null}
    </Page>
  );
}
