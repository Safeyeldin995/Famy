import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isWebSurfacePathAllowed } from "@/lib/web/webSurface";
import { onlineWebNotificationHref } from "@/lib/web/onlineWebNotificationLink";
import { ONLINE_WEB_ROUTE_IDS } from "@/lib/web/onlineWebSurface";

const off = { previewRoutesEnabled: false };
const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("«ضيف ابن» on the website", () => {
  it("cannot rely on the app pages: the web surface sends them to the home page", () => {
    // Root cause of the bug: the chip navigated to /family-members/new, which the
    // root beforeLoad redirects to "/" because it is not on the public web surface.
    expect(isWebSurfacePathAllowed("/family-members/new", {}, off)).toBe(false);
    expect(isWebSurfacePathAllowed("/account/students", {}, off)).toBe(false);
    expect(isWebSurfacePathAllowed(ONLINE_WEB_ROUTE_IDS.students, {}, off)).toBe(true);
  });

  it("opens the add-child form in place from the learner picker and «أبنائي»", () => {
    for (const file of [
      "src/components/online/OnlineStudentMatch.tsx",
      "src/components/student/StudentsManager.tsx",
    ]) {
      const code = src(file);
      expect(code, file).not.toMatch(/["']\/family-members/);
      expect(code, file).toContain("<AddChildSheet");
    }
    // The picker selects the new child once it is saved.
    expect(src("src/components/online/OnlineStudentMatch.tsx")).toMatch(
      /onCreated=\{\(child\) => \{[\s\S]*?setLearner\(child\.id\)/,
    );
  });

  it("waits for the children list to refetch before the new child is selected", () => {
    expect(src("src/lib/db/family-members-queries.ts")).toMatch(
      /return qc\.invalidateQueries\(\{ queryKey: \['family-members'\] \}\)/,
    );
  });

  it("sends «أبنائي» notifications to /online/students on the website", () => {
    expect(onlineWebNotificationHref("/account/students?confirm=self")).toBe(
      "/online/students?confirm=self",
    );
    expect(onlineWebNotificationHref("/account/students")).toBe("/online/students");
    expect(onlineWebNotificationHref("/account/students-other")).toBe("/account/students-other");
  });
});

describe("«ضيف ابن» in the app", () => {
  it("returns to the picker with the new child selected", () => {
    const screen = src("mobile/src/app/(customer)/family-members/new.tsx");
    expect(screen).toContain("rememberLearnerChoice(row.id)");
    expect(screen).toContain("router.back()");
    for (const file of [
      "mobile/src/ui/customer/StudentMatchControls.tsx",
      "mobile/src/app/(customer)/students.tsx",
    ]) {
      expect(src(file), file).toContain('params: { return: "back" }');
    }
  });
});
