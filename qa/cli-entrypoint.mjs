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
 * Tear down pooled fetch connections so async CLIs can exit without racing libuv teardown.
 */
export async function destroyPendingNetworkIo() {
  try {
    const { getGlobalDispatcher } = await import("node:undici");
    const dispatcher = getGlobalDispatcher();
    if (dispatcher && typeof dispatcher.destroy === "function") {
      await dispatcher.destroy();
    }
  } catch {
    // undici unavailable or destroy unsupported
  }
}

/**
 * Complete a CLI process with the requested exit code without racing libuv handle teardown.
 * @param {number} exitCode
 */
export async function finishCliProcess(exitCode) {
  await destroyPendingNetworkIo();
  process.exitCode = exitCode;
  await new Promise((resolve) => setImmediate(resolve));
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
    .then((code) => finishCliProcess(typeof code === "number" ? code : 0))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      void finishCliProcess(1);
    });
}
