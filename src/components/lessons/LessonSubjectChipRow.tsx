import { LessonIllustration } from "@/components/lessons/LessonIllustration";
import { isLessonServiceSlug } from "@/lib/tutoring/lessonServices";

type SubjectRow = { id: string; code: string; name_ar?: string; name_en?: string };

export function LessonSubjectChipRow({
  serviceSlug,
  subjects,
  value,
  onChange,
  label,
  groupAriaLabel,
}: {
  serviceSlug?: string | null;
  subjects: SubjectRow[];
  value: string;
  onChange: (subjectId: string) => void;
  label: (row: SubjectRow) => string;
  groupAriaLabel: string;
}) {
  if (!isLessonServiceSlug(serviceSlug) || subjects.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={groupAriaLabel}>
      {subjects.map((row) => {
        const selected = value === row.id;
        const name = label(row);
        return (
          <button
            key={row.id}
            type="button"
            className={`focus-ring flex min-h-11 min-w-[7rem] flex-col items-center gap-1 rounded-2xl border px-2 py-2 text-center text-[11px] font-bold ${
              selected ? "border-brand bg-brand/[0.08] text-brand" : "border-border bg-surface"
            }`}
            aria-pressed={selected}
            onClick={() => onChange(row.id)}
          >
            <LessonIllustration subjectCode={row.code} label={name} className="h-10 w-10" />
            <span className="line-clamp-2 leading-tight">{name}</span>
          </button>
        );
      })}
    </div>
  );
}
