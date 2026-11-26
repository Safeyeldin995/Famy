import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("admin reports nested routes", () => {
  const routesDir = resolve(process.cwd(), "src/routes");
  const treePath = resolve(process.cwd(), "src/routeTree.gen.ts");

  it("uses an Outlet layout with index and online child routes", () => {
    const layoutSrc = readFileSync(resolve(routesDir, "admin.reports.tsx"), "utf8");
    expect(layoutSrc).toContain("<Outlet");
    expect(readFileSync(resolve(routesDir, "admin.reports.index.tsx"), "utf8")).toContain(
      'createFileRoute("/admin/reports/"',
    );
    expect(readFileSync(resolve(routesDir, "admin.reports.online.tsx"), "utf8")).toContain(
      'createFileRoute("/admin/reports/online"',
    );
  });

  it("nests the online report under /admin/reports in the generated tree", () => {
    const tree = readFileSync(treePath, "utf8");
    expect(tree).toContain("/admin/reports/online");
    expect(tree).toMatch(/AdminReportsRouteWithChildren/);
    expect(tree).toContain("AdminReportsIndexRoute");
  });
});
