import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("preview route tree", () => {
  it("keeps every preview.* route file nested under /preview parent gate", () => {
    const routesDir = resolve(process.cwd(), "src/routes");
    const previewFiles = readdirSync(routesDir).filter(
      (name) => name.startsWith("preview") && name.endsWith(".tsx"),
    );
    expect(previewFiles).toHaveLength(57);

    const tree = readFileSync(resolve(process.cwd(), "src/routeTree.gen.ts"), "utf8");
    const previewImports = tree.match(/from '\.\/routes\/preview[^']*'/g) ?? [];
    expect(previewImports).toHaveLength(57);
    expect(tree).toContain("getParentRoute: () => PreviewRoute");

    const previewGate = readFileSync(resolve(process.cwd(), "src/routes/preview.tsx"), "utf8");
    expect(previewGate).toContain("beforeLoad");
    expect(previewGate).toContain("getPreviewRoutesEnabledFn");
    expect(previewGate).toContain("notFound()");
  });
});
