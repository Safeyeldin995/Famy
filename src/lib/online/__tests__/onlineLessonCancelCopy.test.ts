import { describe, expect, it } from "vitest";
import { cancelDialogCopy, cancelSuccessCopy } from "../onlineLessonCancelCopy";

const t = (key: string, params?: Record<string, unknown>) =>
  params ? `${key}(${Object.values(params).join(",")})` : key;
const fmt = (n: number) => `${n} EGP`;

describe("online lesson cancel copy", () => {
  it("treats a request the tutor hasn't accepted as free", () => {
    expect(cancelDialogCopy({ pending: true, fee: 100, policySummary: "P", formatAmount: fmt, t })).toEqual({
      title: "onlineWeb.cancel.requestTitle",
      body: "onlineWeb.cancel.requestFree",
    });
    expect(cancelSuccessCopy({ pending: true, fee: 100, formatAmount: fmt, t })).toBe(
      "onlineWeb.cancel.requestDone",
    );
  });

  it("shows the fee and the policy for a booked lesson", () => {
    const copy = cancelDialogCopy({ pending: false, fee: 50, policySummary: "P", formatAmount: fmt, t });
    expect(copy.title).toBe("onlineWeb.cancel.lessonTitle");
    expect(copy.body).toBe("onlineWeb.cancel.lessonFee(50 EGP) P");
    expect(cancelSuccessCopy({ pending: false, fee: 50, formatAmount: fmt, t })).toBe(
      "onlineWeb.cancel.lessonDoneFee(50 EGP)",
    );
  });

  it("says a booked lesson is free when no fee applies", () => {
    const copy = cancelDialogCopy({ pending: false, fee: 0, policySummary: "P", formatAmount: fmt, t });
    expect(copy.body).toBe("onlineWeb.cancel.lessonFree P");
    expect(cancelSuccessCopy({ pending: false, fee: null, formatAmount: fmt, t })).toBe(
      "onlineWeb.cancel.lessonDoneFree",
    );
  });
});
