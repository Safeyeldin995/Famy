/**
 * «أبنائي» / «بياناتي الدراسية» (issue #536 PR 2): the system and grade of the account
 * owner and each child, shared by the app-style page (/account/students) and the
 * website (/online/students). The 1 September «صح؟» notification opens it with
 * `?confirm=self` or `?confirm=<child id>`.
 */
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { LineChart, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Card,
  EmptyState,
  ErrorState,
  PrimaryButton,
  ReasonDialog,
  SecondaryButton,
} from "@/components/famio/ui";
import { StudentProfileSteps, gradeLabel } from "@/components/student/StudentProfileSteps";
import { AddChildSheet } from "@/components/student/AddChildSheet";
import { useAuth } from "@/lib/auth/useAuth";
import { useMyProfile } from "@/lib/db/queries";
import { useActiveFamilyMembers, useDeactivateFamilyMember } from "@/lib/db/family-members-queries";
import {
  useCustomerEducationProfile,
  useSaveStudentEducationProfile,
} from "@/lib/db/student-education-queries";
import { useTeachingLevels } from "@/lib/db/teaching-queries";
import { useConfirmStudentGrade, useCurriculaWithStyle } from "@/lib/db/student-match-queries";
import { currentLang } from "@/lib/i18n";
import {
  MYSELF_LEARNER_ID,
  buildLearnerOptions,
  learnerFamilyMemberId,
  type LearnerOption,
} from "@/lib/tutoring/studentLearnerFlow";

