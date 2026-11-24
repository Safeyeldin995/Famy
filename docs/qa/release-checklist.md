# Release QA checklist (closed beta → store)

Use this before the first **production** EAS build and before Play / App Store submission. Run **mobile** steps on a real device with a **production-profile** build (no demo Apple Pay, no Firebase test mode). Run **admin** steps in a desktop browser on Production.

Evidence to keep: screenshots or screen recordings for payment proof, cancellation fee, and payout flows.

**Automated CI gate (every PR):** `npm run test:release-gate:db`, `node qa/check-maestro-flows.mjs`, and admin Playwright (`npm run test:release-gate:admin`) when QA secrets are configured — **reports, payments, monitoring, settings only** (no ledger writes).

**Manual until disposable QA DB:** provider statement panel + **Download PDF** / `.statement-print` preview (A6). Ledger rows are immutable; seeding them in shared QA blocks provider teardown.

**Store build gate:** CI green + Codex clean + this checklist all **Pass** + zero open P1 bugs + Sentry crash-free sessions ≥ **99.5%** (see PR template).

---

## Device matrix (manual)

| Device | OS | Network | Flow set | Pass |
| --- | --- | --- | --- | --- |
| Low-end Android (2–3 GB RAM) | Android 10–11 | Wi‑Fi | Customer C1–C11 + Provider P1–P9 | |
| Mid-range Android | Android 14+ | 4G | Same | |
| Older iPhone | iOS 16 | Wi‑Fi | Same | |
| Current iPhone | iOS 18+ | 4G | Same | |
| Any (online lessons) | — | Throttled **3G** | Online lesson join/rejoin (when flag on) | |

---

## Maestro flows (Android CI / local)

| Flow file | Journey | Pass |
| --- | --- | --- |
| `01-customer-sign-in.yaml` | Test OTP sign-in | |
| `02-in-person-booking-request.yaml` | In-person booking request | |
| `03-online-lesson-happy-path.yaml` | Online lesson E2E (flag on) | |
| `04-customer-cancel-fee-windows.yaml` | Cancel &gt;4h and &lt;4h | |
| `05-provider-cancel-wallet.yaml` | Provider cancel → wallet credit | |
| `06-report-problem.yaml` | Report a problem | |

---

## Customer (mobile)

| # | Flow | Steps | Pass criteria |
| --- | --- | --- | --- |
| C1 | Sign up + OTP | Login → new phone → OTP → set password if prompted → complete customer setup (name, address) | Lands on home; session survives app restart |
| C2 | Browse + book | Home → category → provider profile → book → pick slot, address, family member → review | Booking appears under **Upcoming** with correct price and Cairo date/time |
| C3 | Card payment (online) | Open booking → pay → choose card/online → complete Paymob flow (or sandbox per environment) | Booking payment status moves to paid/pending per product rules; receipt visible if applicable |
| C4 | InstaPay | Pay → InstaPay → upload proof → submit | Staff can see proof in admin queue (A5); customer sees pending/confirmed state |
| C5 | Cash | Pay → cash → confirm | Booking shows cash method; provider sees it on job detail |
| C6 | Chat | Booking detail → messages; send text | Message appears for provider; push opens correct thread (device) |
| C7 | Cancel (fee) | Cancel an eligible booking where policy applies a fee | Fee amount matches policy copy; balance/debt banner if applicable |
| C8 | No-show path | Use a booking in a state where no-show applies (or admin-triggered per runbook) | Status and customer copy match policy |
| C9 | Account deletion entry | Profile → delete account (bottom) | Screen loads guards; terms/privacy reachable from profile and login |
| C10 | Legal on login | Login screen → terms + privacy links | Native content screens open without error |
| C11 | Promo / search smoke | Promo codes list; search providers | Empty states show Arabic copy; no clipped text on small Android |
| O1 | Online book (3 taps) | Provider profile (online tutoring) → book → pick slot → optional note → **Request lesson** | No address step; DOB inline once if missing; booking lands as **requested** |
| O2 | Timeline + pay countdown | Provider confirms → customer opens booking | Timeline shows Confirmed + live pay countdown; copy says who waits on whom |
| O3 | One-tap pay | Confirmed booking → **Pay now** (saved card preselected) | Paymob opens once; status moves to paid; timeline advances |
| O4 | Wallet credit notice | Provider cancels a paid online lesson | Push + wallet history; balance increases once |
| O5 | Join flow | Paid lesson within join window → **Join** | Pre-join auto-advances when mic/cam/network OK; lands in room |
| O6 | Weak network | Simulate poor network in lesson | Audio-only banner; auto-rejoin after brief drop without extra taps |
| O7 | Rejoin after leave | Leave room before end time | Rejoin stays available until lesson end |
| O8 | Post-lesson | Complete lesson → rate 1–5 + optional comment → **Book again** | Rating saves; rebook opens same provider with online mode |
| O9 | Provider request push | New online request + no response 15m (staging cron) | Provider gets reminder; tap opens pending request |
| O10 | Lesson starting push | Start window → **Join** action on notification | Deep link opens pre-join / room for that booking |

