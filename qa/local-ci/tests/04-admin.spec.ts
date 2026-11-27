import { test, expect, db, seed, storageStateFor, walletBalance, expectNoErrors } from "./fixtures";
import { LOCAL_CI_USERS } from "../fixtures.mjs";
import type { Page } from "@playwright/test";

const bookingCode = (id: string) => `#${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

/** Opens one booking's details on /admin/bookings and returns its money card. */
async function openBookingMoney(page: Page, bookingId: string) {
  await page.goto(`/admin/bookings?booking=${bookingId}`);
  const row = page.getByRole("listitem").filter({ hasText: bookingCode(bookingId) });
  // The list can re-render while it settles; retry the toggle until it is open.
  await expect(async () => {
    if (!(await row.getByRole("button", { name: "إخفاء التفاصيل" }).isVisible())) {
      await row.getByRole("button", { name: "التفاصيل" }).click();
    }
    await expect(row.getByRole("region", { name: "الفلوس" })).toBeVisible({ timeout: 2_000 });
  }).toPass();
  return row.getByRole("region", { name: "الفلوس" });
}

// The admin session passed the TOTP screen in global setup (aal2).
test.use({ storageState: storageStateFor("admin") });

test.describe.serial("admin", () => {
  let reviewRowText = "";

  test("«النهارده» loads with no errors", async ({ page, errors }) => {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "النهارده" })).toBeVisible();
    await expect(page.getByText("مطلوب منك").first()).toBeVisible();
    await expect(page.getByText("مشاكل").first()).toBeVisible();
    expectNoErrors(errors);
  });

  // The pages the old hosted "release gate admin" job checked (reports,
  // payments, monitoring, settings), now on the local stack with real data.
  for (const path of ["/admin/reports", "/admin/payments", "/admin/monitoring", "/admin/settings", "/admin/wallets"]) {
    test(`release gate: ${path} loads with no errors`, async ({ page, errors }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await expect(page.getByText("جار التحميل…")).toHaveCount(0);
      await expect(page.locator(".animate-pulse")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "حاول مرة تانية" })).toHaveCount(0);
      expectNoErrors(errors);
    });
  }

  test("global search finds a customer by an international phone number", async ({ page, errors }) => {
    await page.goto("/admin");
    const search = page.getByPlaceholder(/ابحث عن عميل أو مقدم خدمة أو حجز/);
    await search.fill(`+20${LOCAL_CI_USERS.customer.phone.slice(1)}`);
    const result = page.getByRole("button", { name: new RegExp(LOCAL_CI_USERS.customer.fullName) });
    await expect(result).toBeVisible();
    await result.click();
    await expect(page).toHaveURL(new RegExp(`/admin/customer/${seed.users.customer}`));
    await expect(page.getByText(LOCAL_CI_USERS.customer.fullName).first()).toBeVisible();
    expectNoErrors(errors);
  });

  test("refunds a held lesson to the wallet, once, and blocks an active one", async ({ page, errors }) => {
    const held = seed.bookings.held_review.bookingId;
    const upcoming = seed.bookings.upcoming_paid.bookingId;
    const before = await walletBalance(seed.users.customer);
    const { data: booking } = await db.from("bookings").select("price_total").eq("id", held).single();
    const price = Number(booking?.price_total);

    // An upcoming paid lesson cannot be refunded while it is still on.
    const upcomingCard = await openBookingMoney(page, upcoming);
    await expect(upcomingCard.getByRole("button", { name: "رد ثمن الحصة للمحفظة" })).toBeDisabled();
    await expect(upcomingCard.getByText("الحجز لسه شغال، الغيه الأول")).toBeVisible();

    const card = await openBookingMoney(page, held);
    await card.getByRole("button", { name: "رد ثمن الحصة للمحفظة" }).click();
    const amount = page.getByLabel("المبلغ");
    await expect(amount).toHaveValue(String(price));
    await page.getByLabel("السبب").fill("العميل اشتكى من الحصة");
    await page.getByRole("button", { name: /^رجع / }).click();
    await expect(page.getByText(/رجعنا .* لمحفظة العميل/)).toBeVisible();

    await expect.poll(() => walletBalance(seed.users.customer)).toBeCloseTo(before + price, 2);
    // Everything held is back with the customer: the action is now blocked.
    await expect(card.getByRole("button", { name: "رد ثمن الحصة للمحفظة" })).toBeDisabled();
    const { data: entries } = await db
      .from("customer_wallet_entries")
      .select("direction, amount, admin_id")
      .eq("booking_id", held)
      .eq("direction", "credit");
    expect(entries?.filter((e) => e.admin_id === seed.users.admin)).toHaveLength(1);
    expectNoErrors(errors);
  });

  test("online review queue: an attendance review is listed and closed", async ({ page, errors }) => {
    await page.goto("/admin/bookings");
    const queue = page.getByText("مراجعات تداخل الجلسات الأونلاين").locator("xpath=..");
    await expect(queue).toBeVisible();
    const row = queue.getByRole("listitem").filter({ hasText: /admin_review_overlap|تداخل/ });
    await expect(row).toHaveCount(1);
    reviewRowText = (await row.innerText()).trim();
    await row.getByRole("button", { name: "إغلاق البلاغ" }).click();
    await expect(page.getByText("تم تحديث البلاغ")).toBeVisible();

    const { data: reviews } = await db
      .from("online_session_admin_reviews")
      .select("status")
      .eq("booking_id", seed.bookings.held_review.bookingId);
    expect(reviews?.map((r) => r.status)).toEqual(["resolved"]);
    expectNoErrors(errors);
  });

  // Product bug https://github.com/Safeyeldin995/Famy/issues/568: the queue prints the stored English reason.
  test.fixme("the review queue explains the reason in Arabic (no internal codes)", () => {
    expect(reviewRowText).not.toMatch(/[a-z]+_[a-z_]+/);
    expect(reviewRowText).not.toMatch(/Online session evidence/);
  });

  test("creates a promo code limited to online lessons", async ({ page, errors }) => {
    const code = `WEB${Date.now().toString(36).toUpperCase()}`;
    await page.goto("/admin/promo-codes");
    await page.getByRole("button", { name: "كود خصم جديد" }).click();
    const form = page.getByRole("heading", { name: "كود خصم جديد" }).locator("xpath=..");
    await form.getByLabel("الرمز").fill(code);
    await form.getByLabel("نوع الحجز").selectOption({ label: "الحصص الأونلاين بس" });
    await form.getByLabel("نوع الخصم").selectOption({ label: "نسبة مئوية" });
    await form.getByLabel("الخصم (%)").fill("15");
    await page.getByRole("button", { name: "إنشاء الكود" }).click();
    await expect(page.getByText("تم إنشاء كود الخصم")).toBeVisible();

    const { data: promo } = await db
      .from("promo_codes")
      .select("applicable_mode, discount_type, discount_value, is_active")
      .eq("code", code)
      .single();
    expect(promo).toMatchObject({ applicable_mode: "online", discount_type: "percentage", is_active: true });
    expect(Number(promo?.discount_value)).toBe(15);
    expectNoErrors(errors);
  });
});
