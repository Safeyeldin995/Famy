import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  upsertTeachingTaxonomyRow,
  useTeachingCurricula,
  useTeachingLevels,
  useTeachingSubjects,
} from "@/lib/db/teaching-queries";
import { SESSION_DURATIONS_MIN } from "@/lib/tutoring/teachingCapabilities";

function TaxonomySection({
  title,
  table,
  rows,
  includeMaxDuration,
}: {
  title: string;
  table: "teaching_curricula" | "teaching_levels" | "teaching_subjects";
  rows: Array<{
    id: string;
    code: string;
    name_en: string;
    name_ar: string;
    is_active: boolean;
    sort_order: number;
    max_session_duration_min?: number;
  }>;
  includeMaxDuration?: boolean;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [maxMin, setMaxMin] = useState(120);
  const [drafts, setDrafts] = useState<
    Record<string, { name_en: string; name_ar: string; max?: number }>
  >({});

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["teaching-curricula"] });
    qc.invalidateQueries({ queryKey: ["teaching-levels"] });
    qc.invalidateQueries({ queryKey: ["teaching-subjects"] });
  };

  return (
    <section className="rounded-2xl border border-border/60 bg-surface p-4">
      <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{title}</h3>
      <ul className="mt-3 space-y-2">
        {rows.map((row) => {
          const draft = drafts[row.id] ?? {
            name_en: row.name_en,
            name_ar: row.name_ar,
            max: row.max_session_duration_min,
          };
          return (
            <li key={row.id} className="rounded-xl border border-border/50 p-2">
              <p className="text-[10px] font-bold uppercase text-muted-foreground">{row.code}</p>
              <div className="mt-1 grid gap-1 sm:grid-cols-2">
                <input
                  value={draft.name_en}
                  onChange={(e) =>
                    setDrafts((current) => ({
                      ...current,
                      [row.id]: { ...draft, name_en: e.target.value },
                    }))
                  }
                  className="h-9 rounded-lg border border-border px-2 text-xs"
                />
                <input
                  dir="rtl"
                  value={draft.name_ar}
                  onChange={(e) =>
                    setDrafts((current) => ({
                      ...current,
                      [row.id]: { ...draft, name_ar: e.target.value },
                    }))
                  }
                  className="h-9 rounded-lg border border-border px-2 text-xs"
                />
              </div>
              {includeMaxDuration ? (
                <select
                  value={draft.max ?? 120}
                  onChange={(e) =>
                    setDrafts((current) => ({
                      ...current,
                      [row.id]: { ...draft, max: Number(e.target.value) },
                    }))
                  }
                  className="mt-1 h-9 rounded-lg border border-border px-2 text-xs"
                >
                  {SESSION_DURATIONS_MIN.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              ) : null}
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  className="text-[11px] font-bold text-brand"
                  onClick={() =>
                    upsertTeachingTaxonomyRow(table, {
                      id: row.id,
                      name_en: draft.name_en,
                      name_ar: draft.name_ar,
                      max_session_duration_min: draft.max,
                    })
                      .then(() => {
                        toast.success(t("teaching.taxonomySaved"));
                        invalidate();
                      })
                      .catch((error: unknown) =>
                        toast.error(
                          error instanceof Error ? error.message : t("common.somethingWentWrong"),
                        ),
                      )
                  }
                >
                  {t("common.save")}
                </button>
                <button
                  type="button"
                  className="text-[11px] font-bold"
                  onClick={() =>
                    upsertTeachingTaxonomyRow(table, {
                      id: row.id,
                      name_en: row.name_en,
                      name_ar: row.name_ar,
                      is_active: !row.is_active,
                    })
                      .then(() => {
                        toast.success(t("teaching.taxonomySaved"));
                        invalidate();
                      })
                      .catch((error: unknown) =>
                        toast.error(
                          error instanceof Error ? error.message : t("common.somethingWentWrong"),
                        ),
                      )
                  }
                >
                  {row.is_active ? t("teaching.deactivate") : t("teaching.activate")}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 grid gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={t("teaching.code")}
          className="h-9 rounded-lg border border-border px-2 text-xs"
        />
        <input
          value={nameEn}
          onChange={(e) => setNameEn(e.target.value)}
          placeholder={t("teaching.nameEn")}
          className="h-9 rounded-lg border border-border px-2 text-xs"
        />
        <input
          dir="rtl"
          value={nameAr}
          onChange={(e) => setNameAr(e.target.value)}
          placeholder={t("teaching.nameAr")}
          className="h-9 rounded-lg border border-border px-2 text-xs"
        />
        {includeMaxDuration ? (
          <select
            value={maxMin}
            onChange={(e) => setMaxMin(Number(e.target.value))}
            className="h-9 rounded-lg border border-border px-2 text-xs"
          >
            {SESSION_DURATIONS_MIN.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          className="h-9 rounded-lg bg-brand text-xs font-extrabold text-brand-foreground"
          onClick={() =>
            upsertTeachingTaxonomyRow(table, {
              code: code.trim(),
              name_en: nameEn.trim(),
              name_ar: nameAr.trim(),
              max_session_duration_min: maxMin,
              sort_order: rows.length + 1,
            })
              .then(() => {
                toast.success(t("teaching.taxonomySaved"));
                setCode("");
                setNameEn("");
                setNameAr("");
                invalidate();
              })
              .catch((error: unknown) =>
                toast.error(
                  error instanceof Error ? error.message : t("common.somethingWentWrong"),
                ),
              )
          }
        >
          {t("teaching.addEntry")}
        </button>
      </div>
    </section>
  );
}

export function TeachingTaxonomyManager() {
  const { t } = useTranslation();
  const curricula = useTeachingCurricula(true);
  const levels = useTeachingLevels(true);
  const subjects = useTeachingSubjects(true);
  return (
    <div className="mt-8 space-y-4">
      <h2 className="text-sm font-extrabold">{t("teaching.taxonomyTitle")}</h2>
      <TaxonomySection
        title={t("teaching.curricula")}
        table="teaching_curricula"
        rows={curricula.data ?? []}
      />
      <TaxonomySection
        title={t("teaching.levels")}
        table="teaching_levels"
        rows={levels.data ?? []}
      />
      <TaxonomySection
        title={t("teaching.subjects")}
        table="teaching_subjects"
        rows={subjects.data ?? []}
        includeMaxDuration
      />
    </div>
  );
}
