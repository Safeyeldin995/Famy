import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkFirebaseRecaptchaContainer } from "../check-firebase-recaptcha-container.mjs";

const fixtures = [];

function makeRoutesDir() {
  const dir = mkdtempSync(join(tmpdir(), "famy-recaptcha-guard-"));
  fixtures.push(dir);
  return dir;
}

afterEach(() => {
  while (fixtures.length) {
    rmSync(fixtures.pop(), { recursive: true, force: true });
  }
});

describe("checkFirebaseRecaptchaContainer", () => {
  it("passes when the only container is in __root.tsx", () => {
    const dir = makeRoutesDir();
    writeFileSync(
      join(dir, "__root.tsx"),
      '<div id="firebase-recaptcha" className="hidden" aria-hidden="true" />\n',
    );
    writeFileSync(join(dir, "login.tsx"), "<div>login</div>\n");
    const result = checkFirebaseRecaptchaContainer(dir);
    expect(result.ok).toBe(true);
    expect(result.total).toBe(1);
  });

  it("fails when login/otp/forgot also host a container", () => {
    const dir = makeRoutesDir();
    writeFileSync(join(dir, "__root.tsx"), '<div id="firebase-recaptcha" />\n');
    writeFileSync(join(dir, "login.tsx"), '<div id="firebase-recaptcha" />\n');
    const result = checkFirebaseRecaptchaContainer(dir);
    expect(result.ok).toBe(false);
    expect(result.total).toBe(2);
    expect(result.message).toMatch(/__root\.tsx/);
  });

  it("fails when the only container is not in __root.tsx", () => {
    const dir = makeRoutesDir();
    mkdirSync(join(dir, "auth"), { recursive: true });
    writeFileSync(join(dir, "otp.tsx"), '<div id="firebase-recaptcha" />\n');
    const result = checkFirebaseRecaptchaContainer(dir);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/otp\.tsx/);
  });

  it("fails when no container exists", () => {
    const dir = makeRoutesDir();
    writeFileSync(join(dir, "__root.tsx"), "<Outlet />\n");
    const result = checkFirebaseRecaptchaContainer(dir);
    expect(result.ok).toBe(false);
    expect(result.total).toBe(0);
  });
});
