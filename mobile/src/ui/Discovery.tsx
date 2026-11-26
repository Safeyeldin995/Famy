import { resolveStudentEducationProfile } from "@shared/tutoring/studentEducationProfile";
import { useEffect, useMemo, useState } from "react";
import { Alert, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useOnlineSessionsAvailable } from "@/lib/useOnlineSessionsAvailable";
import { normalizeServiceDeliveryMode } from "@shared/online/serviceMode";
import {
  useAddresses,
  useCategories,
  useMarketplaceServices,
  useProviders,
  useActiveFamilyMembers,
  useCustomerEducationProfile,
  useMyProfile,
  useApprovedTeachingCapabilitiesForProviders,
  useTeachingLevels,
} from "@/lib/queries";
import { localized, uniqueProviders } from "@/lib/presentation";
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
import { Bell, Search, SlidersHorizontal } from "lucide-react-native";
import { router } from "expo-router";
import {
  homeCategoryDbSlug,
  homeCategoryLessonSlug,
  isHomeCategoryId,
  servicesForHomeCategory,
} from "@shared/catalog/homeCategories";
import { categoryAllowsOnlineDiscovery } from "@shared/catalog/discoveryOnlineDelivery";
import { colors } from "./theme";
import { InPersonComingSoonCard } from "./customer/InPersonComingSoonCard";
import { isFixedPackage, packageLabel } from "@shared/pricing/servicePackages";
import {
  hasStudentEducation,
  tutoringMatchBadgeLabel,
  tutoringServiceKind,
} from "@shared/tutoring/tutoringProviderMatch";
import {
  buildLearnerOptions,
  filterProvidersByMatch,
  findLearner,
  initialLearnerId,
  learnerFamilyMemberId,
  learnerNeedsProfile,
  matchedCapabilityFor,
  noMatchDescription,
  shouldAskForWhom,
  skillLevels,
  subjectsForService,
} from "@shared/tutoring/studentLearnerFlow";
import { useTeachingSubjectServices, useTeachingSubjects } from "@/lib/provider/teachingQueries";
import { useSaveStudentEducationProfile } from "@/lib/bookingQueries";
import {
  useCurriculaWithStyle,
  useRememberedLearner,
  useRequestTutorAvailability,
} from "@/lib/studentMatchQueries";
import {
  LearnerChips,
  LevelChips,
  StudentProfileSteps,
  SubjectChips,
  gradeLabelFor,
} from "./customer/StudentMatchControls";

