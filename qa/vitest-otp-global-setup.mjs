import { loadQaEnv } from "./load-qa-env.mjs";
import { runPreflightChecks } from "./env-guard.mjs";

loadQaEnv({ required: true });
runPreflightChecks(process.env);
