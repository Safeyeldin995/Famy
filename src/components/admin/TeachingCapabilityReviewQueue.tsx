import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useAdminReviewTeachingCapability,
  useAdminTeachingCapabilities,
} from "@/lib/db/teaching-queries";
import { formatTeachingCapabilityLine } from "@/lib/tutoring/teachingCapabilities";
import { useAdminReviewTeachingGroup } from "@/lib/db/teaching-group-queries";
import { groupTeachingRows } from "@/lib/tutoring/teachingGroups";
import { currentLang } from "@/lib/i18n";

export function TeachingCapabilityReviewQueue({ providerId }: { providerId: string }) {
  const { t } = useTranslation();
  const lang = currentLang() === "ar" ? "ar" : "en";
  const list = useAdminTeachingCapabilities(providerId);
  const review = useAdminReviewTeachingCapability();
  const reviewGroup = useAdminReviewTeachingGroup();
  const [notes, setNotes] = useState<Record<string, string>>({});

  if (list.isLoading) return <div className="h-16 animate-pulse rounded-xl bg-muted" />;
  const rows = list.data ?? [];

  return (
    <section className="rounded-2xl border border-border/60 bg-surface p-4 shadow-sm">
      <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
        {t("teaching.adminQueueTitle")}
      </h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">{t("teaching.adminQueueEmpty")}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {groupTeachingRows(rows).map((group) => (
            <li key={group.key} className="rounded-xl border border-border/60 p-3">
              <p className="text-xs font-bold">{formatTeachingCapabilityLine({
                subject: lang === "ar" ? group.first.subject_name_ar : group.first.subject_name_en,
                curriculum: lang === "ar" ? group.first.curriculum_name_ar : group.first.curriculum_name_en,
                level: group.rows.map(row => lang === "ar" ? row.level_name_ar : row.level_name_en).join(" · "),
                durationMin: group.first.session_duration_min,
                price: group.first.session_price,
              })}</p>
              <div className="mt-1 flex gap-2 text-[10px] font-extrabold uppercase">
                {[...new Set(group.rows.map(row => row.status))].map(status => <span key={status}>{t(`teaching.status.${status}`)}</span>)}
              </div>
              <textarea
                aria-label={t("teaching.adminNote")}
                value={notes[group.key] ?? ""}
                onChange={e => setNotes(current => ({ ...current, [group.key]: e.target.value }))}
                placeholder={t("teaching.adminNotePlaceholder")}
                className="mt-2 h-16 w-full rounded-xl border border-border bg-surface px-3 py-2 text-xs"
              />
              <div className="mt-2 flex gap-2">
                {(["approved", "rejected"] as const).map(status => (
                  <button key={status} type="button" disabled={reviewGroup.isPending || review.isPending}
                    onClick={() => reviewGroup.mutate({ ids: group.rows.map(row => row.id), status, note: notes[group.key] }, {
                      onSuccess: () => toast.success(t("teaching.reviewSaved")),
                      onError: () => toast.error(t("common.somethingWentWrong")),
                    })}
                    className="h-11 rounded-lg border border-border px-3 text-[11px] font-bold"
                  >{t(`teaching.status.${status}`)}</button>
                ))}
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-bold">{t("providerSetup.reviewLevels")}</summary>
                <ul className="mt-2 space-y-2">
          {group.rows.map((row) => {
            const line = formatTeachingCapabilityLine({
              subject: lang === "ar" ? row.subject_name_ar : row.subject_name_en,
              curriculum: lang === "ar" ? row.curriculum_name_ar : row.curriculum_name_en,
              level: lang === "ar" ? row.level_name_ar : row.level_name_en,
              durationMin: row.session_duration_min,
              price: row.session_price,
            });
            return (
              <li key={row.id} className="rounded-xl border border-border/60 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-bold">{line}</p>
                  <span className="text-[10px] font-extrabold uppercase">
                    {t(`teaching.status.${row.status}`)}
                  </span>
                </div>
                {row.review_note ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {t("teaching.adminNote")}: {row.review_note}
                  </p>
                ) : null}
                <textarea
                  value={notes[row.id] ?? ""}
                  onChange={(e) =>
                    setNotes((current) => ({ ...current, [row.id]: e.target.value }))
                  }
                  placeholder={t("teaching.adminNotePlaceholder")}
                  className="mt-2 h-16 w-full rounded-xl border border-border bg-surface px-3 py-2 text-xs"
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {(["approved", "rejected", "suspended"] as const).map((status) => (
                    <button
                      key={status}
                      type="button"
                      disabled={review.isPending || reviewGroup.isPending}
                      onClick={() =>
                        review.mutate(
                          { id: row.id, status, note: notes[row.id] },
                          {
                            onSuccess: () => toast.success(t("teaching.reviewSaved")),
                            onError: (error: unknown) =>
                              toast.error(
                                error instanceof Error
                                  ? error.message
                                  : t("common.somethingWentWrong"),
                              ),
                          },
                        )
                      }
                      className="h-9 rounded-lg border border-border px-3 text-[11px] font-bold"
                    >
                      {t(`teaching.status.${status}`)}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
