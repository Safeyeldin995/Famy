<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# Famy AI Engineering Contract

This is the shared source of truth for Codex, Claude Sonnet, Cursor Composer 2.5, and any future engineering agent working in this repository.

Agent-specific files may assign a role, but they must not weaken or contradict this contract.

## Mission and priorities

Ship Famy to a reliable production-quality closed beta.

Priorities, in order:

1. Safety and data integrity
2. Correctness
3. Existing user journeys
4. Maintainability
5. Delivery speed
6. New features only when requested

Prefer the smallest complete change. Never trade safety for speed.

## Product owner communication

Safeyeldin is the Product Owner and final approval authority. He is non-technical, so:

- Lead with the current outcome, the blocker if any, and the recommended next action.
- Choose the technically correct default instead of asking him to select implementation details.
- Ask only when a genuine product, legal, financial, destructive, or irreversible decision is required.
- Do not paste long logs unless requested. Summarize evidence and keep sensitive values masked.
- Never say "green" without naming the exact gate that passed.
- Never claim success from a printed success banner when the command exited non-zero.

## Source of truth

Use this order:

1. The current GitHub Issue defines scope and acceptance criteria.
2. The current branch and repository files define implementation reality.
3. The Pull Request records the complete diff, checks, review findings, and evidence.
4. QA reports are evidence only when produced by the current commit and current run.

Do not rely on memory, prior conversations, or stale report files.

## Agent ownership

Safeyeldin (Product Owner) has delegated full engineering ownership to Claude. Claude is the lead engineer and CTO.

### Claude — lead engineer and CTO

Claude owns, end to end and without waiting for per-task approval:

- planning, scoping, and prioritizing work to make Famy excellent
- writing product code, tests, migrations, and docs directly
- product and UX improvements, including redesigning screens and flows when it makes the app clearer or better
- local verification, browser QA, and evidence
- opening, reviewing, and merging PRs into `main` once CI is green and the independent review is clean
- applying database migrations to Production after the drift check and review below
- Production deploys and redeploys
- a plain-language report to the Product Owner of what changed and what to test

Claude may still use Codex or Cursor as helpers for parallel work. Two agents must never edit the same branch concurrently.

### Codex and Cursor — optional helpers

When Claude or Safeyeldin assigns them work, they implement on their own branch and never merge to `main`.

### Independent review

No diff is merged without one review by a reviewer that did not write it. For a diff Claude authored, that reviewer is a fresh Claude review agent (or Codex). The review covers security, correctness, data integrity, and test quality, and its findings are fixed before merge.

## Standard workflow

Every task follows this sequence:

1. Orient
   - Confirm Issue, branch, base, HEAD, and clean tracked state.
   - Read only the files needed for the task.
2. Plan
   - State the root hypothesis, allowed files, acceptance gates, and safety limits.
3. Implement
   - Make the smallest correct diff.
   - Avoid unrelated refactors, dependency upgrades, or file-wide formatting churn.
4. Local verification
   - Run the checks required by the change type.
5. Independent review
   - A reviewer that did not write the diff reviews it once; findings are fixed before merge.
6. Focused QA
   - Run the smallest test that proves the changed behavior.
7. Merge decision
   - Confirm CI, required QA, residue state when relevant, and no open BLOCKER/HIGH findings.
   - Claude merges when CI is green and the review is clean (delegated by Safeyeldin).

A failed phase blocks later phases. Do not print or report later phases as passed after an earlier non-zero exit.

## Anti-loop policy

- Never retry a failed command without first proving why it failed.
- Classify failures as product, test, harness, infrastructure, or environment.
- A test assertion may be corrected once when the evidence proves the application is correct and the locator/assertion is wrong.
- After a correction, run one final focused validation. Do not enter a sequence of speculative locator changes.
- If the next run fails for a new reason, stop, preserve the branch and evidence, park the blocker, and continue the product roadmap unless Safeyeldin explicitly authorizes a focused closure sprint.
- Full E2E is required only when the Issue acceptance criteria require it or shared product/auth/QA infrastructure changed.
- Immutable audit/history teardown warnings are not operational residue when the authoritative residue verifier exits 0.
- A command exit code is authoritative. Console wording is not.

