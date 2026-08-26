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
| Issue #6 closed: Provider service-start lifecycle (`confirmed → on_the_way → arrived → arrival_confirmed → in_progress`), clean console/network assertion, zero QA residue — independently re-run and verified by Codex against real QA, not self-reported | PR #7, Issue #6 closed 2026-08-24 |

### OPEN — tracked, in progress

| Item | Status | Blocking on |
|---|---|---|
| Rotate the leaked QA service-role key (`qa/report/results.json`, pre-PR #16) | Not yet done — Supabase dashboard action only Safeyeldin can take. | Safeyeldin |
| Four repository-wide high-severity dependency advisories (surfaced by `npm ci` during Codex's Issue #6 review, 2026-08-24) | Not yet triaged — unrelated to any recent PR, pre-existing. | Needs a dedicated `npm audit` review, not yet scheduled |

### PARKED

None currently.

### Milestone 1 audit results (2026-08-23)

| Item | Verdict | Evidence |
|---|---|---|
| Ratings / reviews | **DONE — E2E gap closed** | `reviews` + `ratings_summary` tables (`20260627001502_...sql`); `useProviderReviews`/`useBookingReview`/`useSubmitReview` in `src/lib/db/queries.ts:836-882`; customer star+comment UI in `src/routes/booking.$id.tsx:259-320`; provider-facing display in `src/routes/provider.$id.tsx:88,99,168-172`. E2E gap noted here 2026-08-23 was closed the same day by PR #19 — see Confirmed DONE above. |
| Payment-proof capture → admin verification | **DONE — E2E gap closed** | Shared `src/components/famio/PaymentBlock.tsx` (customer upload UI, 10MB validation, awaiting-review state); `useUploadPaymentProof` in `src/lib/db/payment-queries.ts:108-125` uploads to `payment-proofs` bucket + updates `payments.proof_path`; RLS correctly scoped (`payments_customer_insert`, `payments_customer_update_proof` — locked after review). E2E gap noted here 2026-08-23 was closed the same day by PR #20 (incl. RLS negative-path) — see Confirmed DONE above. |
| Provider payouts | **DECIDED — manual/outside-app** | Safeyeldin decided 2026-08-24: no in-app payout tracking/issuance for beta. `pro.earnings.tsx`'s "Recent Payouts" label was genuinely misleading (it lists completed bookings, not payout records) — fixed to "Recent completed jobs" (`recentPayouts` i18n key, both `en.ts`/`ar.ts`). |
| Production deployment readiness | **DRAFT runbook exists, one open item left** | `docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md` (PR #41). Safeyeldin confirmed 2026-08-24: PITR/backups are enabled on Production (resolves the rollback-mechanism question). Still open: the actual migration-apply process — Safeyeldin needs to check and confirm before this is final. |

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

**Round 2 (Cursor revision) + round 3 (Codex re-audit), 2026-08-23/24:**
catalog fingerprints (18 keep / 461 delete services, 416 zones, 40
service_requirements, 352 booking_locations) independently re-confirmed
exactly. Storage: 98 objects across 4 buckets, 0 need preserving (all
QA-marked). Two BLOCKER items remained, both narrow and mechanical, not
new scope surprises:

1. **Closure list was internally inconsistent** — proposal's header said 42
   tables, the appendix actually listed 53, and the real transitive
   TRUNCATE-CASCADE closure is 51. Three tables (`services`,
   `service_requirements`, `promo_code_services`) were miscategorized as
   Phase A (truncate) closure when they're actually Phase B (targeted
   service delete) territory. `user_roles` was missing from the appendix
   entirely.
2. **Audit/auth ordering could still fail** — Phase B's service deletes
   fire `trg_audit_services`, writing new `audit_logs` rows with
   `actor_id → auth.users`. Phase C then deletes `auth.users` while that FK
   is still `NO ACTION` — audit_logs must be cleared *between* Phase B and
   Phase C, not just moved to the very end as round 1's fix attempted.

Both are fix-and-verify, not new investigation — Codex's own assessment:
"After those corrections, the plan is suitable to proceed to a fingerprinted
QA-clone dry-run." Sent back to Cursor for what should be the final Stage 1
revision, with an added instruction to derive the TRUNCATE closure
*programmatically* from the live FK graph rather than hand-enumerated (the
42/53/51 mismatch is exactly the class of error manual tracking produces).

**Round 4, 2026-08-24 — actual tool code now exists, still dry-run only.**
Both BLOCKERs fixed: the closure is now derived by a programmatic FK-graph
walk (51 tables, header/appendix/actual counts all match), and `audit_logs`
is cleared both between the service-delete phase and the auth-delete phase
*and* again as a final safety-net pass. A real (not-yet-executable) tool
exists at `tools/production-reset/` — deliberately outside `qa/` since that
tree is QA-project-guarded by design; this one guards the opposite
direction (refuses to run against anything but the Production ref). Ran its
dry-run path once against live Production: exit 0, no mutation,
`plan_fingerprint` computed, `blocked: false`. `execute.mjs` exists but
throws "not implemented" — no execute path currently reachable at all.

**One gap flagged by Cursor itself, not yet closed:** the FK closure was
derived from migration *files*, not live `pg_constraint` — the same IPv6
access block that's affected every round's attempt to query Postgres
system catalogs directly. For something this destructive, "the files match
what's actually deployed" needs confirming, not assumed. Folding this into
the same Dashboard SQL check already pending from Safeyeldin (trigger
state) — one more query added, still a single ask, not blocking anything
else. Sent to Codex next for a full code audit of the tool itself (not just
another numbers re-derivation) before Stage 2 (QA-clone dry-run of the
execute path) is discussed.

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

**Added 2026-08-24** — same trip to the Dashboard SQL editor, one more
read-only query: confirm the Production reset tool's FK closure (derived
from migration files, since local tooling can't reach `pg_constraint`
directly) actually matches live schema state:

```sql
SELECT
  tc.table_name AS referencing_table,
  kcu.column_name AS referencing_column,
  ccu.table_name AS referenced_table,
  rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
JOIN information_schema.referential_constraints rc
  ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
ORDER BY referencing_table;
```

Paste the result back and I'll have Cursor/Codex diff it against the tool's
derived 51-table closure — this one also isn't blocking anything else in
the meantime.

No mutation has been performed at any point in this investigation. Any
actual reset/cleanup still needs a purpose-built, reviewed, fingerprinted
plan — explicitly not a reuse of `qa/` tooling — with your specific
sign-off, the same discipline as the QA zone deactivation but at a
materially higher bar given this is real Production and the exact scope is
now confirmed uncertain, not just unconfirmed.

**Round 5 (Codex full code audit), 2026-08-24 — PR #27 not safe to merge
yet; three new BLOCKERs found in the tool code itself, not the numbers.**
This was the first line-by-line code audit of `tools/production-reset/`
(vs. earlier rounds' numbers re-derivation). Mutation-path review passed
cleanly — no `.delete()`/`.update()`/`.insert()`/`.upsert()`/storage
`.remove()`/destructive SQL exists anywhere reachable; `execute.mjs`
unconditionally throws and no flag combination routes around it. But three
flaws make the tool's safety *proof* invalid even though today's output
happens to be correct:

1. **FK-graph source isn't bound to the same project as the row counts.**
   The tool verifies the Production ref for its REST/count queries, but
   separately shells out to `npx supabase db query --linked` for the FK
   graph without checking which project the CLI is linked to. Right now
   that link points at QA, the query fails, and the tool silently falls
   back to parsing migration files — so today's 51-table closure is fine.
   But if that CLI link ever succeeds while still pointed at QA, the tool
   would combine a QA FK catalog with Production row counts and IDs without
   any error.
2. **Catalog classification fails open, not closed.** The planner only
   blocks if a KEEP (seed) table shows up inside the delete closure. It
   never checks that exactly 18 seed services exist, that every non-seed
   service actually carries a QA marker, or that the zone count matches the
   QA-shaped count — it just targets "everything non-seed" and "every zone"
   unconditionally. Today's Production data happens to satisfy 18/461/416
   exactly, so it reports `blocked: false` correctly by accident, not by
   the check actually working. Future catalog drift (a real zone added
   without a QA marker, e.g.) would still report `blocked: false`.
3. **The fingerprint doesn't bind every destructive target.** It covers the
   closure table list, plan version, and service/zone *ID-set* fingerprints
   — but not the Production project identity, the Phase A root list, exact
   auth-user IDs (only their count), exact storage object keys (only their
   count), or the FK edges/graph source itself. An auth user or storage
   object could be swapped for a different one without changing the
   fingerprint.

Also flagged, not blocking: no unit tests exist for any of this tool's
safety-critical logic (BFS closure, argument matrix, blocking predicates,
fingerprint sensitivity) — HIGH; the migration-file FK fallback has no
validation against an expected edge/closure list, so silent parser gaps
could under-count the closure — HIGH; auth-user pagination silently caps at
4,000 rather than erroring if exceeded, and the report sanitizer is
currently a no-op allowlist — both MEDIUM; local report overwrites aren't
atomic — LOW.

**PR #27 stays Draft, unmerged**, per Codex's explicit recommendation and
already-correct prior practice. Sent back to Cursor for a fifth revision
addressing all three BLOCKERs plus the two HIGH findings before Codex does
one more focused (not full) verification pass. Stage 2 (QA-clone dry-run of
an execute path) is still not on the table until that lands clean.

**Round 5 fix (Cursor, commit `d66cbb1`) + round 5 Codex focused
verification, 2026-08-24 — four of five findings closed, one BLOCKER
remains.** Codex traced each new guard line-by-line and re-ran the live
Production dry-run plus the 21-test suite itself rather than trusting
Cursor's report:

- **Closed:** catalog classification now fails closed (synthetic checks:
  19 "seed" services blocks, a missing required FK edge throws, Phase B
  catalog leakage throws); migration-fallback graph validation now throws
  on an incomplete parse instead of silently trusting it; FK-graph source
  is bound to the verified Production ref on the real CLI path (Codex flags
  a MEDIUM-only theoretical gap: the ref is checked once before the query
  runs, not re-checked after, and the ref/loader are injectable in code —
  neither is reachable through the actual CLI, so not blocking).
- **Still open — BLOCKER:** the new fingerprint hashes the exact auth-user
  ID set and storage key set correctly, but does **not** bind Production's
  per-table row counts. Codex proved this directly: changing `bookings`'
  count to a synthetic 999 produced an unchanged fingerprint. Practically,
  a new row landing in any Phase A table between plan approval and a future
  execute run would still get swept by `TRUNCATE … CASCADE` under a
  fingerprint that never noticed the drift — the exact class of gap the
  fingerprint exists to catch.
- **MEDIUM, not blocking:** one of the 21 tests (`"uses pg_constraint when
  linked ref is Production"`) doesn't actually call the function it's named
  for, and the required-edge/catalog-leak exception branches are proven by
  ad hoc synthetic probes rather than durable regression tests.

**PR #27 stays Draft, unmerged.** Sent back to Cursor for a narrow sixth
round: bind the full deterministic row-count map into the fingerprint, add
a regression test proving any relevant count change moves the fingerprint,
and fix the two MEDIUM test-coverage gaps noted above. One more focused
Codex pass after that, still before Stage 2 is discussed.

**Round 6 fix (Cursor, commit `500b6fb`) + round 6 Codex verification,
2026-08-24 — closer, but the row-count binding itself has a gap.** Codex
confirmed the two MEDIUM test fixes and the fingerprint mechanism are both
genuinely correct this time (stable table-name-sorted ordering verified by
a differently-ordered-input probe, no caching/double-count bug, the
`bookings` 1→999 regression test is real, the pg_constraint test now
actually calls `loadPublicFkEdges()`, the required-edge/Phase-B-leak tests
invoke the real validators). But the row-count map itself is incomplete:
it covers 49 of the 51 Phase A closure tables. `zones` is fine (already
bound separately via its own ID-set fingerprint), but **`zone_services` is
bound nowhere** — neither its row count nor its row IDs are in the
fingerprint. A new row in `zone_services` could still be swept by
`TRUNCATE … CASCADE` under an unchanged, already-approved fingerprint —
the same class of gap as round 5's finding, just narrower now (1 table
instead of all of them).

**PR #27 stays Draft, unmerged.** Sent back to Cursor for a narrow seventh
round: derive the fingerprinted row-count table set directly from the
actual Phase A closure (so it's structurally impossible to miss a table
again), add a test asserting the row-count key set exactly equals the
closure set, and a regression proving a `zone_services` count change moves
the fingerprint. One more closing Codex pass after that.

**Round 7 fix (Cursor, commit `f0f6751`) + round 7 Codex closing
verification, 2026-08-24 — Stage 1 is complete. All BLOCKER/HIGH findings
from all seven rounds are closed.** The fix was structural, not additive:
`USER_ROW_TABLES` (the hand-maintained list that had drifted twice now —
first the 42/53/51 closure mismatch, then the missing `zone_services`) is
gone entirely. The row-count map is now derived directly from the same
computed Phase A closure the planner already uses, with a runtime
assertion (`assertTableCountsKeysMatchPhaseAClosure()`) that throws if the
two ever diverge again — this class of bug is now structurally prevented,
not just patched. Codex independently confirmed: the assertion runs and
throws on both the live and snapshot code paths; `zones` is excluded only
from the human-readable row-count *sum* (to avoid double-counting against
its separate ID-set fingerprint) but its count is still fingerprinted;
the fingerprint's 51-table map is complete on both paths. Codex also
independently verified the `zone_services = 0` figure is a genuine
Production fact, not a query bug — checked the migration's actual column
names, ran an independent exact-count query (0, no error) and a
known-column probe (0 rows, no schema error), and confirmed the planner's
own counter throws on query errors rather than silently defaulting to
zero.

**Final tally across all seven rounds:** row-count/service/zone catalog
fingerprints (18 keep / 461 delete services, 416 zones, 40
service_requirements) — solid since round 2. Audit/auth deletion ordering,
programmatic FK-closure derivation (51 tables), fail-closed catalog
classification, migration-fallback validation, FK-graph Production-ref
binding, and now a fully-bound, structurally-verified plan fingerprint —
all independently Codex-confirmed, not self-reported. One narrow MEDIUM
remains on record and is explicitly not blocking (a local, CLI-unreachable
TOCTOU-style gap in the linked-ref check) — per `AGENTS.md`, MEDIUM
findings don't force another round on their own.

**PR #27 is ready to come out of Draft and merge as dry-run-only tooling**
— merging still does not create or enable any execute path;
`execute.mjs` is byte-identical to round 5 and still unconditionally
throws. Per `AGENTS.md`'s merge-authority rule, this PR touches `tools/`,
so it stays gated behind Safeyeldin's explicit approval regardless of
audit outcome — Claude is not merging it autonomously. **Stage 2**
(implementing an actual execute path, validated against a QA clone) is a
separate phase requiring its own review, fingerprint gates, and explicit
approval before any mutation — not yet started.

**Update 2026-08-24 — PR #27 approved and merged by Safeyeldin.** The
Stage 1 dry-run tool is now on `main`. It still has no execute capability
of any kind.

**Stage 2 kicked off, 2026-08-24 (Safeyeldin: "you decide the best way"),
scoped narrowly.** Sent to Cursor on a fresh branch
(`feat/production-reset-execute-path`) to design and write the real
execute path, but with the exact same discipline as every Stage 1 round —
this task is still simulation-only, nothing may actually mutate, and
Production remains completely out of reach:

- `execute.mjs` gets a real implementation, gated behind the CLI's
  existing `--execute`/confirm-phrase/`--plan-fingerprint` args, plus a
  new internal gate: it must independently recompute the plan and
  fingerprint at execute time and abort on any mismatch, rather than
  trusting a fingerprint handed in from an earlier run — this closes the
  "approved plan, but Production drifted before someone actually ran
  execute" gap in principle, the live-execution analog of everything
  Stage 1's seven rounds hardened on the read side.
- A hard `--target=qa-clone` / `--target=production` gate is required, with
  `--target=production` unconditionally rejected in this task — Production
  execute capability does not exist yet, not even behind a flag.
- The only mode allowed to actually run in this task is simulation (e.g.
  transaction-rollback or explain-only) against a QA-clone connection,
  verified to genuinely leave data unchanged, not committed to real Stage 1
  discipline: full audit before anything beyond simulation is discussed.

This is real execute-path code being written for the first time in this
project, so it goes to Codex for a **full code audit** (the same rigor as
Stage 1's first full-audit round, not incremental focused passes) once
Cursor reports back. Any actual QA-clone mutation — let alone Production —
still requires a separate, explicit approval from Safeyeldin after that
audit, per `AGENTS.md`'s destructive-QA-execution rule.

**Stage 2 round 1 (Cursor, commit `9eb4167`) + full Codex code audit,
2026-08-24 — two BLOCKERs, one HIGH found; this is real code, not just
documentation, so it went through the same scrutiny as Stage 1's first
audit round.** Claude independently read the diff before sending it to
Codex (a first for this project — the stakes of writing actual execute
logic warranted it) and found two of the issues Codex later confirmed.
Mutation-path review passed: no Supabase `.delete()`/`.update()`/
`.insert()`/`.upsert()`/`.admin.deleteUser()`/storage `.remove()` call
exists anywhere in the new code — the only destructive operations are
Phase A/B2/D `TRUNCATE` strings, and those only run inside a
`BEGIN…ROLLBACK` wrapper. Codex independently confirmed the Supabase CLI
(v2.109.1) runs a full SQL string as one call in one database session
rather than splitting on semicolons, which is what makes the
rollback-wrapper design sound in principle. But three real gaps remain:

1. **BLOCKER — the SQL database URL isn't proven to belong to the same
   project as the verified QA-clone REST URL.** The REST URL's project ref
   is checked against Production; the separately-loaded database URL is
   not cross-checked against anything. Codex's exact finding: a legitimate
   QA REST URL paired with a **Production** database URL would pass every
   existing guard and route the TRUNCATE transactions at Production — a
   genuine Production-risk path that exists independently of the
   `--target=production` flag rejection.
2. **BLOCKER — `rollback_verified=true` can print without real
   verification.** The before/after row-count check only runs if the
   caller supplies `captureCounts`/`verifyCounts`; the real CLI entry point
   never does. The code still reports rollback as verified whenever the
   SQL didn't throw, regardless of whether data was actually confirmed
   unchanged. Claude flagged this exact gap before sending to Codex, who
   traced the false-positive path through `execute-phases.mjs` and
   `execute.mjs` to confirm it's real. This matters because a future
   approval decision could be based on evidence that only *looks* like a
   confirmed rollback.
3. **HIGH — Phase E's storage-object simulation misses everything not at a
   bucket root.** It doesn't recurse into folders, so a live QA-clone check
   found it would report 0 objects where the real (recursive) Stage 1
   inventory correctly finds 48.

Two MEDIUMs also flagged: the new auth-pagination code duplicates
`plan.mjs`'s logic without carrying over the round-6 fail-closed fix (the
same class of "duplicated instead of shared" bug as Stage 1's
`zone_services` miss), and the SQL shell-command construction uses
JSON-quoting inside a shell string rather than argument-safe process
spawning.

**PR #36 stays Draft, unmerged.** Sent back to Cursor for a fix round
covering both BLOCKERs, the HIGH, and both MEDIUMs — with instructions to
reuse Stage 1's existing recursive storage inventory and fail-closed auth
pagination rather than re-deriving them, the same lesson as every
duplicated-logic bug so far in this project. One more focused Codex pass
after that. An isolated-Postgres live rollback verification, and any
actual QA-clone mutation, remain separate, later, explicitly-approved
steps — not implied by anything in this round.

**Stage 2 round 2 (Cursor, commit `e011daa`) + Codex focused re-audit,
2026-08-24 — 4 of 5 findings closed, but the database-identity BLOCKER is
still open in a more dangerous form, plus one new HIGH regression.** Claude
independently traced all five fixes before sending to Codex and found them
structurally sound; the audit caught what a structural read alone
couldn't:

- **Genuinely closed:** false `rollback_verified` reporting (real CLI path
  now always wires row-count capture/verification when a database URL is
  present, and requires all three SQL phases to verify — not just one);
  Phase E storage undercounting (now reuses Stage 1's recursive inventory,
  confirmed 48/48 against a live QA-clone check); the duplicated
  auth-pagination logic (now reuses `plan.mjs`'s fail-closed function
  directly).
- **BLOCKER, still open — now a bypass, not just a gap.** The fix scans
  the **entire raw URL string** for a ref-shaped pattern instead of
  parsing structurally. Codex proved this is exploitable: a Production
  database URL with a QA-shaped string placed in the **password** field
  gets matched as QA — the exact "Production URL slips past the QA-clone
  check" risk this was supposed to close is still open, just less likely
  to trigger by accident. Needs structural URL parsing (hostname/username
  only, never password/path/query), not smarter regexes.
- **New HIGH — the shell-injection fix broke Windows.** Swapping to
  `execFileSync("npx.cmd", ...)` (an argument array, correctly closing the
  injection MEDIUM) fails with `EINVAL` on the actual Windows dev
  environment this project runs in. The fix must be both injection-safe
  and Windows-functional — Codex flagged the historical Node.js
  `cmd.exe`-quoting footgun (CVE-2024-27980) as a reason not to solve this
  by just adding `shell: true` back naively.
- **MEDIUM, non-blocking:** `computeRollbackVerified()` checks "3 phases,
  all verified" rather than "A, B2, D each present exactly once" — not
  currently exploitable (protected upstream by the phase-order assertion)
  but worth tightening for defense in depth.

**PR #36 stays Draft, unmerged.** Sent back to Cursor for round 3: fix the
URL parsing structurally with regression tests proving a ref-shaped string
in the password/path/query can't be misread as the real ref, find a
Windows-safe *and* injection-safe way to invoke the Supabase CLI (resolving
the binary directly rather than through `npx` is the preferred fix), and
tighten the phase-identity check. One more focused Codex pass after that.

**Stage 2 round 3 (Cursor, commit `7f1b183`) + Codex focused re-audit,
2026-08-24 — the security-relevant findings are done; one process/CI issue
left.** Codex independently re-tried the exact crafted-URL bypass from last
round (ref-shaped string in password, path, and query, plus a
conflicting-hostname/username case) and confirmed the new structural
`new URL()`-based parser rejects all of them correctly. The Windows spawn
fix was verified with a real (not mocked) invocation. The phase-membership
check correctly rejects missing and duplicate phases now. **All three
prior findings — the BLOCKER, the HIGH, and the MEDIUM — are genuinely
closed**, and Codex states no BLOCKER remains in the code itself.

Two smaller things surfaced this round, one from each side:

- Claude independently found (before sending to Codex) that the Windows
  fix's `cross-spawn` import isn't declared in `package.json` — it only
  works today because ESLint happens to pull it in transitively. Codex
  confirmed this (MEDIUM) and recommends declaring it directly.
- Codex found a new HIGH the fix itself introduced: the new
  Windows-verification test makes a real network call to a bogus host,
  which passes alone but times out under Vitest's 5-second limit when run
  in the full parallel suite — reproduced failing twice locally and in
  required GitHub CI (539/540).

Neither is a data-safety issue — both are process/test-hygiene. **PR #36
stays Draft, unmerged.** Sent back to Cursor for a small round 4: drop the
network-calling test from the automated suite (keep the manual
verification as evidence, not as a CI gate) and declare `cross-spawn` as a
real dependency. Expected to be the closing round — Codex has already
cleared everything security-relevant.

**Stage 2 round 4 (Cursor, commits `5b8b199`/`de28107`) + Codex closing
audit, 2026-08-24 — clean pass. All BLOCKER/HIGH/MEDIUM findings across
all four Stage 2 rounds are closed.** The network test was replaced with a
mocked `cross-spawn` assertion (no real process/network I/O), and
`cross-spawn` is now a declared `dependencies` entry. Fixing the
dependency triggered an `npm install` that dropped 69 lines from
`package-lock.json` (nested `nitro`/`lru-cache@11.5.2` entries) — a second
commit repaired it. Both Claude and Codex independently checked this
repair rather than trusting the "fixed" claim: Claude confirmed valid JSON
plus the expected entries were present; Codex went further and diffed the
repaired lockfile against round 3's known-good version, confirming it's
byte-for-byte identical plus exactly one new `cross-spawn` line — no
unrelated version or integrity-hash drift — and ran `npm ci` (not just
`npm install`) to prove it's genuinely installable. GitHub CI's required
check was independently confirmed green by fetching the actual workflow
run via the API, not by trusting the pasted link.

Codex's closing sweep re-checked every finding from all four rounds
together, not just round 4's two items: crafted-URL rejection, fail-closed
identity checks, the Production/non-simulate gates, execute-time
fingerprint recomputation, exact-membership rollback verification,
recursive storage inventory, fail-closed auth pagination, and the
mutation-path finding (still zero destructive Supabase calls, all SQL
still routed through `BEGIN…ROLLBACK`) — all confirmed intact together, not
just individually. **No new findings. No BLOCKER/HIGH/MEDIUM remains.**

**PR #36 is audit-cleared to merge as dry-run-and-simulate-only tooling.**
Per `AGENTS.md`'s merge-authority rule this PR touches `tools/`, so it
still requires Safeyeldin's explicit approval regardless of the clean
audit — merging still does not enable a database-connected simulation or
any Production execution. The isolated live-Postgres rollback verification
and any actual QA-clone mutation remain separate, later, explicitly-gated
steps.

---

## Milestones

Each milestone follows the standard `AGENTS.md` workflow (Orient → Plan →
Implement → Local verification → Independent review → Focused QA → Merge
decision) per item, not as one giant batch. Ship milestones in order —
resist parallelizing across milestones, it's how scope drift happens.

### Milestone 0 — Close what's already in flight
*Exit criteria met 2026-08-24: Issue #6 was resumed, its PR merged, and the Issue closed.*

1. ~~Land the corrected clean full-E2E run (58/58) + residue-zero + protected-catalog evidence on Issue #12; close it.~~ **Done 2026-08-23**, independently re-verified.
2. Rotate the leaked QA service-role key (your action) and decide on the old `qa/report/results.json` (recommend: delete, now that PR #16 prevents recurrence). **Still open.**
3. ~~Triage `admin-remaining-mutations` activate-persistence failure~~ **Done** — passed cleanly on the corrected re-run, classified as contamination/flake, no new Issue needed.
4. ~~Decision from you: resume Issue #6 now, or keep it parked~~ **Done 2026-08-24** — resumed, PR #7 merged, Issue #6 closed. See Milestone 2 item 4.

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
3. ~~**Provider payouts**~~ **Decided and shipped 2026-08-24 (Safeyeldin): manual/outside-app for now** — matches Cursor's and Claude's independent recommendation for a closed beta. The "Recent Payouts" → "Recent completed jobs" mislabel fix (`recentPayouts` key in `src/lib/i18n/locales/en.ts` + `ar.ts`, PR #43) is merged. No `payouts` table or admin issuance UI needed for beta; revisit only if a future decision reverses this.
4. ~~Provider service-start lifecycle (Issue #6)~~ **Done 2026-08-24** — resumed per Safeyeldin's decision, PR #7 rebased cleanly onto `main` (net diff: one file), original console-error blocker fixed via `networkidle` wait, independently re-verified against real QA by Codex (clean residue before/after, 1/1 pass, zero console/network errors, zero findings across all severity tiers), merged, Issue #6 closed.

**Milestone 2 exit criteria met 2026-08-24** — all four items above are done.

### Milestone 3 — Production readiness
*Exit criteria: a reviewed, written Production deployment runbook (env vars, migration application order, rollback plan) exists alongside the QA one; a monitoring/alerting minimum (errors, failed payments, failed notifications) is wired up; one full dry-run of "deploy this exact `main` to Production" is reviewed and approved by you before it's ever executed for real; **and the Production data hygiene finding below is reconciled and remediated.**

**Runbook update, 2026-08-24 (Safeyeldin's answers):** Production PITR/backups **are enabled** — this resolves the runbook's biggest open question; a real point-in-time rollback mechanism exists, it just isn't written down as a procedure yet (retention window still needs confirming for the runbook to state it precisely). The Production migration-apply process is **still unconfirmed** — Safeyeldin wasn't sure and needs to check; this remains the one open item blocking the runbook's migration section from being final. See `docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md` (PR #41, awaiting review) for the full draft.

**Confirmed 2026-08-23:** schema is fully in sync with `main` — no migration gap. **Not fine:** ~60% of Production auth users carry the QA-fixture email signature, historical (stopped ~Aug 2) but never cleaned up. See "CRITICAL — Production data hygiene" below. This blocks Milestone 4, not Milestone 3's other items — the runbook and monitoring work can proceed in parallel.

**Monitoring/alerting minimum kicked off, 2026-08-24.** Investigated first:
failed payments and failed/dead notifications are already technically
queryable (`admin.payments.tsx`'s status filter, `notification_outbox`'s
status column) but nothing surfaces them proactively, and **application
errors have zero tracking today** — no error table, no client/server
capture, nothing. Sent to Cursor scoped deliberately to avoid a new
third-party service (that would be a cost/product decision needing
Safeyeldin's approval, not necessary for a beta-minimum bar): a new
`error_logs` table (QA-only for now, same as any other migration), a
top-level error boundary + server-side capture logging to it, and one
admin page surfacing recent errors + failed-payment count + failed/dead
notification count. Explicitly out of scope for this round: any actual
alerting/paging (who gets notified and how is a real product decision,
saved as a follow-up ask). Draft PR expected, then Codex review, same as
every other code change.

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
