import { test, expect, db, openAs, seed, expectNoErrors } from "./fixtures";
import { LOCAL_CI_CHILD } from "../fixtures.mjs";

/**
 * Lesson report: after the lesson the tutor writes what was covered and the homework;
 * the parent is notified, reads it on the lesson page and on the child's «تقدم» page.
 */
test.describe.serial("lesson report: tutor writes it, parent reads it", () => {
  const bookingId = () => seed.bookings.completed_lesson.bookingId;
  const covered = "الكسور: جمع وطرح الكسور العادية";
  const homework = "صفحة 14 من سؤال 1 لـ 5";

  test("tutor writes the report on the finished lesson", async ({ browser }) => {
    const { context, page, errors } = await openAs(browser, "tutor");
    await page.goto(`/online/lessons/${bookingId()}`);
    const section = page.getByTestId("lesson-report-section");
    await expect(section.getByRole("heading", { name: "اكتب تقرير الحصة" })).toBeVisible();

    // Submitting empty shows the field errors and sends nothing.
    await section.getByTestId("lesson-report-submit").click();
    await expect(section.getByText("اختار مستواه في الحصة")).toBeVisible();

    await section.getByTestId("lesson-report-covered").fill(covered);
    await section.getByTestId("lesson-report-homework").fill(homework);
    await section.getByRole("radio", { name: "ممتاز" }).click();
    await section.getByTestId("lesson-report-submit").click();
    await expect(page.getByText("التقرير وصل للأهل")).toBeVisible();
    await expect(section.getByText(covered)).toBeVisible();

    const { data: report } = await db
      .from("lesson_reports")
      .select("report_kind, covered, homework, understanding")
      .eq("booking_id", bookingId())
      .single();
    expect(report).toMatchObject({
      report_kind: "tutoring",
      covered,
      homework,
      understanding: "excellent",
    });

    const { data: notes } = await db
      .from("notifications")
      .select("user_id, title_ar, deep_link")
      .eq("booking_id", bookingId())
      .eq("type", "lesson_report_ready");
    expect(notes).toHaveLength(1);
    expect(notes?.[0]).toMatchObject({
      user_id: seed.users.customer,
      title_ar: `تقرير حصة ${LOCAL_CI_CHILD.firstName} وصل`,
      deep_link: `/online/lessons/${bookingId()}`,
    });
    expectNoErrors(errors);
    await context.close();
  });

  test("parent reads the report and opens the child's progress page", async ({ browser }) => {
    const { context, page, errors } = await openAs(browser, "customer");
    await page.goto(`/online/lessons/${bookingId()}`);
    const section = page.getByTestId("lesson-report-section");
    await expect(section.getByRole("heading", { name: "تقرير الحصة" })).toBeVisible();
    await expect(section.getByText(covered)).toBeVisible();
    await expect(section.getByText(homework)).toBeVisible();
    await expect(section.getByText("ممتاز")).toBeVisible();
    await expect(section.getByTestId("lesson-report-form")).toHaveCount(0);

    await section.getByRole("link", { name: `تقدم ${LOCAL_CI_CHILD.firstName}` }).click();
    await expect(page).toHaveURL(new RegExp(`/online/students/${seed.childId}$`));
    const progress = page.getByTestId("learner-progress");
    await expect(
      progress.getByRole("heading", { name: `تقدم ${LOCAL_CI_CHILD.firstName}` }),
    ).toBeVisible();
    await expect(progress.getByText(covered)).toBeVisible();
    expectNoErrors(errors);
    await context.close();
  });

  test("a client without a signed-in participant cannot read it", async () => {
    // The service-role client has no user and no grant on the RPC.
    const { data, error } = await db.rpc("get_lesson_report", { p_booking_id: bookingId() });
    expect(data).toBeNull();
    expect(error).toBeTruthy();
  });
});