export function Discovery({ category: group }: { category?: string }) {
  const { t, i18n } = useTranslation();
  // Quran/music are their own groups but live in the "tutoring" DB category.
  const homeGroup = isHomeCategoryId(group) ? group : null;
  const category = homeGroup ? homeCategoryDbSlug(homeGroup) : group;
  const lessonGroup = homeGroup ? homeCategoryLessonSlug(homeGroup) : null;
  const [term, setTerm] = useState("");
  const [filter, setFilter] = useState("all");
  const [addressId, setAddressId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [serviceMode, setServiceMode] = useState<"in_person" | "online">("in_person");
  const [modeTouched, setModeTouched] = useState(false);
  const [sort, setSort] = useState("top");
  const [searchSort, setSearchSort] = useState<"default" | "price">("default");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const onlineCaps = useOnlineSessionsAvailable();
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
  const onlineChoosable = !!onlineCaps.data?.onlineSessions && categoryAllowsOnlineDiscovery(group);
  // No saved address usually means the customer lives outside our at-home zones:
  // start on online lessons, which are open across Egypt.
  useEffect(() => {
    if (!modeTouched && onlineChoosable && addresses.isSuccess && !addresses.data?.length) {
      setServiceMode("online");
    }
  }, [modeTouched, onlineChoosable, addresses.isSuccess, addresses.data?.length]);
  const chooseMode = (mode: "in_person" | "online") => {
    setModeTouched(true);
    setServiceMode(mode);
  };
  useEffect(() => {
    if (category && !serviceId && services.data?.[0]) setServiceId(services.data[0].id);
  }, [category, services.data, serviceId]);
  const deliveryMode = normalizeServiceDeliveryMode(serviceMode);
  const a = useProviders({
    categorySlug: category || "babysitting",
    serviceId: serviceId || undefined,
    addressId: selectedAddress,
    serviceMode: deliveryMode,
    limit: category ? 50 : 60,
  });
  const b = useProviders({
    categorySlug: category || "tutoring",
    serviceId: serviceId || undefined,
    addressId: selectedAddress,
    serviceMode: deliveryMode,
    limit: category ? 50 : 60,
  });
  const members = useActiveFamilyMembers();
  const education = useCustomerEducationProfile();
  const profile = useMyProfile();
  const [rememberedLearner, rememberLearner] = useRememberedLearner();
  const [student, setStudentState] = useState("myself");
  const learners = buildLearnerOptions({
    selfFullName: profile.data?.full_name,
    selfProfile: education.data,
    children: (members.data ?? []).map((m) => ({
      id: m.id,
      full_name: m.full_name,
      education_curriculum_id: m.education_curriculum_id,
      education_level_id: m.education_level_id,
    })),
  });
  useEffect(() => {
    if (members.isSuccess)
      setStudentState(initialLearnerId(learners, rememberedLearner ?? student));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members.isSuccess, members.data, rememberedLearner]);
  const setStudent = (id: string) => {
    setStudentState(id);
    rememberLearner(id);
    setSubjectId(null);
    setSkillLevelId(null);
    setEditingProfile(false);
    setDemandSent(false);
  };
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [skillLevelId, setSkillLevelId] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [demandSent, setDemandSent] = useState(false);
  const curricula = useCurriculaWithStyle();
  const levels = useTeachingLevels();
  const subjects = useTeachingSubjects();
  const subjectServices = useTeachingSubjectServices();
  const saveProfile = useSaveStudentEducationProfile();
  const requestDemand = useRequestTutorAvailability();
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
  const selectedServiceSlug = (services.data ?? []).find((s) => s.id === serviceId)?.slug;
  const kind = tutoringServiceKind(selectedServiceSlug);
  const tutoringCategory = category === "tutoring" && !!serviceId;
  const learner = findLearner(learners, student);
  const serviceSubjects = subjectsForService(
    (subjects.data ?? []) as never,
    subjectServices.data ?? [],
    serviceId || null,
  );
  const skills = skillLevels((levels.data ?? []) as never);
  const subjectRow = serviceSubjects.find((s) => s.id === subjectId) ?? null;
  // School tutoring and homework match on the learner's system + grade (+ subject);
  // Quran and music match on subject + a level picked here (issue 536, PR 2).
  const schoolMatching = tutoringCategory && kind !== "skill";
  const needsProfile = schoolMatching && learnerNeedsProfile(learner, selectedServiceSlug);
  const strictMatching = schoolMatching
    ? hasStudentEducation({
        curriculumId: studentProfile.educationCurriculumId,
        levelId: studentProfile.educationLevelId,
      })
    : tutoringCategory && kind === "skill" && !!subjectRow && !!skillLevelId;
  const matchCriteria = strictMatching
    ? kind === "skill"
      ? {
          serviceId,
          subjectCode: subjectRow?.code ?? null,
          curriculumId: null,
          levelId: skillLevelId,
        }
      : {
          serviceId,
          subjectCode: kind === "homework" ? null : (subjectRow?.code ?? null),
          curriculumId: studentProfile.educationCurriculumId,
          levelId: studentProfile.educationLevelId,
        }
    : null;
  const ranked = matchCriteria
    ? filterProvidersByMatch(items, caps.data ?? [], matchCriteria)
    : items;
  const currentCurriculum =
    (curricula.data ?? []).find((c) => c.id === studentProfile.educationCurriculumId) ?? null;
  const currentLevel =
    (levels.data ?? []).find((l) => l.id === studentProfile.educationLevelId) ?? null;
  const uiLang: "ar" | "en" = i18n.language === "en" ? "en" : "ar";
  const nameOf = (row: { name_ar: string; name_en: string } | null | undefined) =>
    row ? (uiLang === "ar" ? row.name_ar : row.name_en) : null;
  const noMatchWhat = noMatchDescription({
    subject:
      kind === "homework"
        ? nameOf((services.data ?? []).find((s) => s.id === serviceId) as never)
        : nameOf(subjectRow),
    grade:
      kind === "skill"
        ? nameOf(skills.find((l) => l.id === skillLevelId))
        : gradeLabelFor(currentLevel as never, currentCurriculum, uiLang) || null,
    system: kind === "skill" ? null : nameOf(currentCurriculum),
  });
  const notifyMe = async () => {
    if (!serviceId || !matchCriteria) return;
    try {
      const res = await requestDemand.mutateAsync({
        serviceId,
        subjectId: kind === "homework" ? null : subjectId,
        curriculumId: matchCriteria.curriculumId,
        levelId: matchCriteria.levelId,
        serviceMode: deliveryMode === "online" ? "online" : "in_person",
        familyMemberId: learnerFamilyMemberId(student),
      });
      setDemandSent(true);
      Alert.alert(
        t(
          res?.status === "already_requested"
            ? "studentMatch.notifyAlready"
            : "studentMatch.notifyDone",
        ),
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      Alert.alert(
        t(
          msg.includes("DEMAND_RATE_LIMITED")
            ? "studentMatch.notifyLimit"
            : "studentMatch.saveFailed",
        ),
      );
    }
  };
  const saveLearnerProfile = async (picked: { curriculumId: string; levelId: string }) => {
    try {
      await saveProfile.save({
        forWhom: student,
        education_curriculum_id: picked.curriculumId,
        education_level_id: picked.levelId,
      });
      setEditingProfile(false);
    } catch {
      Alert.alert(t("studentMatch.saveFailed"));
    }
  };
  const title = lessonGroup
    ? t(lessonGroup === "quran-lessons" ? "home.quranTitle" : "home.musicTitle")
    : category
      ? localized(
          categories.data?.find((c) => c.slug === category),
          i18n.language,
        ) || t("home.chooseService")
      : t("search.title");
  const searchResults = useMemo(() => {
    let list = items;
    if (verifiedOnly) list = list.filter((p) => p.is_verified);
    if (searchSort === "price") {
      list = [...list].sort((a, b) => Number(a.hourly_rate ?? 0) - Number(b.hourly_rate ?? 0));
    }
    return list;
  }, [items, searchSort, verifiedOnly]);

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
        results={searchResults}
        sort={searchSort}
        setSort={setSearchSort}
        verifiedOnly={verifiedOnly}
        setVerifiedOnly={setVerifiedOnly}
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
      {category === "tutoring" ? (
        <QueryState
          query={{
            isLoading:
              members.isLoading || education.isLoading || curricula.isLoading || levels.isLoading,
            isError:
              members.isError ||
              education.isError ||
              curricula.isError ||
              levels.isError ||
              subjects.isError,
            refetch: () =>
              Promise.all([
                members.refetch(),
                education.refetch(),
                curricula.refetch(),
                levels.refetch(),
                subjects.refetch(),
                subjectServices.refetch(),
              ]),
          }}
        >
          <View style={{ gap: space.md }}>
            {shouldAskForWhom(learners) ? (
              <LearnerChips learners={learners} value={student} onChange={setStudent} />
            ) : (
              <LearnerChips
                learners={learners.filter((l) => l.kind === "self")}
                value={student}
                onChange={setStudent}
              />
            )}
            {(needsProfile || editingProfile) && schoolMatching ? (
              <StudentProfileSteps
                key={`${student}-${editingProfile}`}
                title={
                  learner?.kind === "child" && learner.firstName
                    ? t("studentMatch.profileTitle", { name: learner.firstName })
                    : t("studentMatch.profileTitleSelf")
                }
                curricula={curricula.data ?? []}
                levels={(levels.data ?? []) as never}
                initialCurriculumId={learner?.curriculumId}
                initialLevelId={learner?.levelId}
                saving={saveProfile.isPending}
                onDone={(picked) => void saveLearnerProfile(picked)}
                onCancel={editingProfile ? () => setEditingProfile(false) : undefined}
              />
            ) : (
              <>
                {schoolMatching && currentCurriculum ? (
                  <Text size="sm" weight="bold" tone="brand">
                    {joinUiParts(
                      [
                        nameOf(currentCurriculum),
                        gradeLabelFor(currentLevel as never, currentCurriculum, uiLang),
                      ].filter(Boolean) as string[],
                      i18n.language,
                    )}
                  </Text>
                ) : null}
                {kind !== "homework" ? (
                  <SubjectChips
                    subjects={serviceSubjects}
                    value={subjectId}
                    onChange={(id) => {
                      setSubjectId(id);
                      setDemandSent(false);
                    }}
                  />
                ) : null}
                {kind === "skill" && subjectId ? (
                  <LevelChips
                    levels={skills}
                    value={skillLevelId}
                    onChange={(id) => {
                      setSkillLevelId(id);
                      setDemandSent(false);
                    }}
                  />
                ) : null}
              </>
            )}
          </View>
          <QueryState query={caps} />
        </QueryState>
      ) : null}
      {onlineChoosable ? (
        <CustomerChips
          value={deliveryMode}
          onChange={(v) => chooseMode(v === "online" ? "online" : "in_person")}
          options={[
            { value: "in_person", label: t("search.deliveryInPerson") },
            { value: "online", label: t("search.deliveryOnline") },
          ]}
        />
      ) : null}
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
      {selectedAddress || deliveryMode === "online" ? (
        <QueryState
          query={{
            isLoading: a.isLoading || b.isLoading || (strictMatching && caps.isLoading),
            isError: a.isError || b.isError || (strictMatching && caps.isError),
            refetch: () => Promise.all([a.refetch(), b.refetch(), caps.refetch()]),
          }}
        >
          {!ranked.length && matchCriteria ? (
            <CustomerEmpty
              Icon={Search}
              title={t("studentMatch.noMatch", { what: noMatchWhat })}
              body={t("studentMatch.noMatchBody")}
            >
              <Button
                label={t("studentMatch.notifyMe")}
                icon={<Bell size={14} color={colors.surface} />}
                disabled={demandSent || requestDemand.isPending}
                onPress={() => void notifyMe()}
              />
              {kind !== "skill" ? (
                <Button
                  variant="secondary"
                  label={
                    learner?.kind === "child" && learner.firstName
                      ? t("studentMatch.editProfile", { name: learner.firstName })
                      : t("studentMatch.editProfileSelf")
                  }
                  onPress={() => setEditingProfile(true)}
                />
              ) : null}
            </CustomerEmpty>
          ) : !ranked.length ? (
            <CustomerEmpty
              Icon={Search}
              title={t("customerRound2.noProviders")}
              body={t("customerRound2.noProvidersBody")}
            >
              <Button label={t("category.filters")} onPress={() => router.push("/search")} />
            </CustomerEmpty>
          ) : null}
          {!ranked.length && deliveryMode === "in_person" ? (
            <InPersonComingSoonCard
              serviceId={serviceId || null}
              onShowOnline={onlineChoosable ? () => chooseMode("online") : undefined}
            />
          ) : null}
          <View style={{ gap: space.md }}>
            {ranked.map((p) => (
              <View key={p.id} style={{ gap: space.xs }}>
                <ProviderCard
                  provider={p}
                  onPress={() => {
                    const cap = matchCriteria
                      ? matchedCapabilityFor(p.id, caps.data ?? [], matchCriteria)
                      : null;
                    const extra: Record<string, string> = {};
                    if (category === "tutoring" && learnerFamilyMemberId(student))
                      extra.forWhom = student;
                    if (cap) {
                      extra.capabilityId = cap.id;
                      extra.serviceId = cap.serviceId;
                    }
                    router.push({
                      pathname: "/provider/[id]",
                      params:
                        deliveryMode === "online"
                          ? { id: p.id, serviceMode: "online", ...extra }
                          : p.services[0]?.service?.id
                            ? { id: p.id, serviceId: p.services[0].service.id, ...extra }
                            : { id: p.id, ...extra },
                    });
                  }}
                />
                {matchCriteria && learner?.kind === "child" && studentProfile.studentFirstName ? (
                  <Text
                    size="xs"
                    weight="bold"
                    tone="brand"
                    style={{ paddingHorizontal: space.lg }}
                  >
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
      {!selectedAddress && deliveryMode === "in_person" ? (
        <InPersonComingSoonCard
          serviceId={serviceId || null}
          onShowOnline={onlineChoosable ? () => chooseMode("online") : undefined}
        />
      ) : null}
    </Page>
  );
}
