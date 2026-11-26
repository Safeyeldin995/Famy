/**
 * /online tutors: «الحجز لمين؟» → (system + grade if missing) → subject → only matching tutors.
 * Issue #536 PR 2. No filter UI: the learner's saved system and grade drive the match.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Bell, Pencil, Plus } from "lucide-react";
import { EmptyState, PrimaryButton, SecondaryButton } from "@/components/famio/ui";
import { QueryError } from "@/components/famio/QueryError";
import {
  StudentProfileSteps,
  chipClass,
  gradeLabel,
} from "@/components/student/StudentProfileSteps";
import { useAuth } from "@/lib/auth/useAuth";
import { useMarketplaceServices, useMyProfile } from "@/lib/db/queries";
import { useActiveFamilyMembers } from "@/lib/db/family-members-queries";
import {
  useCustomerEducationProfile,
  useSaveStudentEducationProfile,
  useUpsertCustomerEducationProfile,
} from "@/lib/db/student-education-queries";
import {
  useTeachingLevels,
  useTeachingSubjectServices,
  useTeachingSubjects,
} from "@/lib/db/teaching-queries";
import {
  useCurriculaWithStyle,
  useMatchTutorsForStudent,
  useRequestTutorAvailability,
  type MatchedTutorRow,
} from "@/lib/db/student-match-queries";
import { currentLang } from "@/lib/i18n";
import { tutoringServiceKind } from "@/lib/tutoring/tutoringProviderMatch";
import {
  MYSELF_LEARNER_ID,
  buildLearnerOptions,
  findLearner,
  initialLearnerId,
  learnerFamilyMemberId,
  matchRpcArgs,
  nextMatchStep,
  noMatchDescription,
  parsePendingGuestProfile,
  shouldApplyPendingGuestProfile,
  shouldAskForWhom,
  skillLevels,
  subjectsForService,
  type LearnerOption,
} from "@/lib/tutoring/studentLearnerFlow";

const LEARNER_KEY = "famy.match.learner";
const SERVICE_KEY = "famy.match.service";
export const PENDING_GUEST_PROFILE_KEY = "famy.match.guestProfile";

function readStorage(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: string | null) {
  try {
    if (typeof window === "undefined") return;
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage can be blocked; the flow still works for this visit */
  }
}

export type OnlineStudentMatch = {
  /** The controls (learner, profile steps, service, subject). */
  panel: ReactNode;
  /** True once a full match query ran: the page then shows only `matched`. */
  active: boolean;
  loading: boolean;
  error: boolean;
  matched: Map<string, MatchedTutorRow>;
  /** «مناسب لـ {name}» badge text, or null. */
  badge: string | null;
  /** Shown instead of the list when nobody matches. */
  emptyState: ReactNode;
  /** Booking page search params for a matched tutor. */
  requestSearch: (providerId: string) => { learner?: string; cap?: string };
};

