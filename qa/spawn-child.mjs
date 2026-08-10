import { spawn } from "node:child_process";

/**
 * @param {string} command
 */
function shouldUseShell(command) {
  return process.platform === "win32" && !command.includes("\\") && !command.includes("/");
}

/**
 * Spawn a child and resolve only after the close event (stdio drained, exit observed).
 * @param {string} command
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<number>}
 */
export function spawnChildAndWait(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env,
      shell: shouldUseShell(command),
    });

    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      resolve(code);
    };

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });

    child.on("close", (code, signal) => {
      finish(signal ? 1 : (code ?? 1));
    });
  });
}
