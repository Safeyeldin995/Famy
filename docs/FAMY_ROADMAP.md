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
| Ratings/reviews E2E coverage | PR #19 |
| Payment-proof capture E2E coverage (incl. RLS negative-path) | PR #20 |

### OPEN — tracked, in progress

| Item | Status | Blocking on |
|---|---|---|
| Rotate the leaked QA service-role key (`qa/report/results.json`, pre-PR #16) | Not yet done — Supabase dashboard action only Safeyeldin can take. | Safeyeldin |

### PARKED

| Item | Status | Reason |
|---|---|---|
| **Issue #6** — Provider service-start lifecycle (`confirmed → on_the_way → arrived → arrival_confirmed → in_progress`) | Explicitly parked 2026-08-12 after a flaky final console assertion. A fresh spec exists uncommitted on `test/provider-service-start-lifecycle-v2` (now committed there as WIP, not run/validated). PR #7 (old attempt) is Draft and conflicts with `main`. | Needs your decision to resume — see Milestone 1 below |

### Milestone 1 audit results (2026-08-23)

| Item | Verdict | Evidence |
|---|---|---|
| Ratings / reviews | **DONE (app code) / GAP (no E2E spec)** | `reviews` + `ratings_summary` tables (`20260627001502_...sql`); `useProviderReviews`/`useBookingReview`/`useSubmitReview` in `src/lib/db/queries.ts:836-882`; customer star+comment UI in `src/routes/booking.$id.tsx:259-320`; provider-facing display in `src/routes/provider.$id.tsx:88,99,168-172`. No `qa/tests/*.spec.ts` exercises this flow. |
| Payment-proof capture → admin verification | **DONE (app code) / GAP (no E2E spec)** | Shared `src/components/famio/PaymentBlock.tsx` (customer upload UI, 10MB validation, awaiting-review state); `useUploadPaymentProof` in `src/lib/db/payment-queries.ts:108-125` uploads to `payment-proofs` bucket + updates `payments.proof_path`; RLS correctly scoped (`payments_customer_insert`, `payments_customer_update_proof` — locked after review). Zero E2E specs drive a real file upload through this flow; existing admin payment specs only exercise pre-seeded fixture data. |
| Provider payouts | **NOT STARTED — genuine gap, needs your decision** | `pro.earnings.tsx` is read-only (sums `payments` where `status='captured'`); its "Recent Payouts" section (line 51) is actually just completed bookings, not payout records — **mislabeled**, should read something like "Recent Completed Jobs" regardless of what's decided below. No `payouts` table, no admin payout-issuance UI, no QA spec, and no doc anywhere states payouts are intentionally manual/outside-app. |
| Production deployment readiness | **NOT STARTED** | Only `docs/QA_ENVIRONMENT.md` exists; no Production runbook. Tracked as Milestone 3, not re-audited here — it's a "write it" task, not a "find it" task. |

### CRITICAL — Production data hygiene (found 2026-08-23, Milestone 3)

Read-only audit against live Production (project `mjhk…nojp`), run directly by
Safeyeldin per the harness's own Production-access guardrail (a stricter,
separate gate from `AGENTS.md`'s approval chain — it won't let Claude touch
Production DB access via chat at all, even read-only).

**Schema is fully in sync** — every recent migration (reviews, ratings_summary,
payments proof columns, bookings idempotency, zones) is present and correct.
No migration gap.

**Data hygiene is not.** Two independent signals disagree sharply on scope:

| Signal | Count | Share |
|---|---|---|
| `profiles.full_name ILIKE 'QA_%'` | 315 / 433 profiles | 73% |
| `bookings.notes ILIKE 'QA_%'` | 155 / 396 bookings | 39% |
| **`auth.users.email` ending `@famio.local`** (the actual QA fixture email domain) | **553 / 915 auth users** | **60%** |
| `profiles` with empty/null `full_name` | 116 / 433 | 27% |

The `@famio.local` figure is the reliable one — it's the literal email pattern
QA fixtures use, not a fuzzy name match — and it's nearly double the "QA_"
name-based count. There are also **482 auth users with no `profiles` row at
all** (915 auth users vs. 433 profiles), which is its own separate question
(orphaned signups? failed profile creation? unrelated to the QA question).

**What's confirmed safe:**
- Pollution is **historical only** — every QA-named row's `created_at` falls
  between 2026-07-16 and 2026-08-02, right up to when the dedicated QA-tier
  Supabase project appears to have been formalized (~2026-08-04 per git
  history). Nothing new has landed since. This is cleanup of a past mistake,
  not an active leak to plug.
- **Zero real `payments` rows** are attached to any QA-looking booking —
  financially clean.
- 150 of 155 QA-looking bookings are already `cancelled` (inert).

**What's not yet safe:**
- **49 QA-looking profiles are not suspended** — live/active fake accounts
  sitting in Production.
- **5 QA-looking bookings are still `pending`** — could surface in a real
  provider/admin workflow.
- The full scope (553 `@famio.local` auth users vs. 315 QA-named profiles vs.
  116 empty-name profiles vs. 482 profile-less auth users) has **not been
  reconciled into one clear list** — these are four overlapping signals, not
  yet cross-referenced into "here are exactly the N accounts that are fake."

