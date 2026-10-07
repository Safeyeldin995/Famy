export type PendingHomeData = {
  photo: boolean;
  about: boolean;
  personal: boolean;
  reference: boolean;
  babysitting: boolean;
  needsBabysitting: boolean;
  subjects: boolean;
  needsSubjects: boolean;
};

const tasks = [
  { key: "photo", section: "personal" },
  { key: "about", section: "experience" },
  { key: "babysitting", section: "experience" },
  { key: "subjects", section: "services" },
  { key: "reference", section: "references" },
  { key: "personal", section: "personal" },
] as const;

export function pendingHomeModel(data: PendingHomeData) {
  const applicable = tasks.filter(
    ({ key }) =>
      (key !== "babysitting" || data.needsBabysitting) &&
      (key !== "subjects" || data.needsSubjects),
  );
  const firstMissing = applicable.find(({ key }) => !data[key])?.key;
  const items = applicable.map((item) => ({
    ...item,
    done: data[item.key],
    next: item.key === firstMissing,
  }));
  const remaining = items.filter((item) => !item.done).length;
  const done = items.length - remaining + 1;
  const total = items.length + 2;
  const variant =
    remaining === 0 ? "none" : remaining === 1 ? "one" : remaining === 2 ? "two" : "many";
  return {
    items,
    remaining,
    done,
    total,
    strokeDashoffset: 150.8 * (1 - done / total),
    titleKey: `providerApply.pending.titles.${variant}`,
    subtitleKey: `providerApply.pending.${remaining ? "stepsHint" : "reviewingHint"}`,
  };
}
