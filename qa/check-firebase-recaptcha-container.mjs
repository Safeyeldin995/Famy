/**
 * Fails unless src/routes has exactly one firebase reCAPTCHA container,
 * and that container lives in __root.tsx.
 *
 * Merge resolutions that restore login/otp/forgot containers must fail CI.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RECAPTCHA_CONTAINER_RE = /\bid=["']firebase-recaptcha["']/g;

const DEFAULT_ROUTES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../src/routes");
const REQUIRED_RELATIVE_PATH = "__root.tsx";

/**
 * @param {string} dir
 * @returns {string[]}
 */
export function listTsxFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsxFiles(full));
    } else if (entry.name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out.sort();
}

/**
 * @param {string} routesDir
 */
export function findFirebaseRecaptchaContainers(routesDir = DEFAULT_ROUTES_DIR) {
  /** @type {{ relativePath: string; count: number }[]} */
  const hits = [];
  for (const file of listTsxFiles(routesDir)) {
    const text = readFileSync(file, "utf8");
    const matches = text.match(RECAPTCHA_CONTAINER_RE);
    if (!matches) continue;
    hits.push({
      relativePath: relative(routesDir, file).replaceAll("\\", "/"),
      count: matches.length,
    });
  }
  return hits;
}

/**
 * @param {string} routesDir
 */
export function checkFirebaseRecaptchaContainer(routesDir = DEFAULT_ROUTES_DIR) {
  const hits = findFirebaseRecaptchaContainers(routesDir);
  const total = hits.reduce((sum, hit) => sum + hit.count, 0);
  const locations = hits.map((hit) => `${hit.relativePath} (${hit.count})`).join(", ");

  if (total !== 1 || hits.length !== 1 || hits[0].relativePath !== REQUIRED_RELATIVE_PATH) {
    return {
      ok: false,
      total,
      hits,
      message:
        `Expected exactly one id="firebase-recaptcha" in src/routes, in __root.tsx. ` +
        `Found ${total} in: ${locations || "(none)"}.`,
    };
  }

  return {
    ok: true,
    total: 1,
    hits,
    message: 'src/routes: exactly one id="firebase-recaptcha", in __root.tsx',
  };
}

const invokedDirectly =
  !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const cliDir = process.argv[2] ?? process.env.FAMY_ROUTES_DIR ?? DEFAULT_ROUTES_DIR;
  const result = checkFirebaseRecaptchaContainer(cliDir);

  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }

  console.log(result.message);
}
