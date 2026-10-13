# Admin patch 2 — implementation handoff, not merge-ready

Branch: `codex/admin-patch-2`, based on `main` at `a52a3b3`. Follows the patch 2 plan in [ADMIN_AUDIT.md](../ADMIN_AUDIT.md) and #157 / #158.

## Scope

- Bookings: removed arbitrary status writes; cancellation retains `cancel_booking` through the existing hook/dialog. Disputed/no-show rows link to the matching case queue and booking. Arabic chips, party/code search, service, localized dates, short LTR booking code.
- Cases: one active-first list of support, disputes and no-shows. Existing resolution hooks/RPCs retained. Expanded details include the booking status history and read-only chat (no message-send or mark-read call).
- Payments: `pending_review` first; transfer review only, existing capture/rejection paths, reason sheet and explicit receipt confirmation. Capture remains disabled before booking completion. Other payment statuses are read-only. Signed proof URLs remain private Storage/RLS reads; a synthetic SVG is used only on preview routes.
- No migration, backend function change, commission/pricing update, real payment operation, Production/QA access, merge or deployment. Shared dirty root and other windows' branches were not touched.

## Verification

- `npx tsc --noEmit`: exit 0.
- `npx vitest run --maxWorkers=2`: **exit 1**, 223 files passed / 1 failed / 7 skipped; 1382 tests passed / 1 failed / 75 skipped. Failure: `src/lib/preview/__tests__/mockData.test.ts`, frozen-clock expectations. This is **not** the allowed #152 timeout.
- One correction replaced the new seed's wall clock with `PREVIEW_NOW_ISO` and restored the first booking's expected offset. Final focused run: **exit 1**, 12 passed / 1 failed. The remaining expectation requires the first payment's `created_at` to equal `PREVIEW_NOW_ISO`; the seed currently uses one hour earlier. No assertion was weakened. Stopped under the anti-loop contract; full suite was not rerun.
- The 10 new operational-policy/payment-action tests passed, including row-specific confirmation/rejection payloads, completed-booking gate, read-only captured payments, private proof helper, booking cancellation gating, search and merged-case ordering.
- `npm run build`: exit 0 on the final source, including the preview-clock correction.
- `node qa/check-ar-tashkeel.mjs`: exit 0, 666 source files.
- Prettier applied to changed screens/new files and appended locale blocks, preserving unrelated locale formatting. `git diff --check`: exit 0.

## Browser evidence and open HIGH gates

1. **Test gate remains failed:** deterministic payment seed timestamp mismatch described above. Needs a bounded closure and a final full test run before merge.
2. **Payment confirmation interaction unverified:** the Edge preview script timed out waiting for the confirmation group after clicking the transfer button. Unit mocks pass; this is not proof of a working browser interaction. First run was interrupted by a verified Vite dependency-optimizer reload; the next run hit this new failure and was stopped. No speculative retries or payment mutation submissions.
3. **Visual acceptance is incomplete:** existing desktop admin-shell group headings still render English. Passive payment captures do not show the effect-loaded proof image; image rendering and detail interaction still need verification after the browser blocker is diagnosed. Do not describe the screenshots as full Arabic/interaction acceptance.

The six final screenshots below are **passive synthetic preview captures only**, not interaction passes, authenticated RLS proof or live payment evidence. Capturing the unaffected desktop layouts did not retry the failed action. Document width matched viewport width on all six captures. They do not prove all enclosing-container clipping, live data completeness, signed Storage permissions or server transitions.

| Screen   | 390 × 844                          | 1280 × 800                           |
| -------- | ---------------------------------- | ------------------------------------ |
| Bookings | [Mobile](patch-2-bookings-390.png) | [Desktop](patch-2-bookings-1280.png) |
| Cases    | [Mobile](patch-2-cases-390.png)    | [Desktop](patch-2-cases-1280.png)    |
| Payments | [Mobile](patch-2-payments-390.png) | [Desktop](patch-2-payments-1280.png) |

Next: Claude reviews the current Draft diff and directs one bounded closure of the two failed gates. Do not merge this handoff as ready.
