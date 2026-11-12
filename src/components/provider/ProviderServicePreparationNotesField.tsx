import {
  normalizePreparationNotes,
  PREPARATION_NOTES_MAX_LENGTH,
} from "@/lib/provider/preparationNotes";
import { useTranslation } from "react-i18next";

type Props = {
  savedNotes: string | null | undefined;
  draft: string;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  savePending: boolean;
  errorMessage?: string;
  id?: string;
};

export function ProviderServicePreparationNotesField({
  savedNotes,
  draft,
  onDraftChange,
  onSave,
  savePending,
  errorMessage,
  id,
}: Props) {
  const { t } = useTranslation();
  const normalizedDraft = normalizePreparationNotes(draft) ?? "";
  const normalizedSaved = normalizePreparationNotes(savedNotes) ?? "";
  const dirty = normalizedDraft !== normalizedSaved;
  const overLimit = draft.length > PREPARATION_NOTES_MAX_LENGTH;

  return (
    <div className="mt-3 min-w-0 space-y-2">
      <label className="block text-xs font-bold text-foreground" htmlFor={id}>
        {t("pro.profile.preparationNotesLabel")}
      </label>
      <textarea
        id={id}
        rows={3}
        value={draft}
        maxLength={PREPARATION_NOTES_MAX_LENGTH + 50}
        onChange={(e) => onDraftChange(e.target.value)}
        placeholder={t("pro.profile.preparationNotesPlaceholder")}
        className="w-full rounded-xl border border-border bg-surface p-3 text-sm leading-relaxed"
      />
      <p className="text-pro-12 text-muted-foreground">
        {t("pro.profile.preparationNotesCounter", {
          count: Math.min(draft.length, PREPARATION_NOTES_MAX_LENGTH),
          max: PREPARATION_NOTES_MAX_LENGTH,
        })}
      </p>
      {dirty ? (
        <button
          type="button"
          onClick={onSave}
          disabled={savePending || overLimit || !dirty}
          className="min-h-11 rounded-lg bg-brand px-3 py-2 text-xs font-bold text-brand-foreground disabled:opacity-50"
        >
          {t("common.save")}
        </button>
      ) : null}
      {errorMessage ? <p className="text-pro-12 font-semibold text-coral">{errorMessage}</p> : null}
    </div>
  );
}
