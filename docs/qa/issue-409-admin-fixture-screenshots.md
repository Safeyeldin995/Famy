# Issue #409 — admin entry point fixture screenshots

Capture these **preview** routes with Arabic RTL and fixture data for the PR (no production data):

| Item | Route |
| --- | --- |
| Online lessons switch | `/preview/admin/settings` (Release features section) |
| Lesson issue reports queue | `/preview/admin/online-lesson-issues` |
| Customer wallet (balance, history, credit/debit) | `/preview/admin/customer/<fixture-customer-id>` |
| Online commission % | `/preview/admin/settings` (Billing / payments section) |

Sidebar badge: `/preview/admin` — **Online lesson reports** count matches work queue.

Tutoring booking cascade (fixture provider with partial capabilities):

| Surface | Evidence |
| --- | --- |
| Mobile book flow | Provider book screen: subject → curriculum → grade sheets |
| Mobile booking detail | Receipt / **Add to calendar** / Support row above booking actions |

Playwright: extend `qa/tests/admin-daily-ops-ar-screenshots.spec.ts` or capture manually on preview.