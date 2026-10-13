import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAdminTeachingCapabilities } from "@/lib/db/teaching-queries";
import { useAdminReviewTeachingGroup } from "@/lib/db/teaching-group-queries";
import { groupTeachingRows } from "@/lib/tutoring/teachingGroups";
import { currentLang } from "@/lib/i18n";
import { AdminQueryError } from "@/components/admin/AdminQueryError";

export function TeachingCapabilityReviewQueue({ providerId }: { providerId: string }) {
  const { t } = useTranslation();
  const lang = currentLang() === "ar" ? "ar" : "en";
  const list = useAdminTeachingCapabilities(providerId);
  const review = useAdminReviewTeachingGroup();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const groups = groupTeachingRows(list.data ?? []);

  if (list.isLoading) return <div className="h-16 animate-pulse rounded-xl bg-muted" />;
  if (list.isError) return <AdminQueryError compact message={t("admin.providers.loadError")} error={list.error} onRetry={() => list.refetch()} />;
  if (groups.length === 0) return <p className="text-sm text-muted-foreground">{t("adminReview.noTeachingGroups")}</p>;

  return (
    <ul className="space-y-3">
      {groups.map((group) => {
        const pending = group.rows.filter((row) => row.status === "pending");
        const orderedLevels = [...group.rows].sort((a, b) =>
          (a.level_code ?? "").localeCompare(b.level_code ?? "", "en", { numeric: true }),
        );
        const levelNames = orderedLevels.map((row) => lang === "ar" ? row.level_name_ar : row.level_name_en);
        const gradeNumbers = orderedLevels.map((row) => Number(/^grade-(\d+)$/.exec(row.level_code ?? "")?.[1]));
        const consecutive = gradeNumbers.every((grade, index) =>
          Number.isInteger(grade) && (index === 0 || grade === gradeNumbers[index - 1] + 1),
        );
        const levels = levelNames.length > 2 && consecutive
          ? t("adminReview.levelRange", { first: levelNames[0], last: levelNames[levelNames.length - 1] })
          : levelNames.join(lang === "ar" ? "، " : ", ");
        const subject = lang === "ar" ? group.first.subject_name_ar : group.first.subject_name_en;
        const curriculum = lang === "ar" ? group.first.curriculum_name_ar : group.first.curriculum_name_en;
        const price = Number(group.first.session_price).toLocaleString("en-US");
        const note = notes[group.key] ?? "";

        const decide = (status: "approved" | "rejected") => {
          review.mutate({ ids: pending.map((row) => row.id), status, note: note.trim() || undefined }, {
            onSuccess: () => { setNotes((current) => ({ ...current, [group.key]: "" })); toast.success(t("teaching.reviewSaved")); },
            onError: () => toast.error(t("common.somethingWentWrong")),
          });
        };

        return (
          <li key={group.key} className="rounded-xl border border-border p-3">
            <p className="text-sm font-bold">{subject} · {curriculum} · {levels} · {t("adminReview.sessionPrice", { amount: price })}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("adminReview.groupStatus", { status: pending.length > 0 ? t("teaching.status.pending") : t(`teaching.status.${group.first.status}`) })}
            </p>
            {pending.length > 0 && (
              <>
                <label className="mt-3 block text-sm font-semibold" htmlFor={`group-note-${group.key}`}>
                  {t("adminReview.reason")}
                </label>
                <textarea id={`group-note-${group.key}`} value={note}
                  onChange={(event) => setNotes((current) => ({ ...current, [group.key]: event.target.value }))}
                  rows={2} className="mt-1 w-full rounded-xl border border-border bg-surface p-3 text-sm" />
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" disabled={review.isPending} onClick={() => decide("approved")}
                    className="focus-ring min-h-11 rounded-xl bg-brand px-4 text-sm font-bold text-brand-foreground disabled:opacity-50">
                    {t("adminReview.approve")}
                  </button>
                  <button type="button" disabled={review.isPending || !note.trim()} onClick={() => decide("rejected")}
                    className="focus-ring min-h-11 rounded-xl border border-coral px-4 text-sm font-bold text-coral disabled:opacity-50">
                    {t("adminReview.reject")}
                  </button>
                </div>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
