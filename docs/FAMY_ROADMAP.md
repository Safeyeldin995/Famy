# Famy Roadmap — Path to Closed Beta

Owner: Claude Sonnet (CTO/orchestrator), per `AGENTS.md`. Living document —
update it at the end of every milestone, not just at the start of a new one.
This supersedes the "Patch 3/4/5: Not started" rows in
`docs/FAMY_PRODUCT_COMPLETION_MATRIX.md` — that matrix's Patch 1/2 evidence
is still authoritative, but Patches 3–5 were re-planned and largely executed
as the finer-grained `PATCH 6x` series instead of the original 3-patch shape.
That matrix is not being kept current; this file is.

## How to read this document

Every item below is graded by evidence, not intent:

- **DONE** — merged to `main`, has a PR number, has passing focused QA.
- **OPEN** — actively tracked, has a GitHub Issue.
- **PARKED** — real work exists but is explicitly on hold (see reason).
- **UNVERIFIED** — code may exist but nothing here confirms it end-to-end;
  needs an audit pass before it can be scheduled.
- **NOT STARTED** — no evidence found of implementation.

Do not promote anything to DONE without a merged PR + passing focused QA.
Do not re-scope an UNVERIFIED item into a milestone until it's been audited —
guessing at scope wastes a cycle when the audit would have taken an hour.

---

## Where we actually are (2026-08-23)

### Confirmed DONE

