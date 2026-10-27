// Test-only adapter: both captures consume the SAME live synthetic fixture object.
// Inject into Vite's preview module response, never into production source/bundles.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "../../..");
const font = (file) => fs.readFileSync(path.join(root, file)).toString("base64");
const fontCss = [
  [
    "Almarai",
    400,
    "mobile/node_modules/@expo-google-fonts/almarai/400Regular/Almarai_400Regular.ttf",
  ],
  ["Almarai", 700, "mobile/node_modules/@expo-google-fonts/almarai/700Bold/Almarai_700Bold.ttf"],
  [
    "Almarai",
    800,
    "mobile/node_modules/@expo-google-fonts/almarai/800ExtraBold/Almarai_800ExtraBold.ttf",
  ],
]
  .map(
    ([family, weight, file]) =>
      `@font-face{font-family:${family};font-weight:${weight};src:url(data:font/ttf;base64,${font(file)}) format('truetype')}`,
  )
  .join("\n");

exports.captureMatchingWeb = async function ({ browser, name, nativePath, fixture, origin }) {
  if (!origin) return;
  assert(["localhost", "127.0.0.1"].includes(new URL(origin).hostname), "local web only");
  const paths = {
    profile: "profile",
    bookings: "bookings",
    "category-babysitting": "category/babysitting",
    "category-tutoring": "category/tutoring",
    search: "search",
    addresses: "addresses",
    "family-members": "family-members",
    "family-member-new": "family-members?memberId=new",
    "family-member-edit": `family-members?memberId=${fixture.member.id}`,
    favorites: "favorites",
    notifications: "notifications",
    "promo-codes": "promo-codes",
    help: "help",
  };
  if (!paths[name]) return;
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "ar-EG",
    timezoneId: "Africa/Cairo",
  });
  // Web SSR uses famio_lang; native AsyncStorage uses famy.lang. They are not interchangeable.
  await context.addCookies([{ name: "famio_lang", value: "ar", url: origin }]);
  await context.addInitScript((f) => {
    localStorage.setItem("famio.lang", "ar");
    window.__seedCustomerParity = (qc) => {
      const uid = "preview-user-00000000-0000-0000-0000-000000000001";
      const p = {
        ...f.provider,
        profile: { full_name: f.provider.full_name, avatar_url: null },
        ratings: { rating_avg: f.provider.rating_avg, rating_count: f.provider.rating_count },
        trust: { score: f.provider.trust_score },
        services: [{ status: "approved", price_override: null, service: f.service }],
      };
      qc.setQueryData(["my-profile"], {
        id: uid,
        full_name: "حساب اختبار محلي",
        phone: null,
        avatar_url: null,
      });
      qc.setQueryData(["addresses", uid], f.addresses);
      qc.setQueryData(
        ["default-address", uid],
        f.addresses.find((a) => a.is_default) || f.addresses[0] || null,
      );
      for (const a of f.addresses) qc.setQueryData(["address", uid, a.id], a);
      qc.setQueryData(["categories"], f.categories);
      for (const slug of ["all", "babysitting", "tutoring"])
        qc.setQueryData(["marketplace-services", slug], slug === "tutoring" ? [] : [f.service]);
      for (const categorySlug of [undefined, "babysitting", "tutoring"])
        for (const serviceId of [undefined, f.service.id])
          for (const addressId of [undefined, ...f.addresses.map((a) => a.id)])
            for (const limit of [20, 50, 60]) {
              qc.setQueryData(
                ["providers", { categorySlug, serviceId, addressId, limit }],
                categorySlug === "tutoring" ? [] : [p],
              );
            }
      qc.setQueryData(["approved-teaching-capabilities-many", [p.id]], []);
      qc.setQueryData(["approved-teaching-capabilities-many", []], []);
      qc.setQueryData(["customer-education-profile"], null);
      qc.setQueryData(
        ["my-bookings"],
        f.bookings.map((b) => ({ ...b, provider: p })),
      );
      qc.setQueryData(["family-members"], f.members);
      qc.setQueryData(
        ["family-members", "active"],
        f.members.filter((m) => m.is_active),
      );
      for (const m of f.members) qc.setQueryData(["family-member", m.id], m);
      qc.setQueryData(["teaching-curricula", false], []);
      qc.setQueryData(["teaching-levels", false], []);
      qc.setQueryData(
        ["favorites"],
        f.favorites.map((row) => ({ ...row, provider: p })),
      );
      qc.setQueryData(
        ["favorite-ids"],
        f.favorites.map((row) => row.provider_id),
      );
      qc.setQueryData(["notifications"], f.notifications);
      qc.setQueryData(
        ["notifications", "unread-count"],
        f.notifications.filter((n) => !n.read_at).length,
      );
      qc.setQueryData(["featured-promo-codes"], f.promos);
      qc.setQueryData(["my-promo-redemptions"], []);
      window.__paritySeeded = true;
    };
  }, fixture);
  let injected = false;
  const errors = [];
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "fonts.googleapis.com")
      return route.fulfill({ contentType: "text/css", body: fontCss });
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/src/components/preview/PreviewShell.tsx") {
      const response = await route.fetch();
      const body = await response.text();
      // Seed only after hydration. Changing the cache during the initial render
      // made server-rendered favorites disagree with the first client tree.
      assert(body.includes("installPreviewFetchGuard();"), "preview mount anchor changed");
      injected = true;
      return route.fulfill({
        response,
        body: body.replace(
          "installPreviewFetchGuard();",
          "installPreviewFetchGuard(); window.__seedCustomerParity(qc);",
        ),
      });
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(`${origin}/preview/${paths[name]}`, {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    await page.waitForFunction(() => window.__paritySeeded === true);
    assert(injected, "same-fixture preview injection must execute");
    await page.locator("h1").first().waitFor({ state: "visible" });
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
    await page.waitForFunction(
      () => document.documentElement.lang === "ar" && document.documentElement.dir === "rtl",
    );
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await page.addStyleTag({
      content:
        'a[href="/preview"]{visibility:hidden!important} div.brand-hero.shrink-0.px-4.py-2{display:none!important}',
    });
    await page.evaluate(() => document.fonts.ready);
    assert.deepEqual(errors, []);
    const webPath = nativePath.replace(/\.png$/, "-web.png");
    await page.screenshot({ path: webPath });
    const pair = await context.newPage();
    await pair.setViewportSize({ width: 780, height: 872 });
    await pair.setContent(
      `<style>body{margin:0;background:white;font:14px sans-serif}header{height:28px;display:flex}header span{width:390px;text-align:center}main{display:flex}img{width:390px;height:844px}</style><header><span>Web · same fixture · 390 × 844</span><span>Native web export · 390 × 844</span></header><main><img src="data:image/png;base64,${fs.readFileSync(webPath).toString("base64")}"><img src="data:image/png;base64,${fs.readFileSync(nativePath).toString("base64")}"></main>`,
    );
    await pair.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
    const comparisons = path.join(__dirname, "comparisons", "parity-5");
    fs.mkdirSync(comparisons, { recursive: true });
    await pair.screenshot({ path: path.join(comparisons, `${name}.png`) });
    // Persist only public synthetic inputs, never sessions/tokens or real user data.
    fs.writeFileSync(
      path.join(comparisons, `${name}.fixture.json`),
      JSON.stringify(fixture, null, 2),
    );
  } catch (error) {
    fs.writeFileSync(
      nativePath.replace(/\.png$/, "-web-failure.json"),
      JSON.stringify({ screen: name, error: error.message, pageErrors: errors }, null, 2),
    );
    await page
      .screenshot({ path: nativePath.replace(/\.png$/, "-web-failure.png") })
      .catch(() => {});
    throw new Error(`${name}: ${error.message}`);
  } finally {
    await context.close();
  }
};
