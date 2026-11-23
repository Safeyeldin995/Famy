# Release QA checklist (closed beta → store)

Use this before the first **production** EAS build and before Play / App Store submission. Run **mobile** steps on a real device with a **production-profile** build (no demo Apple Pay, no Firebase test mode). Run **admin** steps in a desktop browser on Production.

Evidence to keep: screenshots or screen recordings for payment proof, cancellation fee, and payout flows.

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

**Store-specific (customer build):**

- [ ] Production build: **no** “Apple Pay” demo row on checkout (`EXPO_PUBLIC_DEMO_PAYMENTS` off; see `mobile/src/lib/demoPayments.ts`).
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
| A6 | Provider statement | Provider financial statement / ledger view | Matches payout totals for a test provider |
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
cd mobile && npx vitest run src/lib/__tests__/demoPayments.test.ts
```

---

## References

- Store submission prep: [docs/store/checklist.md](../store/checklist.md)
- Permissions audit: [mobile/store/permissions.md](../../mobile/store/permissions.md)
- EAS profiles: [mobile/eas.json](../../mobile/eas.json)
- Demo payments (preview only): [mobile/src/lib/demoPayments.ts](../../mobile/src/lib/demoPayments.ts)

---

## العربية (للمنتج)

| الدور | أهم حاجة تتأكد منها على الجهاز |
| --- | --- |
| عميل | تسجيل بالموبايل، حجز، دفع (كارت / إنستاباي / كاش)، إلغاء برسوم لو المسموح، حذف الحساب من البروفايل، شروط وخصوصية من تسجيل الدخول |
| مقدم خدمة | قبول شغل، بدء وإنهاء الجلسة، الأرباح والتحويل، حذف الحساب والشروط من البروفايل |
| أدمن | موافقة مقدم، طابور مدفوعات إنستاباي، تقارير، كشف حساب مقدم، استرداد |

بناء **production** لازم يكون **من غير** زر Apple Pay التجريبي.