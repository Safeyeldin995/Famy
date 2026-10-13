/** Grade order from the teaching_levels catalog codes: kg, g1 .. g12. */
export function levelRank(code: string): number {
  if (code === "kg") return 0;
  const match = /^g(\d{1,2})$/.exec(code);
  return match ? Number(match[1]) : 100;
}

export type LevelLike = { code: string; name: string };

/**
 * Collapse a provider's grades into short readable ranges, e.g.
 * kg, g1..g6, g9 -> [{ from: KG, to: Grade 6 }, { from: Grade 9 }].
 * Unknown codes are kept as their own single entries, in input order.
 */
export function levelRanges(levels: LevelLike[]): { from: string; to?: string }[] {
  const unique = [...new Map(levels.map((level) => [level.code, level])).values()].sort(
    (a, b) => levelRank(a.code) - levelRank(b.code),
  );
  const ranges: { first: LevelLike; last: LevelLike }[] = [];
  for (const level of unique) {
    const current = ranges[ranges.length - 1];
    const rank = levelRank(level.code);
    if (current && rank < 100 && rank === levelRank(current.last.code) + 1) current.last = level;
    else ranges.push({ first: level, last: level });
  }
  return ranges.map(({ first, last }) =>
    first.code === last.code ? { from: first.name } : { from: first.name, to: last.name },
  );
}