**Store-specific (customer build):**

- [ ] Production build: Apple Pay / Google Pay rows appear **only** when Paymob wallet integration IDs and (iOS) merchant ID are configured; no demo or “soon” payment labels.
- [ ] iOS permission strings: Arabic device language shows `mobile/locales/ar.json` copy for location/photos.
- [ ] Version **1.0.0** with EAS `autoIncrement` on production profile (`mobile/eas.json`).

---

## Provider (mobile)

| # | Flow | Steps | Pass criteria |
| --- | --- | --- | --- |
| P1 | Sign up + OTP | Same phone OTP path → provider apply / onboarding | Can reach dashboard when approved |
| P2 | Accept job | Dashboard pending request → accept | Booking moves to accepted; customer notified |
| P3 | Start / complete service | Job detail → start → complete per lifecycle | Status transitions match web; earnings row updates |
| P4 | Earnings / payout | Earnings tab → completed jobs → payout method | Amounts use consistent number formatting (Latin digits in Arabic UI) |
| P5 | Payout method | Profile → documents / wallet panels as applicable | InstaPay/wallet labels and logos render |
| P6 | Schedule | Profile → hours / schedule | Saves without error |
| P7 | Messages + notifications | Pro messages; notification list + mark read | Empty states present; deep link opens booking/chat (device) |
| P8 | Account deletion | Pro profile → delete account | Same deletion flow as customer; guards for active bookings/unpaid |
| P9 | Legal links | Pro profile → help, terms, privacy | Screens open (same content as customer) |

---

## Admin (web — `/staff`)

| # | Flow | Steps | Pass criteria |
| --- | --- | --- | --- |
| A1 | Staff login | Sign in with admin account | Operations home loads |
| A2 | Provider approval | Providers → pending → approve sections | Provider can go live on mobile |
| A3 | Booking operations | Bookings list → open booking → status actions | Matches mobile-visible status |
| A4 | Payments queue | Operations / payments → InstaPay proofs | Approve/reject updates customer booking |
| A5 | Reports | Reports (daily/KPIs per current admin IA) | Numbers load; export if available |
| A6 | Provider statement (**manual**) | Provider detail → **Statement / كشف حساب** → open rows → **Download PDF** | Print preview (`.statement-print`) shows opening/closing balance; matches payout totals for a provider with ledger rows in period |
| A7 | Refund | Refund action on eligible payment (per policy) | Ledger and booking payment state consistent |

---

## Regression gates (engineering)

Run on the PR branch before merge:

```bash
npm ci
npm run test:unit
npx tsc --noEmit
cd mobile && npx tsc --noEmit && npm run test:unit
```

Optional focused mobile unit check for store payments flag:

```bash
cd mobile && npx vitest run src/lib/__tests__/paymobWalletMethods.test.ts
```

---

## References

- Store submission prep: [docs/store/checklist.md](../store/checklist.md)
- Permissions audit: [mobile/store/permissions.md](../../mobile/store/permissions.md)
- EAS profiles: [mobile/eas.json](../../mobile/eas.json)
- Paymob wallet checkout: [mobile/src/lib/mobilePayments.ts](../../mobile/src/lib/mobilePayments.ts), [mobile/src/lib/paymobNative.ts](../../mobile/src/lib/paymobNative.ts)

---

## العربية (للمنتج)

| الدور | أهم حاجة تتأكد منها على الجهاز |
| --- | --- |
| عميل | تسجيل بالموبايل، حجز، دفع (كارت / إنستاباي / كاش)، إلغاء برسوم لو المسموح، حذف الحساب من البروفايل، شروط وخصوصية من تسجيل الدخول |
| مقدم خدمة | قبول شغل، بدء وإنهاء الجلسة، الأرباح والتحويل، حذف الحساب والشروط من البروفايل |
| أدمن | موافقة مقدم، طابور مدفوعات إنستاباي، تقارير، كشف حساب مقدم، استرداد |

بناء **production** لازم يكون **من غير** زر Apple Pay التجريبي.