| Area | Evidence |
|---|---|
| Auth: WhatsApp OTP, password setup | commits `f7f1ec1`, `ce23393`, `3655a64` |
| Provider onboarding & verification | commit `29b2c5d`; `provider-onboarding*.spec.ts` (3 specs) |
| Identity separation (role exclusivity) | Patch 2 matrix, `role-exclusivity.spec.ts` |
| Marketplace eligibility pipeline | Patch 2 matrix — 12/12 conditions PASS |
| Admin runtime (18 read surfaces, 22 write flows) | Patch 1 matrix — 36/36 local+preview |
| Booking creation: idempotency, concurrency, server pricing, stale-eligibility re-check | PATCH 6A (`56581f4`), `booking-slot-golden-path.spec.ts`, `booking-double-submit.spec.ts`, `booking-stale-eligibility.spec.ts` |
| Provider booking acceptance (pending → confirmed) | PR #5, `provider-booking-accept.spec.ts` |
| Booking completion lifecycle | PR #10, `booking-completion-lifecycle.spec.ts` |
| Booking cancellation visibility | `booking-lifecycle.spec.ts` |
| Payment methods (configurable) | commit `64dec81` |
| Payment authority hardening | PATCH 6A/6D (`56581f4`, `3e1e9a7`) |
| Notifications + push delivery, worker auth hardening | commits `accaf25`, `04fcaff`, `066aeda` |
| Support disputes & no-show workflows | commit `54d2e8a`, `admin-case-controls.spec.ts` |
| Admin catalog self-cleaning E2E | PR #13 |
| QA report secret hygiene | PR #16 |
| QA zone-residue deactivation (Issue #12) | PR #17, live-executed and verified |
| Issue #12 closed: 58/58 full-E2E, residue-zero, catalog 6/18/4 — all independently re-verified against raw evidence, not self-reported | Issue #12, closed 2026-08-23 |

### OPEN — tracked, in progress

| Item | Status | Blocking on |
|---|---|---|
| Rotate the leaked QA service-role key (`qa/report/results.json`, pre-PR #16) | Not yet done — Supabase dashboard action only Safeyeldin can take. | Safeyeldin |

### PARKED

| Item | Status | Reason |
|---|---|---|
| **Issue #6** — Provider service-start lifecycle (`confirmed → on_the_way → arrived → arrival_confirmed → in_progress`) | Explicitly parked 2026-08-12 after a flaky final console assertion. A fresh spec exists uncommitted on `test/provider-service-start-lifecycle-v2` (now committed there as WIP, not run/validated). PR #7 (old attempt) is Draft and conflicts with `main`. | Needs your decision to resume — see Milestone 1 below |

### UNVERIFIED — needs an audit before scoping

No commit history, spec file, or route was found for these. That doesn't
prove they're missing — it means nobody has checked recently. First action
on each is a short read-only audit, not a build task.

| Item | Why it's flagged |
|---|---|
| Ratings / reviews | No route, no spec, no commit matching "rating"/"review" found anywhere. Either genuinely not built, or intentionally out of scope for beta — needs a product decision from you, not an engineering guess. |
| Payment proof capture → admin verification, end-to-end | `admin.payments.tsx` and `payment_methods` exist and are tested from the admin side; customer-side proof upload UX and its E2E proof were not confirmed in this pass. |
| Production deployment readiness (env parity, migration application process, monitoring/alerting) | Only QA-tier environment has a documented runbook (`docs/QA_ENVIRONMENT.md`). No equivalent Production runbook was found. |
| Provider earnings / payout | `pro.earnings.tsx` route exists; no payout-issuance flow or spec found. May be intentionally read-only/manual for beta. |

---

## Milestones

Each milestone follows the standard `AGENTS.md` workflow (Orient → Plan →
Implement → Local verification → Independent review → Focused QA → Merge
decision) per item, not as one giant batch. Ship milestones in order —
resist parallelizing across milestones, it's how scope drift happens.

### Milestone 0 — Close what's already in flight
*Exit criteria: Issue #6 has an explicit decision (resume or stay parked) with a paper trail either way.*

1. ~~Land the corrected clean full-E2E run (58/58) + residue-zero + protected-catalog evidence on Issue #12; close it.~~ **Done 2026-08-23**, independently re-verified.
2. Rotate the leaked QA service-role key (your action) and decide on the old `qa/report/results.json` (recommend: delete, now that PR #16 prevents recurrence). **Still open.**
3. ~~Triage `admin-remaining-mutations` activate-persistence failure~~ **Done** — passed cleanly on the corrected re-run, classified as contamination/flake, no new Issue needed.
4. Decision from you: resume Issue #6 now, or keep it parked while other milestones proceed. Either is fine — just make it explicit so it stops being a silent loose end.

### Milestone 1 — Scope audit (read-only, fast)
*Exit criteria: every UNVERIFIED item above is either reclassified as DONE/NOT STARTED with evidence, or turned into a scoped Issue with acceptance criteria — plus your explicit product decision on ratings/reviews and payouts (in-scope for beta or not).*

This is deliberately cheap and fast — a day of grep/read, not a sprint. Its whole point is to stop the next milestones from being guesses.

### Milestone 2 — Close genuine functional gaps found in Milestone 1
*Exit criteria: every Issue opened in Milestone 1 that you confirmed as in-scope for beta is merged, tested, and evidenced — same bar as everything in "Confirmed DONE" above.*

Contents unknown until Milestone 1 lands. Likely candidates based on today's audit: customer-side payment proof upload E2E proof, provider service-start lifecycle (if resumed), ratings/reviews (if in scope).

### Milestone 3 — Production readiness
*Exit criteria: a reviewed, written Production deployment runbook (env vars, migration application order, rollback plan) exists alongside the QA one; a monitoring/alerting minimum (errors, failed payments, failed notifications) is wired up; one full dry-run of "deploy this exact `main` to Production" is reviewed and approved by you before it's ever executed for real.*

This is the milestone where "destructive/Production/migration" approval gates in `AGENTS.md` matter most — expect this one to move slower and involve you directly at every step, by design.

### Milestone 4 — Closed beta launch
*Exit criteria: Production is live with real (non-QA) data, a defined small user group has access, and a feedback/incident loop is in place.*

---

## Maintenance rule for this document

Update the relevant table row (not a new section) the moment a milestone
item's status changes — merged PR, new Issue, closed Issue, or a
reclassification from UNVERIFIED. If this file and GitHub disagree, GitHub
wins per `AGENTS.md`'s source-of-truth order — fix this file, don't trust it
blindly next session.
