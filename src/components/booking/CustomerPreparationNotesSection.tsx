import { preparationNotesForDisplay } from "@/lib/provider/preparationNotes";
import { useTranslation } from "react-i18next";

type Props = {
  notes: string | null | undefined;
  className?: string;
};

export function CustomerPreparationNotesSection({ notes, className = "" }: Props) {
  const { t } = useTranslation();
  const text = preparationNotesForDisplay(notes);
  if (!text) return null;
  return (
    <section className={`rounded-2xl border border-border/60 bg-surface-2/50 p-4 ${className}`}>
      <h3 className="text-pro-12 font-extrabold uppercase tracking-wider text-muted-foreground">
        {t("customerPreparation.sectionTitle")}
      </h3>
      <p className="mt-2 whitespace-pre-line text-pro-14 leading-relaxed text-foreground/90">{text}</p>
    </section>
  );
}
