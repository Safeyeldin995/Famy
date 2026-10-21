You are working on Famy's native app (React Native + Expo) in `mobile/`. Claude (lead engineer) owns the review and merge. Your job: **Provider app, part 1** (the provider workspace in the native app).

Two Codex agents are working in parallel on the customer side (booking/payments and chat). Follow the **conflict rules** below exactly.

## Before you start
1. `git fetch origin && git checkout -b feat/mobile-provider-1 origin/main`
2. Read:
   - `AGENTS.md` and `mobile/AGENTS.md`. The Expo SDK is 58: check APIs in `node_modules` types, not from memory. Use `EXPO_OFFLINE=1 npx expo install <pkg>` if Expo's servers can't be reached.
   - the mobile foundation and the customer screens in `mobile/src/` (follow the same patterns: `@/ui/*`, `@/lib/session`, theme tokens, `t()`);
   - the web provider app:
     - `src/routes/pro.tsx` (layout and guards)
     - `src/routes/pro.index.tsx`
     - `src/routes/pro.bookings.tsx`
     - `src/routes/pro.booking.$id.tsx`
     - `src/routes/pro.availability.tsx`
     - `src/routes/pro.earnings.tsx`
     - `src/routes/pro.notifications.tsx`
     - `src/routes/pro.profile.tsx` (read-only parts)
     - their hooks in `src/lib/db/*`

## Scope
1. **Routing.** In `mobile/src/app/index.tsx` and `mobile/src/app/login.tsx`, send users whose workspace is `provider` to the new provider tabs instead of `/workspace-on-web`. Admins still go to `/workspace-on-web`. Mirror the web guards in `pro.tsx`: a provider who isn't approved or onboarded yet gets a screen explaining their status, with a button that opens the matching web page (`/pro/onboarding`, `/pro/apply`, `/pro/documents`) through `expo-web-browser`. Onboarding and documents stay on the web for now.
2. **Provider tabs** under `mobile/src/app/(provider)/(tabs)/`, with the same tabs as the web provider bottom nav:
   - **Home:** new requests with accept/decline, the next job, this month's earnings, rating.
   - **Bookings/Tasks:** upcoming and past lists.
   - **Schedule:** view and edit weekly availability, same rules and RPC as `pro.availability.tsx`.
   - **Earnings.**
   - **Profile:** read-only summary, notification preferences link, language switch, logout. Editing the profile and services stays on the web for now, through a button that opens the web page.
3. **Booking detail** `mobile/src/app/(provider)/booking/[id].tsx`: port the actions in `pro.booking.$id.tsx` exactly:
   - accept, decline (with reasons), start and complete, with the same RPCs and the same status/time guards;
   - confirming a cash or InstaPay payment **only where the web allows it**;
   - viewing a payment receipt via a signed URL, as on the web;
   - the customer contact rules (the phone is shown only when the web shows it).
4. **Notifications** list for providers (`pro.notifications.tsx`).

## Conflict rules (mandatory)
- Put new data hooks in **new files** under `mobile/src/lib/provider/`. Don't edit `mobile/src/lib/queries.ts`; you may import from it.
- Put new UI in `mobile/src/ui/provider/`. Don't edit existing files in `mobile/src/ui/`, other than adding an export if you really must.
- i18n: add a **new top-level** section `mobilePro: { ... }` to both `src/lib/i18n/locales/ar.ts` and `en.ts`, inserted **immediately before the line `  bookingUx: {`**. Reuse existing `pro.*` keys wherever they fit.
- Outside `(provider)/`, `lib/provider/` and `ui/provider/`, only touch `mobile/src/app/index.tsx` and `mobile/src/app/login.tsx`, with small edits.

## Rules
- Same Supabase project and RLS. No changes under `src/` other than the i18n section. No migrations.
- Never mark anything paid that the web wouldn't allow. Never change prices or commission. No fake data.
- Every string goes through `t()`, with no tashkeel. RTL-safe styles (`start`/`end`). 44px tap targets. Loading, empty and error states with retry. Pull-to-refresh.

## Verify
From `mobile/`:
- `npx tsc --noEmit`
- `npx expo lint`
- `node qa/unit.cjs`
- `EXPO_OFFLINE=1 CI=1 npx expo export` for both `android` and `web`
- A Playwright harness (`qa/provider-web.cjs`) with intercepted fixtures. Every remote request must be intercepted, and nothing may touch the live database. Cover each tab, accepting and declining a request, start/complete, the availability edit, and the not-approved status screen. Take 390×844 Arabic screenshots.

From the repo root:
- `node qa/check-ar-tashkeel.mjs`
- `npx tsc --noEmit`
- `npm run test:unit`

## Deliver
- Push `feat/mobile-provider-1` and open a **Draft PR** titled "feat(mobile): provider app part 1".
- Never push to `main`, never force-push, never merge, never print secrets.
- Report:
  - the PR link and HEAD SHA;
  - exact check results;
  - the screenshot list;
  - any web rule you couldn't reproduce exactly.
