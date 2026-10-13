import { expect, it } from "vitest";
import { notificationText } from "../notificationText";
const notice = {
  title: "عنوان قديم",
  body: "نص قديم",
  title_ar: "اتوافق على المادة",
  body_ar: "المادة جاهزة",
  title_en: "Approved",
  body_en: "Ready",
};
it("renders localized Arabic and English", () => {
  expect(notificationText(notice, "ar-EG")).toEqual({
    title: notice.title_ar,
    body: notice.body_ar,
  });
  expect(notificationText(notice, "en")).toEqual({ title: "Approved", body: "Ready" });
});
it("falls directly back to title/body for missing or whitespace-only localizations", () => {
  expect(notificationText({ ...notice, title_ar: "  ", body_ar: null }, "ar")).toEqual({
    title: notice.title,
    body: notice.body,
  });
});