**Update 2026-08-23 — reconciled and independently audited (Cursor +
Codex).** The picture is now much clearer, and simpler than the first pass
suggested:

| Question | Answer | Confidence |
|---|---|---|
| Are any of Production's 433 `profiles` real (non-test)? | **Retracted as stated — see round 3 below.** The "0/433" figure relied on `@famio.local` email as the fake signal, which round 3 showed is not reliable (the real phone-signup code produces the same domain). What's still solid: 230 profiles have the unambiguous literal `QA_` name prefix. The rest are genuinely uncertain, not "confirmed fake." | **Downgraded — do not treat as settled.** |
| Is the marketplace-activity blast radius bigger than "some bookings"? | The *join logic* correction (following `providers.profile_id` instead of comparing `providers.id` directly) is still valid and important if/when a real fake-id set is established. But the **input set** (which ids count as "fake") is the part now in question, so the specific counts (163 providers, 396 bookings, 208 addresses, 75 payments) inherit that same uncertainty — the corrected *method* is right, the *scope* it was applied to needs re-establishing. | Method: High. Scope: unproven. |
| Are the 362 profile-less, phone-only auth rows real people? | Still plausible, still unproven — unchanged by round 3. | Medium |
| Why do 362 (and a related 271 profiles-missing-roles) auth rows lack what the signup trigger should create? | Still open. Live `pg_trigger` state could not be checked by either Cursor or Codex (no DB console access from local tooling) — needs the Dashboard SQL query below, run by Safeyeldin. Also found: the "orphan pattern stopped Jul 28" claim was itself wrong (16 more appeared Aug 2). | Needs the Dashboard check + Safeyeldin's institutional knowledge, see round 3. |

**What round 3 changes:** see the retraction directly below this table —
the "100% test data, safe to reset" framing does not hold up and should not
be acted on.

**Still not actioned, still needs your explicit approval:** no mutation of
any kind has been performed.

**Update 2026-08-23, round 3 — retracting the "100% test data" framing
above.** A follow-up investigation into why 362 signups were missing their
profile/role (a separate HIGH item) surfaced a flaw in the core signal the
"0/433 real profiles" conclusion was built on, caught by a second
independent Codex audit:

**`@famio.local` is not a reliable fake-data signal.** The app's real
Production phone-signup code (`src/lib/auth/authEmail.ts`) synthesizes the
exact same `phone-${digits}@famio.local` pattern for genuine users, because
Supabase Auth needs an email-shaped identifier even for phone-only signup.
So an `@famio.local` email means "this account signed up by phone" — real
or fake — not "this is QA debris." Every earlier count built on that domain
(the 553 figure, and by extension "0/433 profiles are real") is now
**unproven, not disproven.**

**What's still solid, unchanged across all three rounds:** the literal
`QA_` name prefix (230 profiles, exact string match, not the earlier buggy
`ilike` wildcard) is unambiguous — a real person does not accidentally name
themselves that. Schema-sync findings and row counts (915 auth users, 433
profiles) are also solid, independently reproduced multiple times. What's
no longer solid: which of the remaining ~323 `@famio.local`-but-not-`QA_`-
named accounts are test fixtures versus genuine early real signups. Also
found: 271 profiles have no `user_roles` row (inverse anomaly, same
Jul 16–28 cluster), and the "orphan pattern stopped Jul 28" claim was
itself wrong — 16 more fake-signal orphans appeared Aug 2. Full detail:
three rounds of Cursor investigation + two rounds of independent Codex
audit, each round correcting the last, are preserved in this branch's PR
history for anyone who wants the forensic trail.

**Why this stops here instead of a fourth round:** three consecutive
rounds of automated data-forensics each overturned the previous round's
headline conclusion. That's a signal to stop iterating on process and ask
the person who might just know the answer directly — **Safeyeldin: do you
know, from memory, whether Famy had any genuine real-user signups before
around early August 2026, or was all activity in Production through that
point internal/dev/test by you and collaborators?** If you know the answer
outright, that resolves this faster than a fourth investigation round
could. If you don't know, the next step is a better signal than email-
domain matching — e.g. cross-referencing against known QA test-run
timestamps, or a specific test-phone-number range if one was used — before
any remediation plan, surgical or full-reset, gets proposed.

**Update 2026-08-23, round 4 — resolved by Safeyeldin directly, full reset
now the agreed direction.** Confirmed: Famy has no public launch yet, no
real users with an expectation of data persistence. This dissolves the
forensic question above — it no longer matters which accounts are real vs.
test, since none of them are real *users* in the sense that needs
protecting. Decision: full reset of Production's user-generated data before
beta launch, catalog/seed data preserved.

**Stage 1 (dependency mapping), round 1 — Cursor, then corrected by Codex
audit:** confirmed four tables have unconditional `BEFORE UPDATE OR DELETE`
immutability triggers that fire even for `service_role` (`audit_logs`,
`booking_cancellations`, `messages`, `ticket_messages` — exact migration
lines in PR history), several RESTRICT/NO ACTION foreign keys block naive
deletion, and `TRUNCATE … CASCADE` correctly bypasses row-level (not
statement-level) triggers per Postgres semantics — confirmed against the
actual migration files, not assumed.

