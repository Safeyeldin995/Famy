# Maestro — release gate flows

**CI (every PR):** only validates YAML via `node qa/check-maestro-flows.mjs` in the main CI workflow.

**Emulator runs are manual-only** — GitHub Actions workflow `Mobile Maestro (manual emulator)` (`workflow_dispatch`). They are not run on every PR because they need:

- Android emulator API 34+
- APK from `eas build` (preview or release-gate profile)
- `MAESTRO_TEST_PHONE` / `MAESTRO_TEST_OTP` from the QA Supabase branch (never Production)

```bash
cd mobile
maestro test maestro/flows/01-customer-sign-in.yaml
```

See [docs/store/staged-rollout.md](../../docs/store/staged-rollout.md) and [docs/qa/release-checklist.md](../../docs/qa/release-checklist.md).