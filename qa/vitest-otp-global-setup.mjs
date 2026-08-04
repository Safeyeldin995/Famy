import { loadQaEnv } from "./load-qa-env.mjs";
import { runPreflightChecks } from "./env-guard.mjs";

export default async function setup() {
  loadQaEnv({ required: true });
  runPreflightChecks(process.env);
}
