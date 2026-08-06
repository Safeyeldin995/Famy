/**
 * Vitest unit-test setup (vitest.config.ts only).
 * Prevents guard-backed QA code from silently reading the repository .env.qa.local.
 */
process.env.VITEST_QA_UNIT_GUARD = "1";
