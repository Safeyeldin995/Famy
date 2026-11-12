export const PREPARATION_NOTES_MAX_LENGTH = 1000;

/** Trim and drop empty strings before persisting or displaying. */
export function normalizePreparationNotes(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function preparationNotesForDisplay(value: string | null | undefined): string | null {
  return normalizePreparationNotes(value);
}
