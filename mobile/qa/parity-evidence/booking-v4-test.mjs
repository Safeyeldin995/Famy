// Compatibility entry point; parity locators now live in the canonical CJS runner.
import { createRequire, Module } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const sourcePath = path.resolve("qa/phase2a-web.cjs");
let source = fs.readFileSync(sourcePath, "utf8").replace(/\r\n/g, "\n");
function replace(anchor, value) {
  if (source.split(anchor).length !== 2) throw new Error(`Fixture changed: ${anchor}`);
  source = source.replace(anchor, () => value);
}
replace("let browser;", "let browser;\nlet failurePage;");
replace(
  "const page = await context.newPage();",
  "const page = await context.newPage();\n  failurePage = page;",
);
replace(
  ".catch((e) => {",
  `.catch(async (e) => {
    fs.writeFileSync(path.join(artifacts, 'failure.txt'), String(e.stack || e));
    try { await failurePage?.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }); }
    catch { console.error('Failure screenshot unavailable: browser page closed or crashed. Last successful screenshots retained.'); }`,
);
process.argv = [process.argv[0], sourcePath, "dist-parity", "qa/parity-evidence/native/booking-v4"];
const fixture = new Module(sourcePath);
fixture.filename = sourcePath;
fixture.paths = require.resolve.paths(sourcePath);
fixture._compile(source, sourcePath);
