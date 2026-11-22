#!/usr/bin/env node
/**
 * Release gate: Reanimated worklets in LaunchGate + splash helpers must compile for Android.
 * Fails before any EAS APK build if babel-preset-expo does not emit __workletHash markers.
 */
const fs = require("fs");
const path = require("path");
const babel = require("@babel/core");

const mobileRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(mobileRoot, "..");

function transformFile(absPath) {
  const source = fs.readFileSync(absPath, "utf8");
  const result = babel.transformSync(source, {
    filename: absPath,
    babelrc: false,
    configFile: false,
    presets: [
      [require.resolve("babel-preset-expo", { paths: [mobileRoot] }), { reanimated: true }],
    ],
    plugins: [[require.resolve("react-native-reanimated/plugin", { paths: [mobileRoot] }), {}]],
    caller: { name: "metro", platform: "android", isDev: false },
  });
  if (!result?.code) {
    throw new Error(`Babel produced no output for ${absPath}`);
  }
  return result.code;
}

function countWorkletHashes(code) {
  return (code.match(/__workletHash/g) || []).length;
}

function assertNamedWorklets(label, code, names) {
  const missing = names.filter((name) => {
    const idx = code.indexOf(`function ${name}`);
    if (idx === -1) return true;
    return !code.slice(idx, idx + 8000).includes("__workletHash");
  });
  if (missing.length) {
    console.error(`::error::Missing Reanimated worklet hash for: ${missing.join(", ")} (${label})`);
    process.exit(1);
  }
}

const launchGatePath = path.join(mobileRoot, "src/ui/LaunchGate.tsx");
const splashPath = path.join(repoRoot, "src/lib/splash/famySplashState.ts");

const launchCode = transformFile(launchGatePath);
const launchHashes = countWorkletHashes(launchCode);
if (launchHashes < 4) {
  console.error(
    `::error::LaunchGate.tsx: expected at least 4 __workletHash markers, found ${launchHashes}`,
  );
  process.exit(1);
}
console.log(`Worklet check passed: mobile/src/ui/LaunchGate.tsx (${launchHashes} worklets)`);

const splashCode = transformFile(splashPath);
assertNamedWorklets("src/lib/splash/famySplashState.ts", splashCode, [
  "famySplashState",
  "famySplashCenteredY",
  "famySplashYPosition",
]);
console.log("Worklet check passed: src/lib/splash/famySplashState.ts");
