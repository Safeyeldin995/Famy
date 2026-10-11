import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import { pendingHomeModel, type PendingHomeData } from "../pendingHomeModel";

const data: PendingHomeData = {
  hours: true,
  photo: true,
  about: false,
  personal: false,
  reference: true,
  babysitting: false,
  needsBabysitting: true,
  subjects: false,
  needsSubjects: true,
};

describe("pending home model", () => {
  it("keeps completed tasks in order and includes category tasks only when applicable", () => {
    expect(pendingHomeModel(data).items.map((item) => item.key)).toEqual([
      "photo",
      "about",
      "babysitting",
      "subjects",
      "reference",
      "personal",
      "hours",
    ]);
    for (const needsBabysitting of [false, true]) {
      for (const needsSubjects of [false, true]) {
        const model = pendingHomeModel({ ...data, needsBabysitting, needsSubjects });
        expect(model.items.some((item) => item.key === "babysitting")).toBe(needsBabysitting);
        expect(model.items.some((item) => item.key === "subjects")).toBe(needsSubjects);
        expect(model.items.filter((item) => item.done).map((item) => item.key)).toEqual([
          "photo",
          "reference",
          "hours",
        ]);
        expect(model.total).toBe(7 + Number(needsBabysitting) + Number(needsSubjects));
      }
    }
  });

  it("marks only the first unfinished applicable task as next", () => {
    expect(
      pendingHomeModel(data)
        .items.filter((item) => item.next)
        .map((item) => item.key),
    ).toEqual(["about"]);
    expect(
      pendingHomeModel({ ...data, about: true, needsBabysitting: false })
        .items.filter((item) => item.next)
        .map((item) => item.key),
    ).toEqual(["subjects"]);
  });

  it("counts the submitted application as done and Famy review as pending", () => {
    const model = pendingHomeModel(data);
    expect(model.done).toBe(4);
    expect(model.total).toBe(9);
    expect(model.remaining).toBe(4);
    expect(model.strokeDashoffset).toBeCloseTo(150.8 * (1 - 4 / 9));
  });

  it.each([
    [0, "خلصت كل خطواتك", "All steps done"],
    [1, "فاضلك خطوة واحدة", "1 step left"],
    [2, "فاضلك خطوتين", "2 steps left"],
    [3, "فاضلك 3 خطوات", "3 steps left"],
    [4, "فاضلك 4 خطوات", "4 steps left"],
  ])("renders the title for %i remaining tasks", (remaining, ar, en) => {
    const model = pendingHomeModel({
      ...data,
      needsBabysitting: false,
      needsSubjects: false,
      photo: remaining < 1,
      about: remaining < 2,
      reference: remaining < 3,
      personal: remaining < 4,
    });
    expect(model.remaining).toBe(remaining);
    expect(i18n.getFixedT("ar")(model.titleKey, { remaining })).toBe(ar);
    expect(i18n.getFixedT("en")(model.titleKey, { remaining })).toBe(en);
    expect(model.subtitleKey).toBe(
      `providerApply.pending.${remaining ? "stepsHint" : "reviewingHint"}`,
    );
    if (remaining === 0) {
      expect(model.items.some((item) => item.next)).toBe(false);
      expect(model.done).toBe(6);
      expect(model.total).toBe(7);
      expect(model.strokeDashoffset).toBeGreaterThan(0);
    }
  });
});
