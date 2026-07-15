// Standalone cleanup: removes all QA_ accounts/records tracked in the
// registry. Use after a KEEP_QA_DATA=1 debugging run.
import { runTeardown } from "./teardown-core.mjs";

await runTeardown();
