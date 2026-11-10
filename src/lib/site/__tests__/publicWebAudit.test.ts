import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PUBLIC_STATIC_SITEMAP_PATHS } from "../publicPaths";
import { SITE_ORIGIN } from "../seo";

const publicDir = resolve(import.meta.dirname, "../../../../public");
const sitemap = readFileSync(resolve(publicDir, "sitemap.xml"), "utf8");
const robots = readFileSync(resolve(publicDir, "robots.txt"), "utf8");

function sitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
}

describe("public website crawl files", () => {
  it("lists only allowlisted static pages in sitemap.xml", () => {
    const paths = sitemapLocs(sitemap);
    expect(paths).toEqual([...PUBLIC_STATIC_SITEMAP_PATHS]);
    for (const path of paths) {
      expect(sitemap).toContain(`${SITE_ORIGIN}${path}`);
    }
  });

  it("does not list gated /join in sitemap.xml", () => {
    expect(sitemap).not.toContain("/join");
  });

  it("allows each sitemap path in robots.txt", () => {
    for (const path of PUBLIC_STATIC_SITEMAP_PATHS) {
      const suffix = path === "/" ? "/$" : `${path}$`;
      expect(robots).toContain(`Allow: ${suffix}`);
    }
  });

  it("disallows app and admin paths in robots.txt", () => {
    for (const rule of ["Disallow: /app", "Disallow: /admin", "Disallow: /login"]) {
      expect(robots).toContain(rule);
    }
  });
});
