export type TeachingGroupRow = {
  id: string;
  provider_id: string;
  service_id: string;
  subject_id: string;
  curriculum_id: string;
  level_id: string;
  session_duration_min: number;
  session_price: number;
  status: string;
};
export function groupTeachingRows<T extends TeachingGroupRow>(rows: T[]) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = JSON.stringify([
      row.provider_id,
      row.service_id,
      row.subject_id,
      row.curriculum_id,
      row.session_duration_min,
      row.session_price,
    ]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups].map(([key, rows]) => ({ key, rows, first: rows[0] }));
}
export function teachingLevelDiff<T extends TeachingGroupRow>(
  saved: T[],
  selectedLevelIds: string[],
) {
  const lockedApproved = saved.filter((row) => row.status === "approved");
  const locked = new Set(lockedApproved.map((row) => row.level_id));
  return {
    upsert: [...new Set(selectedLevelIds)].filter((id) => !locked.has(id)),
    removable: saved.filter(
      (row) => row.status !== "approved" && !selectedLevelIds.includes(row.level_id),
    ),
    lockedApproved,
  };
}
