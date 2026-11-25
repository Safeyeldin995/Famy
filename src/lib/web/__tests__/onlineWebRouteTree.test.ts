import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("online web nested routes", () => {
  const routesDir = resolve(process.cwd(), "src/routes");
  const treePath = resolve(process.cwd(), "src/routeTree.gen.ts");

  const layoutCases = [
    {
      layout: "online.tutors.$providerId.tsx",
      index: "online.tutors.$providerId.index.tsx",
      layoutId: "/online/tutors/$providerId",
    },
    {
      layout: "online.lessons.tsx",
      index: "online.lessons.index.tsx",
      layoutId: "/online/lessons",
    },
    {
      layout: "online.lessons.$bookingId.tsx",
      index: "online.lessons.$bookingId.index.tsx",
      layoutId: "/online/lessons/$bookingId",
    },
  ] as const;

  it("uses Outlet layouts with index routes for nested online URLs", () => {
    for (const row of layoutCases) {
      const layoutSrc = readFileSync(resolve(routesDir, row.layout), "utf8");
      expect(layoutSrc, row.layout).toContain("<Outlet");
      expect(readFileSync(resolve(routesDir, row.index), "utf8")).toContain("createFileRoute");
    }
  });

  it("nests request, lesson detail, and room under the generated route tree", () => {
    const tree = readFileSync(treePath, "utf8");
    expect(tree).toContain("/online/tutors/$providerId/request");
    expect(tree).toContain("/online/lessons/$bookingId/room");
    expect(tree).toContain("/online/lessons/$bookingId/");
    expect(tree).toMatch(/OnlineLessonsBookingIdRouteWithChildren/);
  });
});