export function StudentsManager({
  confirm,
  onClearConfirm,
  signInTo,
  progressHref,
}: {
  confirm: string | undefined;
  onClearConfirm: () => void;
  signInTo: string;
  /** «تقدم {name}» link per learner (family member id, or null for the account owner). */
  progressHref?: (familyMemberId: string | null) => string;
}) {
  const { t } = useTranslation();
  const lang = currentLang();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const profileQ = useMyProfile();
  const membersQ = useActiveFamilyMembers();
  const educationQ = useCustomerEducationProfile();
  const curriculaQ = useCurriculaWithStyle();
  const levelsQ = useTeachingLevels();
  const save = useSaveStudentEducationProfile();
  const confirmGrade = useConfirmStudentGrade();
  const deactivate = useDeactivateFamilyMember();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [addingChild, setAddingChild] = useState(false);

  const learners = buildLearnerOptions({
    selfFullName: profileQ.data?.full_name,
    selfProfile: educationQ.data,
    children: (membersQ.data ?? []).map((m) => ({
      id: m.id,
      full_name: m.full_name,
      education_curriculum_id: m.education_curriculum_id,
      education_level_id: m.education_level_id,
    })),
  });
  const curricula = curriculaQ.data ?? [];
  const levels = levelsQ.data ?? [];
  const confirmId = confirm === "self" ? MYSELF_LEARNER_ID : confirm;
  const confirmLearner = learners.find((l) => l.id === confirmId) ?? null;

  const describe = (l: LearnerOption) => {
    const c = curricula.find((row) => row.id === l.curriculumId) ?? null;
    const lv = levels.find((row) => row.id === l.levelId) ?? null;
    if (!c || !lv) return t("studentMatch.page.notSet");
    return `${lang === "ar" ? c.name_ar : c.name_en} · ${gradeLabel(lv, c, lang)}`;
  };
  const displayName = (l: LearnerOption) =>
    l.kind === "self" ? t("studentMatch.page.self") : (l.firstName ?? "");

  const clearConfirm = onClearConfirm;

  const onSave = async (l: LearnerOption, picked: { curriculumId: string; levelId: string }) => {
    try {
      await save.save({
        forWhom: l.id,
        education_curriculum_id: picked.curriculumId,
        education_level_id: picked.levelId,
      });
      // Editing the grade after the «صح؟» question also confirms it for this school year.
      if (confirmId === l.id) {
        await confirmGrade.mutateAsync(learnerFamilyMemberId(l.id)).catch(() => undefined);
        clearConfirm();
      }
      setEditingId(null);
      toast.success(t("studentMatch.saved"));
    } catch {
      toast.error(t("studentMatch.saveFailed"));
    }
  };

  const onConfirm = async (l: LearnerOption) => {
    try {
      await confirmGrade.mutateAsync(learnerFamilyMemberId(l.id));
      toast.success(t("studentMatch.page.confirmed"));
      clearConfirm();
    } catch {
      toast.error(t("studentMatch.saveFailed"));
    }
  };

  const loading =
    authLoading ||
    profileQ.isLoading ||
    membersQ.isLoading ||
    educationQ.isLoading ||
    curriculaQ.isLoading ||
    levelsQ.isLoading;
  const error = membersQ.isError || educationQ.isError || curriculaQ.isError || levelsQ.isError;
  const children = learners.filter((l) => l.kind === "child");

  return (
    <>
      <div className="space-y-3">
        {!authLoading && !isAuthenticated ? (
          <EmptyState
            icon="users"
            title={t("studentMatch.notifySignIn")}
            action={
              <Link
                to={signInTo}
                className="focus-ring inline-flex min-h-11 items-center rounded-2xl bg-brand px-5 py-3 text-pro-14 font-extrabold text-brand-foreground"
              >
                {t("auth.signIn", "Sign in")}
              </Link>
            }
          />
        ) : loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-3xl bg-surface-2" />
          ))
        ) : error ? (
          <ErrorState
            onRetry={() => {
              void membersQ.refetch();
              void educationQ.refetch();
              void curriculaQ.refetch();
              void levelsQ.refetch();
            }}
          />
        ) : (
          <>
            {confirmLearner && confirmLearner.levelId && editingId !== confirmLearner.id ? (
              <Card className="space-y-3 border border-brand/30 p-4">
                <p className="text-pro-16 font-extrabold">
                  {confirmLearner.kind === "self"
                    ? t("studentMatch.page.confirmTitleSelf", { grade: describe(confirmLearner) })
                    : t("studentMatch.page.confirmTitle", {
                        name: confirmLearner.firstName ?? "",
                        grade: describe(confirmLearner),
                      })}
                </p>
                <div className="flex flex-wrap gap-2">
                  <PrimaryButton
                    type="button"
                    className="h-11 px-6"
                    disabled={confirmGrade.isPending}
                    onClick={() => void onConfirm(confirmLearner)}
                  >
                    {t("studentMatch.page.confirmYes")}
                  </PrimaryButton>
                  <SecondaryButton
                    type="button"
                    className="h-11 px-6"
                    onClick={() => setEditingId(confirmLearner.id)}
                  >
                    {t("studentMatch.page.confirmEdit")}
                  </SecondaryButton>
                </div>
              </Card>
            ) : null}

            {learners.map((l) =>
              editingId === l.id ? (
                <StudentProfileSteps
                  key={l.id}
                  title={
                    l.kind === "self"
                      ? t("studentMatch.profileTitleSelf")
                      : t("studentMatch.profileTitle", { name: l.firstName ?? "" })
                  }
                  curricula={curricula}
                  levels={levels}
                  initialCurriculumId={l.curriculumId}
                  initialLevelId={l.levelId}
                  saving={save.isPending}
                  onDone={(picked) => void onSave(l, picked)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <Card key={l.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-pro-16 font-extrabold">{displayName(l)}</p>
                      <p className="mt-0.5 text-pro-13 text-muted-foreground">{describe(l)}</p>
                      {progressHref ? (
                        <Link
                          to={progressHref(learnerFamilyMemberId(l.id))}
                          className="focus-ring mt-1.5 inline-flex min-h-11 items-center gap-1.5 text-pro-13 font-bold text-brand"
                          data-testid="learner-progress-link"
                        >
                          <LineChart className="h-4 w-4" aria-hidden />
                          {l.kind === "self"
                            ? t("learnerProgress.selfLinkLabel")
                            : t("learnerProgress.linkLabel", { name: l.firstName ?? "" })}
                        </Link>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        className="focus-ring inline-flex min-h-11 items-center gap-1 rounded-full bg-surface-2 px-3 text-pro-12 font-extrabold"
                        onClick={() => setEditingId(l.id)}
                        aria-label={`${t("studentMatch.page.edit")} ${displayName(l)}`}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden /> {t("studentMatch.page.edit")}
                      </button>
                      {l.kind === "child" ? (
                        <button
                          type="button"
                          className="focus-ring inline-flex min-h-11 items-center gap-1 rounded-full bg-brand/8 px-3 text-pro-12 font-extrabold text-brand"
                          onClick={() => setRemoveId(l.id)}
                          aria-label={`${t("studentMatch.page.remove")} ${displayName(l)}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />{" "}
                          {t("studentMatch.page.remove")}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </Card>
              ),
            )}
            {children.length === 0 ? (
              <p className="text-pro-13 text-muted-foreground">{t("studentMatch.page.empty")}</p>
            ) : null}
            <PrimaryButton
              type="button"
              className="h-12 w-full"
              onClick={() => setAddingChild(true)}
            >
              <Plus className="h-4 w-4" aria-hidden /> {t("studentMatch.page.addChild")}
            </PrimaryButton>
          </>
        )}
      </div>

      <ReasonDialog
        open={!!removeId}
        title={t("studentMatch.page.removeConfirm", {
          name: learners.find((l) => l.id === removeId)?.firstName ?? "",
        })}
        body={t("familyMembers.deactivateBody")}
        confirmLabel={t("studentMatch.page.remove")}
        cancelLabel={t("common.cancel")}
        confirmVariant="coral"
        requireReason={false}
        pending={deactivate.isPending}
        onCancel={() => setRemoveId(null)}
        onConfirm={() => {
          if (!removeId) return;
          deactivate.mutate(removeId, {
            onSuccess: () => {
              setRemoveId(null);
              toast.success(t("studentMatch.page.removed"));
            },
            onError: () => toast.error(t("common.somethingWentWrong")),
          });
        }}
      />
      {addingChild ? (
        <AddChildSheet
          onClose={() => setAddingChild(false)}
          onCreated={(child) => {
            setAddingChild(false);
            // Ask for the new child's system and grade right away if the form left them empty.
            if (!child.education_curriculum_id || !child.education_level_id) {
              setEditingId(child.id);
            }
          }}
        />
      ) : null}
    </>
  );
}
