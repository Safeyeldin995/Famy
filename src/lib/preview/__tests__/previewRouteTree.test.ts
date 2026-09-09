import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("preview route tree", () => {
  const routesDir = resolve(process.cwd(), "src/routes");
  const treePath = resolve(process.cwd(), "src/routeTree.gen.ts");
  const previewFiles = readdirSync(routesDir)
    .filter((name) => name.startsWith("preview") && name.endsWith(".tsx"))
    .sort();

  it("keeps every preview.* route file nested under /preview parent gate", () => {
    expect(previewFiles).toHaveLength(57);

    const tree = readFileSync(treePath, "utf8");
    const previewImports = tree.match(/from '\.\/routes\/preview[^']*'/g) ?? [];
    expect(previewImports).toHaveLength(57);

    const childFiles = previewFiles.filter((name) => name !== "preview.tsx");
    for (const file of childFiles) {
      const importPath = `./routes/${file.replace(/\.tsx$/, "")}`;
      const escapedPath = importPath.replace(/\$/g, "\\$");
      const importMatch = tree.match(
        new RegExp(`import \\{ Route as (\\w+) \\} from '${escapedPath}'`),
      );
      expect(importMatch, `${file} must be imported into the route tree`).toBeTruthy();
      const importName = importMatch![1];
      const constName = importName.replace(/Import$/, "");
      const updateMatch = tree.match(
        new RegExp(
          `const ${constName} =\\s*${importName}\\.update\\(\\{[\\s\\S]*?getParentRoute: \\(\\) => (\\w+)`,
        ),
      );
      expect(updateMatch, `${file} must declare getParentRoute`).toBeTruthy();
      const parent = updateMatch![1];
      expect(parent.startsWith("Preview"), `${file} parent is ${parent}, expected Preview*`).toBe(
        true,
      );
    }

    const previewGate = readFileSync(resolve(process.cwd(), "src/routes/preview.tsx"), "utf8");
    expect(previewGate).toContain("beforeLoad");
    expect(previewGate).toContain("getPreviewRoutesEnabledFn");
    expect(previewGate).toContain("notFound()");
  });

  it("blocks preview login and forgot at the action boundary", () => {
    const login = readFileSync(resolve(process.cwd(), "src/routes/login.tsx"), "utf8");
    const forgot = readFileSync(resolve(process.cwd(), "src/routes/auth.forgot.tsx"), "utf8");
    const previewLogin = readFileSync(
      resolve(process.cwd(), "src/routes/preview.login.tsx"),
      "utf8",
    );
    const previewForgot = readFileSync(
      resolve(process.cwd(), "src/routes/preview.forgot.tsx"),
      "utf8",
    );
    expect(login).toContain("if (previewMode || loading) return");
    expect(forgot).toContain("if (previewMode || !valid || loading) return");
    expect(previewLogin).toContain("<Login previewMode />");
    expect(previewForgot).toContain("<Forgot previewMode />");
  });
});
