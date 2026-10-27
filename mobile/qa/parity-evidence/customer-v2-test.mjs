// Extend the canonical CJS fixtures with additional customer account/RPC scenarios.
// Keep all original assertions; never allowlist errors or contact a remote backend.
import { createRequire, Module } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const sourcePath = path.resolve("qa/phase1-web.cjs");
let source = fs.readFileSync(sourcePath, "utf8").replace(/\r\n/g, "\n");
function insert(anchor, replacement) {
  if (source.split(anchor).length !== 2) throw new Error(`Fixture anchor changed: ${anchor}`);
  // A function replacement preserves literal "$'" in embedded regex assertions.
  source = source.replace(anchor, () => replacement);
}
insert("const booking = {", "let reschedules = [];\nlet chatFixture = false;\nconst booking = {");
insert("let browser;", "let browser;\nlet failurePage;");
insert(
  "const page = await context.newPage();",
  "const page = await context.newPage();\n  failurePage = page;",
);
insert(
  ".catch((error) => {",
  `.catch(async (error) => {
    fs.writeFileSync(path.join(artifacts, 'failure.txt'), String(error.stack || error));
    try { await failurePage?.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }); }
    catch { console.error('Failure screenshot unavailable: browser page closed or crashed. Last successful screenshots retained.'); }`,
);
insert(
  "    let data;",
  `
    if (table === "booking_reschedule_requests") return route.fulfill({ json: reschedules });
    if (table === "notification_preferences") return route.fulfill({ json: { user_id: uid, booking_push: true, chat_push: true, reminder_push: true, support_push: true, campaign_push: false, campaign_in_app: true } });
    if (table === "account_deletion_check") return route.fulfill({ json: { ok: false, reason: "active_bookings" } });
    if (table === "settings" && url.searchParams.get("key") === "eq.service_areas") return route.fulfill({ json: { value: { areas: [{ name: 'Sheikh Zayed', enabled: true }, { name: '6th of October', enabled: true }] } } });
    if (table === "availability_rules") return route.fulfill({ json: [{ id: id(82), provider_id: pid, weekday: 1, start_time: "09:00", end_time: "17:00" }] });
    if (chatFixture && table === "conversations") {
      const conversation = { id: id(80), booking_id: bid, customer_id: uid, provider_user_id: pid };
      return route.fulfill({ json: req.headers().accept?.includes('object') ? conversation : [conversation] });
    }
    if (chatFixture && (table === "messages" || table === "booking_message_reads")) return route.fulfill({ json: [] });
    if (table === "request_reschedule") {
      writes.push({ table, method, body });
      if (body.p_reason === "fail") return route.fulfill({ status: 400, json: { message: "Fixture rejection" } });
      reschedules = [{ id: id(50), requested_by: uid, status: "pending", proposed_start_at: body.p_proposed_start, proposed_end_at: body.p_proposed_end, reason: body.p_reason }];
      return route.fulfill({ json: id(50) });
    }
    if (table === "cancel_reschedule_request" || table === "respond_reschedule") {
      writes.push({ table, method, body });
      reschedules = reschedules.map(row => ({ ...row, status: table === "cancel_reschedule_request" ? "cancelled" : "rejected" }));
      return route.fulfill({ json: null });
    }
    let data;`,
);
insert(
  "  assert.deepEqual(errors, []);",
  `
  mode = "populated";
  await visit('/booking/' + bid, provider.full_name);
  const messageAction = page.getByRole('button', { name: ar.provider.message, exact: true });
  await expect(messageAction).toBeVisible();
  await messageAction.click();
  await expect(page.getByText(ar.bookingChat.unavailableBody, { exact: true })).toBeVisible();
  chatFixture = true;
  await messageAction.click();
  await expect(page).toHaveURL(new RegExp('/chat/' + id(80) + '$'));
  await expect(page.getByTestId('chat-input')).toBeVisible();
  await shot('chat');
  await page.getByTestId('chat-input').fill('someone@example.com');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-input')).toHaveValue('someone@example.com');
  await expect(page.getByText(ar.bookingChat.contactBlocked, { exact: true })).toBeVisible();
  await visit('/profile', ar.customerHome.profileEdit);
  await expect(page.getByRole('button', { name: ar.setup.photoHint, exact: true })).toBeVisible();
  await page.getByRole('link', { name: ar.customerHome.profileEdit, exact: true }).click();
  await expect(page).toHaveURL(/\\/setup$/);
  await expect(page.getByLabel(ar.setup.name, { exact: true })).toHaveValue('حساب اختبار محلي');
  await shot('setup');
  await visit('/addresses/' + aid, ar.setup.address);
  await expect(page.getByLabel(ar.setup.address, { exact: true })).not.toHaveValue('');
  await shot('address-edit');
  await visit('/addresses/new', ar.addresses.addAddress);
  await shot('address-new');
  await visit('/notification-preferences', ar.notifPrefs.categories);
  await shot('notification-preferences');
  await visit('/delete-account', ar.accountDeletion.intro);
  await shot('delete-account');
  await visit('/booking/' + bid, provider.full_name);
  await shot('booking-detail');
  await page.getByRole('button', { name: ar.reschedule.requestButton, exact: true }).click();
  await page.getByLabel(ar.reschedule.proposedTime, { exact: true }).fill('2027-01-15');
  await page.getByLabel(ar.reschedule.reasonOptional, { exact: true }).fill('local fixture');
  await page.getByRole('button', { name: ar.reschedule.sendRequest, exact: true }).click();
  await expect(page.getByText(ar.reschedule.waiting, { exact: true })).toBeVisible();
  const request = writes.find(row => row.table === 'request_reschedule');
  assert.equal(request.body.p_booking_id, bid);
  assert(new Date(request.body.p_proposed_end) > new Date(request.body.p_proposed_start));
  await page.getByRole('button', { name: ar.reschedule.withdraw, exact: true }).click();
  assert(!writes.some(row => row.table === 'cancel_reschedule_request'));
  await page.getByRole('button', { name: ar.reschedule.withdraw, exact: true }).last().click();
  await expect(page.getByRole('button', { name: ar.reschedule.requestButton, exact: true })).toBeVisible();
  assert(writes.some(row => row.table === 'cancel_reschedule_request' && row.body.p_request_id === id(50)));
  for (const key of ['receipt', 'addCalendar']) {
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: ar.bookingDetail[key], exact: true }).click();
    const download = await downloadPromise;
    assert(download.suggestedFilename().endsWith(key === 'receipt' ? '.txt' : '.ics'));
  }
  await context.route(apiOrigin + '/rest/v1/rpc/get_active_featured_promo_codes', route => route.fulfill({ json: [
    { id: id(70), code: 'PARITYONE', discount_type: 'percentage', discount_value: 10, description_ar: 'عرض اختبار' },
    { id: id(71), code: 'PARITYTWO', discount_type: 'percentage', discount_value: 20, description_ar: 'عرض اختبار تاني' }
  ] }));
  await visit('/home', ar.home.headline);
  await expect(page.getByRole('button', { name: ar.roles.babysitter, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: ar.categories.tutorSubtitle, exact: true })).toBeVisible();
  await expect(page.getByText('PARITYONE', { exact: true })).toHaveCount(1);
  await expect(page.getByText('PARITYTWO', { exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: ar.common.seeAll, exact: true })).toBeVisible();
  const homeTab = page.getByRole('tab', { name: ar.nav.home, exact: true });
  const profileTab = page.getByRole('tab', { name: ar.nav.profile, exact: true });
  assert((await homeTab.boundingBox()).x > (await profileTab.boundingBox()).x);
  await shot('home');
  await profileTab.click();
  await expect(page).toHaveURL(/\\/profile$/);
  assert.deepEqual(errors, []);`,
);
process.argv = [
  process.argv[0],
  sourcePath,
  "dist-parity",
  "qa/parity-evidence/native/customer-v2",
];
const fixture = new Module(sourcePath);
fixture.filename = sourcePath;
fixture.paths = require.resolve.paths(sourcePath);
fixture._compile(source, sourcePath);
