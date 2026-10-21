You are working on Famy's native app (React Native + Expo) in `mobile/`. Claude (lead engineer) owns the review and merge. Your job: **customer chat (Messages tab)**.

Two other agents are working in parallel:
- Codex window 1 is doing booking and payments.
- Cursor is doing the provider app.

Follow the **conflict rules** below exactly.

## Before you start
1. `git fetch origin && git checkout -b feat/mobile-chat origin/main`
2. Read:
   - `AGENTS.md` and `mobile/AGENTS.md`;
   - the Phase 1 code in `mobile/src/`;
   - the web chat: `src/routes/messages.index.tsx`, `src/routes/messages.$id.tsx`, `src/routes/chat.$id.tsx` if it exists, and the conversation, message and realtime hooks in `src/lib/db/*`.

## Scope
1. **Messages tab** (`mobile/src/app/(customer)/(tabs)/messages.tsx`, replacing the ComingSoon placeholder). Show the conversation list exactly like the web: same participant filter (only conversations the user is part of), same ordering, the last message, the time, the unread state, and pull-to-refresh. Handle empty, loading and error states.
2. **Conversation screen** (`mobile/src/app/(customer)/chat/[id].tsx`):
   - messages with the same table, RPCs and send mutation as the web;
   - realtime updates with `supabase.channel(...)` on the same table and filter the web uses;
   - mark as read with the same rule as the web;
   - the composer stays above the keyboard (`KeyboardAvoidingView`);
   - an inverted `FlatList`;
   - Arabic RTL bubbles; times in local format;
   - a booking header linking to the booking detail, if the web has one.
3. Entry points: the provider profile and the booking detail get a "Message" button **only where the web shows one**. Same rules for when chat is allowed.

## Conflict rules (mandatory)
- Put new data hooks in a **new file**, `mobile/src/lib/chatQueries.ts`. Don't edit `mobile/src/lib/queries.ts`, except to import from it.
- Put new UI in `mobile/src/ui/chat/`.
- i18n: add a **new top-level** section `mobileChat: { ... }` to both `src/lib/i18n/locales/ar.ts` and `en.ts`, inserted **immediately before the line `  helpC: {`**. Don't edit the `mobile:` section.
- For the two entry-point buttons, keep each edit to a few lines. If that file has changed on `origin/main` since you started, merge `origin/main` before you push.

## Rules
- No changes under `src/` other than the i18n section above. No migrations. No fake data. Every string goes through `t()`, with no tashkeel. 44px tap targets. Unsubscribe from realtime channels on unmount.
- Never print message contents or phone numbers in logs.

## Verify
From `mobile/`:
- `npx tsc --noEmit`
- `npx expo lint`
- `node qa/unit.cjs`
- `EXPO_OFFLINE=1 CI=1 npx expo export` for both `android` and `web`
- A Playwright harness (`qa/chat-web.cjs`) with intercepted fixtures covering: the list, an empty list, opening a chat, sending, a simulated incoming message, and errors. Take 390×844 Arabic screenshots.

From the repo root:
- `node qa/check-ar-tashkeel.mjs`
- `npx tsc --noEmit`
- `npm run test:unit`

## Deliver
- Push `feat/mobile-chat` and open a **Draft PR** titled "feat(mobile): customer chat".
- Never push to `main`, never force-push, never merge.
- Report:
  - the PR link and HEAD SHA;
  - exact check results;
  - the screenshots;
  - any web behavior you couldn't reproduce.
