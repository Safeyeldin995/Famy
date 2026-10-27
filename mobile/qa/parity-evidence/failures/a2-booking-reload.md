# A2 final authorized browser run — failure

- Date: 2026-10-27; branch `codex/mobile-web-parity-4`, base `ee2b120`.
- Sequential run: customer suite completed (30 captures), then booking suite exited 1.
- Exact failure: `page.reload: Page crashed`.
- Step: package booking, transfer receipt upload succeeded; signed proof was opened; synthetic `paymentRows[0].proof_path` was cleared; reload crashed before PDF upload validation.
- Stack: `run (.../mobile/qa/phase2a-web.cjs:663:18)` in the in-memory adapted fixture.
- Crash screenshot: unavailable because the page crashed. [Last successful receipt frame](a2-before-reload-crash.png).
- No rerun after this failure. No remote data, real receipt or payment was involved. Cause is not established; classified as browser/infrastructure failure, not a passing product gate.
- PDF and later tutoring scenario checks remain unverified in this run.