export function useOnlineStudentMatch(): OnlineStudentMatch {
  const { t } = useTranslation();
  const lang = currentLang();
  const nav = useNavigate();
  const { isAuthenticated } = useAuth();

  const servicesQ = useMarketplaceServices("tutoring");
  const curriculaQ = useCurriculaWithStyle();
  const levelsQ = useTeachingLevels();
  const subjectsQ = useTeachingSubjects();
  const subjectServicesQ = useTeachingSubjectServices();
  const membersQ = useActiveFamilyMembers();
  const educationQ = useCustomerEducationProfile();
  const profileQ = useMyProfile();
  const saveProfile = useSaveStudentEducationProfile();
  const upsertSelf = useUpsertCustomerEducationProfile();
  const requestDemand = useRequestTutorAvailability();

  const services = servicesQ.data ?? [];
  const [serviceId, setServiceIdState] = useState<string | null>(() => readStorage(SERVICE_KEY));
  const service = services.find((s) => s.id === serviceId) ?? services[0] ?? null;
  const serviceSlug = service?.slug ?? null;
  const kind = tutoringServiceKind(serviceSlug);

  const learners: LearnerOption[] = useMemo(
    () =>
      isAuthenticated
        ? buildLearnerOptions({
            selfFullName: profileQ.data?.full_name,
            selfProfile: educationQ.data,
            children: (membersQ.data ?? []).map((m) => ({
              id: m.id,
              full_name: m.full_name,
              education_curriculum_id: m.education_curriculum_id,
              education_level_id: m.education_level_id,
            })),
          })
        : [],
    [isAuthenticated, profileQ.data?.full_name, educationQ.data, membersQ.data],
  );
  const [learnerId, setLearnerIdState] = useState<string>(
    () => readStorage(LEARNER_KEY) ?? MYSELF_LEARNER_ID,
  );
  useEffect(() => {
    if (learners.length) setLearnerIdState((cur) => initialLearnerId(learners, cur));
  }, [learners]);

  // Guests pick system + grade inline; kept in the browser and saved after sign-up.
  const [guestProfile, setGuestProfile] = useState(() =>
    parsePendingGuestProfile(readStorage(PENDING_GUEST_PROFILE_KEY)),
  );
  const guestLearner: LearnerOption | null = guestProfile
    ? {
        id: MYSELF_LEARNER_ID,
        kind: "self",
        firstName: null,
        curriculumId: guestProfile.curriculumId,
        levelId: guestProfile.levelId,
      }
    : { id: MYSELF_LEARNER_ID, kind: "self", firstName: null, curriculumId: null, levelId: null };
  const learner = isAuthenticated ? findLearner(learners, learnerId) : guestLearner;

  // After sign-up: save the guest picks to the student's own profile once, if it is still empty.
  useEffect(() => {
    // Wait for a successful read: a failed read must not look like an empty profile.
    if (!isAuthenticated || !educationQ.isSuccess || upsertSelf.isPending) return;
    const pending = parsePendingGuestProfile(readStorage(PENDING_GUEST_PROFILE_KEY));
    if (!shouldApplyPendingGuestProfile(pending, educationQ.data)) {
      if (pending) writeStorage(PENDING_GUEST_PROFILE_KEY, null);
      return;
    }
    writeStorage(PENDING_GUEST_PROFILE_KEY, null);
    upsertSelf.mutate({
      education_curriculum_id: pending!.curriculumId,
      education_level_id: pending!.levelId,
    });
  }, [isAuthenticated, educationQ.isSuccess, educationQ.data, upsertSelf]);

  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [skillLevelId, setSkillLevelId] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [demandSent, setDemandSent] = useState(false);

  const subjects = subjectsForService(
    subjectsQ.data ?? [],
    subjectServicesQ.data ?? [],
    service?.id,
  );
  const skills = skillLevels(levelsQ.data ?? []);
  const curricula = curriculaQ.data ?? [];

  const step = nextMatchStep({ learner, serviceSlug, subjectId, skillLevelId });
  const showProfileSteps = (step === "profile" || editingProfile) && Boolean(service);
  const args =
    step === "results" && service && !editingProfile
      ? matchRpcArgs({
          serviceId: service.id,
          serviceSlug,
          subjectId,
          skillLevelId,
          learner,
          serviceMode: "online",
        })
      : null;
  const matchQ = useMatchTutorsForStudent(args);
  const matched = useMemo(
    () => new Map((matchQ.data ?? []).map((row) => [row.provider_id, row])),
    [matchQ.data],
  );

  const setService = (id: string) => {
    setServiceIdState(id);
    writeStorage(SERVICE_KEY, id);
    setSubjectId(null);
    setSkillLevelId(null);
    setDemandSent(false);
  };
  const setLearner = (id: string) => {
    setLearnerIdState(id);
    writeStorage(LEARNER_KEY, id);
    setEditingProfile(false);
    setDemandSent(false);
  };

  const learnerName = learner?.kind === "child" ? learner.firstName : null;
  const curriculum = curricula.find((c) => c.id === learner?.curriculumId) ?? null;
  const level = (levelsQ.data ?? []).find((l) => l.id === learner?.levelId) ?? null;
  const subject = subjects.find((s) => s.id === subjectId) ?? null;
  const skill = skills.find((s) => s.id === skillLevelId) ?? null;
  const name = (row: { name_ar: string; name_en: string } | null) =>
    row ? (lang === "ar" ? row.name_ar : row.name_en) : null;

  const saveLearnerProfile = async (picked: { curriculumId: string; levelId: string }) => {
    if (!isAuthenticated) {
      const next = { curriculumId: picked.curriculumId, levelId: picked.levelId };
      writeStorage(PENDING_GUEST_PROFILE_KEY, JSON.stringify(next));
      setGuestProfile(next);
      setEditingProfile(false);
      return;
    }
    try {
      await saveProfile.save({
        forWhom: learnerId,
        education_curriculum_id: picked.curriculumId,
        education_level_id: picked.levelId,
      });
      toast.success(t("studentMatch.saved"));
      setEditingProfile(false);
    } catch {
      toast.error(t("studentMatch.saveFailed"));
    }
  };

  const notifyMe = async () => {
    if (!service) return;
    if (!isAuthenticated) {
      toast.info(t("studentMatch.notifySignIn"));
      void nav({ to: "/online/login", search: { returnTo: "/online/tutors" } });
      return;
    }
    const a = matchRpcArgs({
      serviceId: service.id,
      serviceSlug,
      subjectId,
      skillLevelId,
      learner,
      serviceMode: "online",
    });
    try {
      const res = await requestDemand.mutateAsync({
        serviceId: service.id,
        subjectId: a.p_subject_id,
        curriculumId: a.p_curriculum_id,
        levelId: a.p_level_id,
        serviceMode: "online",
        familyMemberId: learnerFamilyMemberId(learnerId),
      });
      setDemandSent(true);
      toast.success(
        t(
          res?.status === "already_requested"
            ? "studentMatch.notifyAlready"
            : "studentMatch.notifyDone",
        ),
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      toast.error(
        t(
          msg.includes("DEMAND_RATE_LIMITED")
            ? "studentMatch.notifyLimit"
            : "studentMatch.saveFailed",
        ),
      );
    }
  };

  const catalogError =
    servicesQ.isError ||
    curriculaQ.isError ||
    levelsQ.isError ||
    subjectsQ.isError ||
    subjectServicesQ.isError;
  const learnerError = isAuthenticated && (membersQ.isError || educationQ.isError);

  const panel = (
    <div className="space-y-4 rounded-3xl bg-surface p-4 shadow-sm sm:p-5">
      {catalogError || learnerError ? (
        <QueryError
          onRetry={() => {
            void servicesQ.refetch();
            void curriculaQ.refetch();
            void levelsQ.refetch();
            void subjectsQ.refetch();
            void subjectServicesQ.refetch();
            void membersQ.refetch();
            void educationQ.refetch();
          }}
        />
      ) : null}

      {!isAuthenticated ? (
        <p className="text-pro-14 text-muted-foreground">{t("studentMatch.guestHint")}</p>
      ) : null}

      {isAuthenticated && shouldAskForWhom(learners) ? (
        <div className="space-y-2">
          <p className="text-pro-13 font-bold text-muted-foreground">
            {t("studentMatch.forWhomTitle")}
          </p>
          <div
            className="online-web-nav-scroll flex gap-2 overflow-x-auto pb-1"
            role="group"
            aria-label={t("studentMatch.forWhomTitle")}
          >
            {learners.map((l) => (
              <button
                key={l.id}
                type="button"
                className={chipClass(l.id === learnerId)}
                aria-pressed={l.id === learnerId}
                onClick={() => setLearner(l.id)}
              >
                {l.kind === "self" ? t("studentMatch.me") : l.firstName}
              </button>
            ))}
            <button
              type="button"
              className={`${chipClass(false)} inline-flex items-center gap-1`}
              onClick={() => void nav({ to: "/family-members/new" })}
            >
              <Plus className="h-4 w-4" aria-hidden />
              {t("studentMatch.addChild")}
            </button>
          </div>
        </div>
      ) : isAuthenticated ? (
        <div className="flex">
          <button
            type="button"
            className={`${chipClass(false)} inline-flex items-center gap-1`}
            onClick={() => void nav({ to: "/family-members/new" })}
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t("studentMatch.addChild")}
          </button>
        </div>
      ) : null}

      {services.length > 1 ? (
        <div className="space-y-2">
          <p className="text-pro-13 font-bold text-muted-foreground">
            {t("studentMatch.serviceTitle")}
          </p>
          <div
            className="online-web-nav-scroll flex gap-2 overflow-x-auto pb-1"
            role="group"
            aria-label={t("studentMatch.serviceTitle")}
          >
            {services.map((s) => (
              <button
                key={s.id}
                type="button"
                className={chipClass(s.id === service?.id)}
                aria-pressed={s.id === service?.id}
                onClick={() => setService(s.id)}
              >
                {name(s)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {showProfileSteps ? (
        <StudentProfileSteps
          key={`${learnerId}-${editingProfile}`}
          title={
            learnerName
              ? t("studentMatch.profileTitle", { name: learnerName })
              : t("studentMatch.profileTitleSelf")
          }
          curricula={curricula}
          levels={levelsQ.data ?? []}
          initialCurriculumId={learner?.curriculumId}
          initialLevelId={learner?.levelId}
          saving={saveProfile.isPending}
          onDone={(picked) => void saveLearnerProfile(picked)}
          onCancel={editingProfile ? () => setEditingProfile(false) : undefined}
        />
      ) : (
        <>
          {learner?.curriculumId && kind !== "skill" ? (
            <div className="flex flex-wrap items-center gap-2 text-pro-13">
              <span className="rounded-full bg-brand/10 px-3 py-1 font-bold text-brand">
                {[name(curriculum), gradeLabel(level, curriculum, lang)]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <button
                type="button"
                className="focus-ring inline-flex min-h-11 items-center gap-1 font-bold text-muted-foreground hover:text-foreground"
                onClick={() => setEditingProfile(true)}
              >
                <Pencil className="h-4 w-4" aria-hidden />
                {learnerName
                  ? t("studentMatch.editProfile", { name: learnerName })
                  : t("studentMatch.editProfileSelf")}
              </button>
            </div>
          ) : null}
          {kind !== "homework" && subjects.length ? (
            <div className="space-y-2">
              <p className="text-pro-13 font-bold text-muted-foreground">
                {t("studentMatch.subjectTitle")}
              </p>
              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label={t("studentMatch.subjectTitle")}
              >
                {subjects.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={chipClass(s.id === subjectId)}
                    aria-pressed={s.id === subjectId}
                    onClick={() => {
                      setSubjectId(s.id);
                      setDemandSent(false);
                    }}
                  >
                    {name(s)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {kind === "skill" && subjectId ? (
            <div className="space-y-2">
              <p className="text-pro-13 font-bold text-muted-foreground">
                {t("studentMatch.levelTitle")}
              </p>
              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label={t("studentMatch.levelTitle")}
              >
                {skills.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={chipClass(s.id === skillLevelId)}
                    aria-pressed={s.id === skillLevelId}
                    onClick={() => {
                      setSkillLevelId(s.id);
                      setDemandSent(false);
                    }}
                  >
                    {name(s)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );

  const what = noMatchDescription({
    subject: kind === "homework" ? name(service) : name(subject),
    grade: kind === "skill" ? name(skill) : gradeLabel(level, curriculum, lang) || null,
    system: kind === "skill" ? null : name(curriculum),
  });

  const emptyState = (
    <EmptyState
      title={t("studentMatch.noMatch", { what })}
      body={t("studentMatch.noMatchBody")}
      action={
        <div className="flex flex-wrap justify-center gap-3">
          <PrimaryButton
            type="button"
            className="h-12 px-6"
            disabled={demandSent || requestDemand.isPending}
            onClick={() => void notifyMe()}
          >
            <Bell className="h-4 w-4" aria-hidden />
            {t("studentMatch.notifyMe")}
          </PrimaryButton>
          {kind !== "skill" ? (
            <SecondaryButton
              type="button"
              className="h-12 px-6"
              onClick={() => setEditingProfile(true)}
            >
              {learnerName
                ? t("studentMatch.editProfile", { name: learnerName })
                : t("studentMatch.editProfileSelf")}
            </SecondaryButton>
          ) : null}
        </div>
      }
    />
  );

  const active = Boolean(args) && !matchQ.isError;
  return {
    panel,
    active,
    loading: Boolean(args) && matchQ.isLoading,
    error: matchQ.isError,
    matched,
    badge:
      learner?.kind === "child" && learner.firstName
        ? t("studentEducation.matchBadge", { name: learner.firstName })
        : null,
    emptyState,
    requestSearch: (providerId: string) => {
      const out: { learner?: string; cap?: string } = {};
      if (learnerId !== MYSELF_LEARNER_ID) out.learner = learnerId;
      const row = matched.get(providerId);
      if (row?.capability_id) out.cap = row.capability_id;
      return out;
    },
  };
}