**Corrected finding — catalog scope was wrong.** Cursor's Stage 1 proposed
keeping `services` (479 rows) and `zones` (416 rows) as-is, flagging them
only as "likely QA-expanded." Codex's independent characterization, using a
reliable signal this time (unlike `@famio.local` for users — Production's
own product code does not auto-generate QA-shaped service/zone names, so
literal `QA_`/`QA ` prefix matching is trustworthy here): **only 18 rows in
`services` match the actual seed migration's exact slugs — the other 461
are QA fixtures. All 416 `zones` rows are QA-fixture-shaped; zero are
genuine.** Production currently has no real service-area coverage
configured at all. All 40 `service_requirements` and all 352
`booking_locations` depend on the QA-fixture catalog rows, not the seed
ones.

**Other corrections from the audit:** audit-log clearing must happen
*after* scoped catalog deletion (deleting QA services/zones fires their own
audit triggers, creating new rows that then also need clearing — not
before, as Stage 1 first proposed); the storage-object inventory needs to
be exhaustive/recursive, not a ~98-object shallow sample; `TRUNCATE …
CASCADE`'s exact table closure needs to be catalog-derived and explicit,
not left open-ended (Postgres CASCADE expands to every referencing table
automatically, so the full closure must be enumerated and fingerprinted
before any approval, not discovered at execute time). Minor: the "91% of
rows are audit_logs" figure was arithmetically off — it's 93.12%.

**Not yet ready for Stage 2 (QA-clone dry-run).** Stage 1 is being revised
by Cursor to fold in these corrections, then goes back to Codex once more
before Stage 2. No deletion/reset tooling has been written yet — Stage 1 is
still read-only mapping and proposal-writing.

Separately, one small closeable gap: neither Cursor nor Codex could confirm
the signup trigger's live enabled state from local tooling (no DB console
access). Run this once in the Supabase Dashboard SQL editor for the
Production project (read-only, safe):

```sql
SELECT tgname, tgenabled, pg_get_triggerdef(t.oid)
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = 'auth' AND c.relname = 'users' AND NOT t.tgisinternal;
```

Expect `on_auth_user_created` with `tgenabled = 'O'` (enabled), pointing at
`handle_new_user()`. Paste the result back whenever convenient — not
blocking anything else.

No mutation has been performed at any point in this investigation. Any
actual reset/cleanup still needs a purpose-built, reviewed, fingerprinted
plan — explicitly not a reuse of `qa/` tooling — with your specific
sign-off, the same discipline as the QA zone deactivation but at a
materially higher bar given this is real Production and the exact scope is
now confirmed uncertain, not just unconfirmed.

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
**Done 2026-08-23.** Results above. One open question for you: ratings/reviews
and payment-proof capture are real, working features already — no decision
needed there, just test coverage (Milestone 2). Payouts is the one genuine
open product decision — see Milestone 2 below.

### Milestone 2 — Close genuine functional gaps found in Milestone 1
*Exit criteria: E2E coverage exists for ratings/reviews and payment-proof capture; the payout decision is made and either implemented or documented as intentionally manual; the "Recent Payouts" mislabel is fixed regardless.*

Concrete items, now that Milestone 1 removed the guesswork:

1. ~~**E2E spec: ratings/reviews**~~ **Done 2026-08-23** — `qa/tests/ratings-reviews.spec.ts`, 1/1 pass (independently reproduced), no app defects found. Full suite: 21→22 spec files, 58→59 tests.
2. ~~**E2E spec: payment-proof capture**~~ **Done 2026-08-23** — `qa/tests/payment-proof-capture.spec.ts`, 1/1 pass (independently reproduced), no app defects found, including a verified RLS negative-path assertion. Full suite: 22→23 spec files, 59→60 tests.
3. **Provider payouts** — still needs your decision: (a) build real in-app payout tracking/issuance for beta, or (b) keep it manual/outside-app and fix the "Recent Payouts" → "Recent Completed Jobs" mislabel. Both Cursor and I independently recommend (b) for a closed beta, but it's your call, not an engineering default.
4. Provider service-start lifecycle (if resumed per Milestone 0 item 4).

### Milestone 3 — Production readiness
*Exit criteria: a reviewed, written Production deployment runbook (env vars, migration application order, rollback plan) exists alongside the QA one; a monitoring/alerting minimum (errors, failed payments, failed notifications) is wired up; one full dry-run of "deploy this exact `main` to Production" is reviewed and approved by you before it's ever executed for real; **and the Production data hygiene finding below is reconciled and remediated.**

**Confirmed 2026-08-23:** schema is fully in sync with `main` — no migration gap. **Not fine:** ~60% of Production auth users carry the QA-fixture email signature, historical (stopped ~Aug 2) but never cleaned up. See "CRITICAL — Production data hygiene" below. This blocks Milestone 4, not Milestone 3's other items — the runbook and monitoring work can proceed in parallel.

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
