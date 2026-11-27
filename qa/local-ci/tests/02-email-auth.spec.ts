import { test, expect, db, expectNoErrors } from "./fixtures";
import { LOCAL_CI_PASSWORD } from "../fixtures.mjs";

// Unique per run so a re-run against the same stack still signs up fresh.
const runId = Date.now().toString(36);
const student = {
  name: "سارة التجربة",
  email: `student-${runId}@famy-local-ci.test`,
  phone: `0100000${String(Date.now()).slice(-4)}`,
};

test.describe.serial("student email account on /online", () => {
  test("signs up with email (auto-confirmed locally) and completes the phone step", async ({ page, errors }) => {
    await page.goto("/online/signup?returnTo=/online/tutors");
    await expect(page.getByRole("heading", { name: "اعمل حساب طالب" })).toBeVisible();
    await page.getByLabel("الاسم").fill(student.name);
    await page.getByRole("textbox", { name: "الإيميل" }).fill(student.email);
    await page.getByRole("textbox", { name: "كلمة المرور", exact: true }).fill(LOCAL_CI_PASSWORD);
    await page.getByRole("button", { name: "اعمل حساب" }).click();

    // Bookings need a phone, so a new student lands on «كمل بياناتك» first.
    await expect(page).toHaveURL(/\/online\/complete-profile/);
    await expect(page.getByRole("heading", { name: "كمل بياناتك" })).toBeVisible();
    await page.getByLabel("رقم موبايلك").fill(student.phone.slice(1));
    await page.getByRole("button", { name: "احفظ وكمل" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/online/tutors");

    const { data: users } = await db.auth.admin.listUsers({ perPage: 200 });
    const user = users.users.find((u) => u.email === student.email);
    expect(user?.email_confirmed_at, "local stack auto-confirms email").toBeTruthy();
    const { data: profile } = await db.from("profiles").select("full_name, phone").eq("id", user!.id).single();
    expect(profile?.full_name).toBe(student.name);
    expect(profile?.phone).toBeTruthy();
    const { data: roles } = await db.from("user_roles").select("role").eq("user_id", user!.id);
    expect(roles?.map((r) => r.role)).toEqual(["customer"]);
    expectNoErrors(errors);
  });

  test("signs in again with email and password", async ({ page, errors }) => {
    await page.goto("/online/login?returnTo=/online/tutors");
    await expect(page.getByRole("heading", { name: "دخول الطلبة وأولياء الأمور" })).toBeVisible();
    await page.getByRole("tab", { name: "الإيميل" }).click();
    await page.getByRole("textbox", { name: "الإيميل" }).fill(student.email);
    await page.getByRole("textbox", { name: "كلمة المرور", exact: true }).fill(LOCAL_CI_PASSWORD);
    await page.getByRole("button", { name: "تسجيل الدخول" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/online/tutors");
    const session = await page.evaluate(() =>
      Object.keys(localStorage).some((k) => k.startsWith("sb-") && k.endsWith("-auth-token")),
    );
    expect(session, "a Supabase session is stored").toBe(true);
    expectNoErrors(errors);
  });
});
