/** Keep date-only values local and serialize exactly as the existing date inputs did. */
export function scheduleDate(parts: { year: string; month: string; day: string }): string | null {
  if (!parts.year || !parts.month || !parts.day) return null;
  const year = Number(parts.year),
    month = Number(parts.month),
    day = Number(parts.day);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return `${parts.year}-${parts.month.padStart(2, "0")}-${parts.day.padStart(2, "0")}`;
}