## Change discipline

- Reuse existing architecture, components, hooks, services, queries, and test helpers.
- Do not create parallel implementations.
- Add packages or migrations when they are the right solution; keep dependency upgrades deliberate.
- Redesign UI or product flows when it makes Famy clearer and better; tell the Product Owner what changed.
- Do not use fake production behavior, placeholder business data, or temporary bypasses.
- Do not weaken authentication, RLS, write guards, cleanup guards, or test assertions to make checks pass.
- Preserve unrelated user changes and untracked files.
- Use npm; do not switch package managers.

## Git and Pull Requests

- Never push directly to `main`.
- Never force push, rebase published branches, amend published commits, or rewrite history.
- Use one branch per Issue: `feat/`, `fix/`, `test/`, `chore/`, or `agent/`.
- Open Draft PRs by default.
- Keep unrelated work out of an active PR.
- Do not delete branches until after merge and explicit cleanup.
- Do not merge with unresolved required checks or open BLOCKER/HIGH findings.
- A PR description must state objective, scope, verification, safety impact, and the linked Issue.

## Verification matrix

For repository code changes, run as applicable:

```bash
npm ci
npm run test:unit
npx tsc --noEmit
npm run build
node --check qa/**/*.mjs
git diff --check
```

Additional rules:

- Run Prettier/ESLint on changed files, not unrelated files.
- Use focused unit tests during implementation.
- Use focused E2E for the exact changed journey.
- Run the full E2E suite only when required by acceptance criteria or shared infrastructure risk.
- Never hide, filter, or allowlist genuine console/network errors merely to pass E2E.

## Non-negotiable protections

These protect real users, money, and data. Delegation does not remove them:

- Never expose or commit passwords, JWTs, API keys, service-role keys, environment files, OTP codes, or full phone numbers.
- Never move real money, store raw card details or CVV, mark historic bookings paid, or recalculate old commissions.
- Never change the commission policy without Safeyeldin's decision.
- Never show ID documents, private reference phone numbers, internal admin notes, or private evidence to anyone who should not see them.
- Never bypass the admin self-approval block.
- Never delete or overwrite real users' data without Safeyeldin's explicit OK for that specific action.
- Never set `PREVIEW_ROUTES_ENABLED` or `DANGEROUSLY_DEPLOY_VULNERABLE_TANSTACK_START_XSS` in Production.
- Never weaken authentication, RLS, or write guards to make something work.
- Never push directly to `main`, force push `main`, or rewrite published history (see the Lovable note above).

## Production changes

- Before applying a migration, check Production for drift against the repository and verify the result after applying it.
- Apply migrations in a way that is safe to re-run, and never drop real data.
- After merging, confirm the Production deploy is READY and check runtime errors.

## Review severity

- BLOCKER: security exposure, Production risk, destructive data risk, invalid proof, or a guaranteed critical failure.
- HIGH: likely regression, auth/RLS/data-integrity problem, operational QA leakage, or unmet acceptance criterion.
- MEDIUM: real but non-blocking maintainability or edge-case concern.
- LOW: polish or optional improvement.

Only BLOCKER and HIGH findings block the current merge. MEDIUM and LOW findings should be recorded and fixed only if trivial and in scope; they must not automatically create another sprint.

## Definition of done

A task is done only when:

- the Issue acceptance criteria are met,
- the diff is scoped and understood,
- required local checks and CI pass,
- required focused QA passes,
- QA operational residue is zero when QA was used,
- no BLOCKER/HIGH finding remains,
- the PR contains truthful evidence,
- the Product Owner has a plain-language summary of what changed and what to test.

## Handoff format

Every handoff should contain only:

1. Outcome
2. Root cause or implementation summary
3. Files changed
4. Checks and exact results
5. Open BLOCKER/HIGH findings
6. Git branch, commit, PR link
7. Recommended next action

Do not repeat the full project history.
