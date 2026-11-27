#!/usr/bin/env node
/**
 * Seeds the local CI Supabase stack with deterministic journey data:
 *   - an admin (admin role only) with a verified TOTP factor,
 *   - a parent customer with a child learning profile, wallet credit and a phone,
 *   - an approved tutor teaching online and in person (zone + availability),
 *   - an online promo code, one upcoming paid lesson and one held lesson in
 *     admin review.
 *
 * Users are created through the local Auth admin API; everything else runs in
 * seed.sql. Writes qa/.auth/local-ci/seed.json (ids + the admin TOTP secret of
 * this throwaway stack) for the Playwright run. Prints no keys or secrets.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { loadLocalCiEnv } from "./env.mjs";
import {
  LOCAL_CI_CHILD,
  LOCAL_CI_PASSWORD,
  LOCAL_CI_PROMO,
  LOCAL_CI_SECOND_CHILD,
  LOCAL_CI_STATE_DIR,
  LOCAL_CI_TUTORING,
  LOCAL_CI_USERS,
  LOCAL_CI_WALLET_CREDIT,
} from "./fixtures.mjs";
import { totpCode, totpWindowRemainingMs } from "./totp.mjs";

loadLocalCiEnv();
const url = process.env.LOCAL_SUPABASE_URL;
const admin = createClient(url, process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function ensureUser(key) {
  const spec = LOCAL_CI_USERS[key];
  const { data, error } = await admin.auth.admin.createUser({
    email: spec.email,
    password: LOCAL_CI_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: spec.fullName, signup_role: spec.signupRole },
  });
  if (error) throw new Error(`[seed] could not create the ${key} user: ${error.message}`);
  return data.user.id;
}

async function enrollAdminTotp() {
  const client = createClient(url, process.env.LOCAL_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({
    email: LOCAL_CI_USERS.admin.email,
    password: LOCAL_CI_PASSWORD,
  });
  if (signInError) throw new Error(`[seed] admin sign-in failed: ${signInError.message}`);
  const { data: enrolled, error: enrollError } = await client.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Local CI admin",
  });
  if (enrollError) throw new Error(`[seed] admin TOTP enroll failed: ${enrollError.message}`);
  // Avoid a code that expires between computing and verifying it.
  if (totpWindowRemainingMs() < 3_000) await new Promise((r) => setTimeout(r, totpWindowRemainingMs() + 200));
  const { error: verifyError } = await client.auth.mfa.challengeAndVerify({
    factorId: enrolled.id,
    code: totpCode(enrolled.totp.secret),
  });
  if (verifyError) throw new Error(`[seed] admin TOTP verify failed: ${verifyError.message}`);
  const usedWindow = Math.floor(Date.now() / 30_000);
  await client.auth.signOut();
  return { secret: enrolled.totp.secret, usedWindow };
}

function runSeedSql(vars) {
  const args = ["--no-psqlrc", "-X", "-q", process.env.LOCAL_DB_URL, "-f", path.resolve("qa/local-ci/seed.sql")];
  for (const [key, value] of Object.entries(vars)) args.push("-v", `${key}=${value}`);
  const out = execFileSync("psql", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  const lastLine = out.trim().split("\n").filter(Boolean).pop() ?? "";
  return JSON.parse(lastLine);
}

const ids = {
  admin: await ensureUser("admin"),
  customer: await ensureUser("customer"),
  tutor: await ensureUser("tutor"),
  parentNoDob: await ensureUser("parentNoDob"),
};

const report = runSeedSql({
  admin_id: ids.admin,
  customer_id: ids.customer,
  tutor_id: ids.tutor,
  customer_phone: LOCAL_CI_USERS.customer.phone,
  customer_dob: LOCAL_CI_USERS.customer.dateOfBirth,
  parent2_id: ids.parentNoDob,
  parent2_phone: LOCAL_CI_USERS.parentNoDob.phone,
  child2_name: LOCAL_CI_SECOND_CHILD.fullName,
  child2_dob: LOCAL_CI_SECOND_CHILD.dateOfBirth,
  tutor_phone: LOCAL_CI_USERS.tutor.phone,
  child_name: LOCAL_CI_CHILD.fullName,
  child_dob: LOCAL_CI_CHILD.dateOfBirth,
  child_curriculum: LOCAL_CI_CHILD.curriculumCode,
  child_level: LOCAL_CI_CHILD.levelCode,
  service_slug: LOCAL_CI_TUTORING.serviceSlug,
  subject_code: LOCAL_CI_TUTORING.subjectCode,
  duration_min: LOCAL_CI_TUTORING.durationMin,
  in_person_price: LOCAL_CI_TUTORING.inPersonPrice,
  online_price: LOCAL_CI_TUTORING.onlinePrice,
  promo_code: LOCAL_CI_PROMO.code,
  promo_percent: LOCAL_CI_PROMO.percent,
  wallet_credit: LOCAL_CI_WALLET_CREDIT,
});

const adminTotp = await enrollAdminTotp();

const stateDir = path.resolve(LOCAL_CI_STATE_DIR);
fs.mkdirSync(stateDir, { recursive: true });
fs.writeFileSync(
  path.join(stateDir, "seed.json"),
  JSON.stringify(
    { users: ids, adminTotpSecret: adminTotp.secret, adminTotpWindow: adminTotp.usedWindow, ...report },
    null,
    2,
  ),
  { mode: 0o600 },
);

console.log(
  `[seed] users=4 provider=${report.providerId} bookings=${Object.keys(report.bookings ?? {}).length} wallet=${report.walletBalance}`,
);
