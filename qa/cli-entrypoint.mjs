import { pathToFileURL } from "node:url";

/**
 * Windows-safe native ESM direct-execution guard.
 * Returns true only when this module's file was launched as the process entrypoint.
 * @param {string} importMetaUrl
 * @param {string[]} [argv]
 */
export function isDirectExecution(importMetaUrl, argv = process.argv) {
  const entry = argv[1];
  if (!entry) return false;
  try {
    return importMetaUrl === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

/**
 * Run an exported CLI main only when the host module is executed directly.
 * @param {string} importMetaUrl
 * @param {() => Promise<number | void> | number | void} runMain
 */
export function runCliIfDirect(importMetaUrl, runMain) {
  if (!isDirectExecution(importMetaUrl)) return;
  Promise.resolve()
    .then(() => runMain())
    .then((code) => {
      process.exit(typeof code === "number" ? code : 0);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
