import { test, expect, db, openAs, seed, walletBalance, expectNoErrors } from "./fixtures";
import type { CapturedErrors } from "../../tests/helpers";
import {
  LOCAL_CI_CHILD,
  LOCAL_CI_PROMO,
  LOCAL_CI_SECOND_CHILD,
  LOCAL_CI_TUTORING,
  LOCAL_CI_USERS,
} from "../fixtures.mjs";

/**
 * One lesson, end to end: the parent books for a child through the learner
 * picker with a promo code, the tutor accepts, the parent pays from the wallet,
 * then cancels inside the free window and the money comes back to the wallet.
 */
test.describe.serial("online lesson: book for a child, accept, pay from wallet, cancel", () => {
  let bookingId = "";
  let walletBefore = 0;
  let cancelErrors: CapturedErrors = { console: [], network: [] };

  test("parent books an online lesson for a child with a promo code", async ({ browser }) => {
    const { context, page, errors } = await openAs(browser, "customer");
    walletBefore = await walletBalance(seed.users.customer);

    await page.goto("/online/tutors");
    await page.getByRole("link", { name: new RegExp(LOCAL_CI_USERS.tutor.fullName) }).first().click();
    await page.getByRole("link", { name: "اطلب درس" }).first().click();
    await expect(page).toHaveURL(/\/online\/tutors\/[0-9a-f-]{36}\/request/);

    // Learner picker: the child, not the account owner.
    const forWhom = page.getByRole("group", { name: "الحجز لمين؟" });
    await expect(forWhom.getByRole("button", { name: "أنا" })).toBeVisible();
    await forWhom.getByRole("button", { name: LOCAL_CI_CHILD.firstName }).click();
    await expect(forWhom.getByRole("button", { name: LOCAL_CI_CHILD.firstName })).toHaveAttribute("aria-pressed", "true");

    // The child's saved system and grade are prefilled; the parent picks the subject.
    await page.getByRole("button", { name: "المادة" }).click();
    await page.getByRole("option", { name: "الرياضيات" }).click();
    await page.getByRole("button", { name: new RegExp(`${LOCAL_CI_TUTORING.durationMin} دقيقة`) }).click();

    // A day a week out, then the first free time.
    const days = page.getByText("اختار اليوم").locator("xpath=..").getByRole("button");
    await days.nth(7).click();
    const times = page.getByText("اختار المعاد").locator("xpath=..").getByRole("button");
    await times.first().click();

    // Promo code (online only), applied in the checkout sheet.
    await page.getByRole("button", { name: "عندك كود خصم؟" }).click();
    await page.getByRole("textbox", { name: "كود الخصم" }).fill(LOCAL_CI_PROMO.code);
    await page.getByRole("button", { name: "تطبيق" }).click();
    await expect(page.getByText(/تم تطبيق الكود/)).toBeVisible();

    await page.getByRole("button", { name: "اطلب درس" }).click();
    await expect(page).toHaveURL(/\/online\/lessons\/[0-9a-f-]{36}/);
    bookingId = page.url().match(/lessons\/([0-9a-f-]{36})/)![1];

    const { data: booking } = await db
      .from("bookings")
      .select("status, service_mode, family_member_id, promo_code_id, price_discount, price_subtotal, teaching_subject_code")
      .eq("id", bookingId)
      .single();
    expect(booking).toMatchObject({
      status: "pending",
      service_mode: "online",
      family_member_id: seed.childId,
      teaching_subject_code: LOCAL_CI_TUTORING.subjectCode,
    });
    expect(booking?.promo_code_id).toBeTruthy();
    expect(Number(booking?.price_discount)).toBeCloseTo(
      (Number(booking?.price_subtotal) * LOCAL_CI_PROMO.percent) / 100,
      2,
    );
    expectNoErrors(errors);
    await context.close();
  });

  test("tutor accepts the request", async ({ browser }) => {
    const { context, page, errors } = await openAs(browser, "tutor");
    await page.goto("/online/provider/requests");
    await expect(page.getByRole("heading", { name: "طلبات الدروس الواردة" })).toBeVisible();
    const request = page.getByRole("listitem").filter({ hasText: LOCAL_CI_USERS.customer.fullName });
    await expect(request).toHaveCount(1);
    await request.getByRole("button", { name: "اقبل" }).click();
    await expect(request).toHaveCount(0);

    const { data: booking } = await db.from("bookings").select("status").eq("id", bookingId).single();
    expect(booking?.status).toBe("confirmed");
    expectNoErrors(errors);
    await context.close();
  });

  test("parent pays the whole lesson from the wallet (no card gateway)", async ({ browser }) => {
    const { context, page, errors, stubbedHosts } = await openAs(browser, "customer");
    await page.goto(`/online/lessons/${bookingId}`);
    await expect(page.getByRole("heading", { name: "ادفع تمن الحصة" })).toBeVisible();
    await expect(page.getByText("رصيدك يكفي الحصة دي")).toBeVisible();
    await page.getByRole("button", { name: "تأكيد" }).click();
    await expect(page.getByRole("heading", { name: "ادفع تمن الحصة" })).toHaveCount(0);

    const { data: booking } = await db.from("bookings").select("price_total").eq("id", bookingId).single();
    const { data: payment } = await db
      .from("payments")
      .select("status, amount")
      .eq("booking_id", bookingId)
      .single();
    expect(payment?.status).toBe("captured");
    expect(Number(payment?.amount)).toBe(Number(booking?.price_total));
    expect(await walletBalance(seed.users.customer)).toBeCloseTo(walletBefore - Number(booking?.price_total), 2);
    expect([...stubbedHosts].filter((h) => /paymob/i.test(h)), "Paymob is never called").toEqual([]);
    expectNoErrors(errors);
    await context.close();
  });

  test("parent cancels inside the free window: refunded to the wallet, both sides notified", async ({ browser }) => {
    const { context, page, errors } = await openAs(browser, "customer");
    await page.goto(`/online/lessons/${bookingId}`);
    await page.getByRole("button", { name: "إلغاء الحصة" }).click();
    const dialog = page.getByText("تلغي الحصة؟").locator("xpath=..");
    await expect(dialog.getByText("لو لغيت دلوقتي مفيش رسوم إلغاء")).toBeVisible();
    await dialog.getByRole("combobox").selectOption({ label: "تعارض في المواعيد" });
    await dialog.getByRole("button", { name: "تأكيد" }).click();

    await expect.poll(async () => {
      const { data } = await db.from("bookings").select("status").eq("id", bookingId).single();
      return data?.status;
    }).toBe("cancelled");
    expect(await walletBalance(seed.users.customer)).toBeCloseTo(walletBefore, 2);

    const { data: notes } = await db
      .from("notifications")
      .select("user_id, type")
      .eq("booking_id", bookingId);
    const typesFor = (userId: string) => (notes ?? []).filter((n) => n.user_id === userId).map((n) => n.type);
    expect(typesFor(seed.users.tutor).some((t) => /cancel/.test(t)), "tutor told about the cancellation").toBe(true);
    expect(typesFor(seed.users.customer).some((t) => /cancel/.test(t)), "parent gets a cancellation notice").toBe(true);
    expect(typesFor(seed.users.customer).some((t) => /wallet|refund/.test(t)), "parent told about the refund").toBe(true);
    await expect(page.getByRole("button", { name: "إلغاء الحصة" })).toHaveCount(0);
    cancelErrors = errors.readErrors();
    await context.close();
  });

  // Regression for #567: no booking_id=undefined request after cancelling.
  test("cancelling leaves no failed requests on the lesson page", () => {
    expect(cancelErrors.network).toEqual([]);
    expect(cancelErrors.console).toEqual([]);
  });
});

test.describe("learner picker for a parent who never gave their own birth date", () => {
  // Regression for #566: the learner picker sits outside the parent birth-date gate.
  test("«الحجز لمين؟» comes first; the parent's own birth date is not asked to book for a child", async ({ browser }) => {
    const { context, page } = await openAs(browser, "parentNoDob");
    await page.goto(`/online/tutors/${seed.providerId}/request`);
    const forWhom = page.getByRole("group", { name: "الحجز لمين؟" });
    await expect(forWhom.getByRole("button", { name: LOCAL_CI_SECOND_CHILD.firstName })).toBeVisible();
    await forWhom.getByRole("button", { name: LOCAL_CI_SECOND_CHILD.firstName }).click();
    await expect(page.getByRole("textbox", { name: "تاريخ الميلاد" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "المادة" })).toBeVisible();
    await context.close();
  });
});
