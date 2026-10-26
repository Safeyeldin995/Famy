// Reuse the existing isolated fixtures without editing the protected mobile/qa/*.cjs.
// Main's fixtures now wait for LaunchGate themselves; no timing/source overrides.
import { createRequire, Module } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const allowed = ["phase1-web", "phase2a-web", "provider-web", "provider2-web", "chat-web"];
const suite = process.argv[2];
if (!allowed.includes(suite)) throw new Error("Unknown fixture suite");
const sourcePath = path.resolve("qa", `${suite}.cjs`);
const source = fs.readFileSync(sourcePath, "utf8");
process.argv = [process.argv[0], sourcePath, "dist-parity", `qa/parity-evidence/native/${suite}`];
const fixture = new Module(sourcePath);
fixture.filename = sourcePath;
fixture.paths = require.resolve.paths(sourcePath);
fixture._compile(source, sourcePath);
